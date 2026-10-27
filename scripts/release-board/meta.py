import re,os,json,sys,collections
sys.path.insert(0,'.')
DONEW=('done','applied','merged','fixed','built','implemented','closed','yes','verified')
def meta(path):
    t=open(path,errors='ignore').read()
    codes=re.findall(r'^```(\w*)',t,re.M)
    langs=collections.Counter(c.lower() for i,c in enumerate(codes) if c)   # opening fences carry the tag
    nfence=len(re.findall(r'^```',t,re.M))//2
    body=re.sub(r'```.*?```','',t,flags=re.S)
    boxes_open=len(re.findall(r'^\s*[-*] \[ \]',body,re.M)); boxes_done=len(re.findall(r'^\s*[-*] \[[xX]\]',body,re.M))
    rows_done=rows_all=0
    for l in body.splitlines():
        if l.startswith('|') and not re.match(r'^\|[\s:|-]+\|$',l):
            cells=[c.strip().lower() for c in l.strip('|').split('|')]
            if any(c in ('status','item','dev','prod') for c in cells): continue
            if any(c.split(' ')[0] in DONEW or c in('pending','open','partial','not started','in progress') for c in cells[-3:]):
                rows_all+=1
                if any(c.split(' ')[0] in DONEW for c in cells[-3:]): rows_done+=1
    heads=re.findall(r'^(#{1,3})\s+(.+)$',body,re.M)
    title=heads[0][1] if heads else ''
    docrefs=set(re.findall(r'[\w./-]+\.md',body))
    srcrefs=set(re.findall(r'\b(?:lib|test|scripts|supabase|extension/src|src)/[\w./-]+\.(?:dart|py|sql|ts|kt|swift)\b',t))
    prs=set(re.findall(r'(?:#|pull request )(\d{2,5})\b',body))
    shas=set(re.findall(r'\b[0-9a-f]{7,10}\b',body))-set(re.findall(r'\b\d{7,10}\b',body))
    shas={s for s in shas if re.search(r'[a-f]',s) and re.search(r'\d',s)}
    urls=set(re.findall(r'https?://[^\s)>\]`"]+',t))
    xproj={k for k,pat in {'supabase':r'supabase','website':r'web\.app|website','lints':r'saropa[_ -]lints','drift advisor':r'drift advisor','app':r'contacts app|the app\b'}.items() if re.search(pat,body,re.I)}
    words=len(body.split())
    return dict(title=title[:80],heads=len(heads),words=words,chars=len(t),boxes_open=boxes_open,boxes_done=boxes_done,rows_all=rows_all,rows_done=rows_done,
        code_blocks=nfence,langs=dict(langs),docrefs=len(docrefs),srcrefs=sorted(srcrefs),prs=len(prs),shas=len(shas),urls=len(urls),xproj=sorted(xproj))
if __name__=='__main__':
    bl=json.load(open('blockers.json'))
    base={'app':'/home/user/contacts','supabase':'/home/user/saropa-supabase','web':'/home/user/web.app'}
    out=[]
    for x in bl:
        m=meta(os.path.join(base[x['proj']],x['p'])); m.update(proj=x['proj'],p=x['p'],level=x['level'],kind=x['kind']); out.append(m)
        print(x['level'],x['p'][-46:],'|',m['title'][:40],'|',m['words'],'words',m['heads'],'heads | boxes',m['boxes_open'],'open',m['boxes_done'],'done | rows',m['rows_done'],'/',m['rows_all'],'| code',m['code_blocks'],m['langs'],'| docs',m['docrefs'],'src',len(m['srcrefs']),'PR',m['prs'],'sha',m['shas'],'urls',m['urls'],m['xproj'])
    json.dump(out,open('blockers_meta.json','w'))
