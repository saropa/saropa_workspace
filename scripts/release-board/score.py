import json,re,os,sys,collections
sys.path.insert(0,'.')
import engine
sev=json.load(open('severity.json')); cfg=json.load(open('saropa_board_rules.json'))
def strip_code(t): return re.sub(r'```.*?```','',t,flags=re.S)
def count(text,ph):
    n=0;tl=text.lower();i=0
    while True:
        i=tl.find(ph,i)
        if i<0: return n
        pre=tl[max(0,i-12):i]
        if not any(pre.endswith(x) or x in pre[-len(x)-2:] for x in sev['negation']): n+=1
        i+=len(ph)
def score(path,name):
    t=strip_code(open(path,errors='ignore').read()); lines=t.splitlines()
    title=re.sub(r'[_-]',' ',name)+' '+(lines[0] if lines else ''); head='\n'.join(lines[1:20]); body='\n'.join(lines[20:])
    W=sev['weights'];res={};ev={}
    for lvl,phs in sev['phrases'].items():
        s=0;hit=[]
        for ph in phs:
            a=min(count(title,ph),W['perPhraseCap'])*W['title']+min(count(head,ph),W['perPhraseCap'])*W['head']
            b=count(body,ph); words=max(1,len(t.split()))
            dens=b*1000/words
            c=a+(min(b,W['perPhraseCap'])*W['body'] if dens>=sev['minBodyDensity'] else 0)
            if c: s+=c;hit.append(ph)
        res[lvl]=s;ev[lvl]=hit
    level='medium'
    for lvl in ('extreme','critical','high'):
        if res[lvl]>=sev['threshold']: level=lvl;break
    else:
        if res['low']>=sev['threshold'] and res['low']>max(res['extreme'],res['critical'],res['high']): level='low'
    aud='pro' if any(p in t.lower() for p in sev['audience']['pro']) else 'all'
    return level,aud,res,ev
if __name__=='__main__':
    res,_,_=engine.classify(cfg); paths={p['id']:p['path'] for p in cfg['projects']}
    out=[]
    for x in res:
        if x['status'] in('red','amber') and x['p'].endswith(('.md','.sql')) and x['note']!='blocked' and x['proj'] in('app','supabase','web'):
            lv,aud,sc,ev=score(os.path.join('/home/user',paths[x['proj']],x['p']),os.path.basename(x['p']))
            out.append(dict(proj=x['proj'],p=x['p'],status=x['status'],kind=x['kind'],level=lv,aud=aud,ev=ev.get(lv if lv in ev else 'x',[]),sc=sc))
    c=collections.Counter(o['level'] for o in out); print(len(out),c)
    for lv in ('extreme','critical','high','low'):
        print('==',lv)
        for o in [o for o in out if o['level']==lv][:9]: print('  ',o['proj'],o['p'][:70],o['aud'],o['ev'][:4])
    json.dump(out,open('scored.json','w'))
