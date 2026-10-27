# Prototype of the Release Board rule engine, severity scorer and document reader (Python).
# Reference for the TypeScript port in extension/src/board. They read repos under /home/user.
import json,os,re,sys,collections,copy
def glob2re(g):
    # {a,b} alternation, ** any depth, * within a segment
    alts=[]
    def alt(m): alts.append('(?:'+'|'.join(re.escape(x) for x in m.group(1).split(','))+')'); return '\x02%d\x02'%(len(alts)-1)
    g=re.sub(r'\{([^{}]*)\}',alt,g)
    g=g.replace('\\','\\\\').replace('.','\\.').replace('**/','\x00').replace('**','\x01').replace('*','[^/]*').replace('?','[^/]')
    g=g.replace('\x00','(?:.*/)?').replace('\x01','.*')
    g=re.sub('\x02(\\d+)\x02',lambda m:alts[int(m.group(1))],g)
    return re.compile('^'+g+'$')
def expand(s,params):
    def sub(m):
        v=params[m.group(1)]
        return ','.join(v) if isinstance(v,list) else v
    return re.sub(r'\$(\w+)',sub,s)
def project_rules(cfg,pr):
    rules=[];status_line=None
    for rid in [] : pass
    params={}
    for sname in pr['ruleSets']:
        s=cfg['ruleSets'][sname]; p=dict(s.get('params',{})); params.update(p)
    params.update(pr.get('params',{}))
    for r in pr.get('rules',[]): rules.append((sname if False else 'project',r))
    for sname in pr['ruleSets']:
        s=cfg['ruleSets'][sname]
        if 'statusLine' in s: status_line=s['statusLine']
        for r in s.get('rules',[]): rules.append((sname,r))
    return rules,params,status_line
def compile_rule(r,params):
    w=r['when']
    pg=glob2re(expand(w['path'],params)) if 'path' in w else None
    ng=glob2re(expand(w['name'],params)) if 'name' in w else None
    return pg,ng
def classify(cfg,rename=None,only=None):
    ign=[glob2re(g) for g in cfg['ignore']]
    out=[];fired=collections.Counter()
    base_dir=os.environ.get('BASE','/home/user')
    for pr in cfg['projects']:
        if only and pr['id'] not in only: continue
        rules,params,sl=project_rules(cfg,pr)
        comp=[(sn,r)+compile_rule(r,params) for sn,r in rules]
        for root in pr['roots']:
            base=os.path.join(base_dir,pr['path'],root)
            for r,ds,fs in os.walk(base):
                for f in fs:
                    if not f.endswith(('.md','.sql')): continue
                    p=os.path.relpath(os.path.join(r,f),os.path.join(base_dir,pr['path'])).replace(os.sep,'/')
                    vp=p
                    if rename:
                        for a,b in rename.items(): vp=re.sub('(^|/)'+a+'(/|$)',lambda m:m.group(1)+b+m.group(2),vp)
                    if any(g.match(vp) for g in ign): continue
                    nm=os.path.basename(vp); status='grey';kind='';rid=None;sn_hit=None;note=''
                    for sn,rule,pg,ng in comp:
                        if pg and not pg.match(vp): continue
                        if ng and not ng.match(nm): continue
                        s=rule['set']; status=s['status']; kind=s.get('kind',''); note=s.get('note',''); rid=rule['id']; sn_hit=sn; break
                    word=None
                    if sl and status in sl['appliesTo'] and p.endswith('.md'):
                        try: head=''.join(open(os.path.join(base_dir,pr['path'],p),errors='ignore').readlines()[:20])
                        except Exception: head=''
                        m=re.search(r'^\W*status\W*:?\**\s*(\S+)',head,re.I|re.M)
                        if m:
                            word=re.sub(r'[^a-z]','',m.group(1).lower())
                            if word in sl['words']: status=sl['words'][word]; rid=(rid or '?')+' > status line'
                    if rid: fired[(pr['id'],rid.split(' ')[0])]+=1
                    out.append(dict(proj=pr['id'],p=p,status=status,kind=kind,rule=rid,set=sn_hit,note=note,word=word))
    return out,fired,comp
def summarize(res):
    return collections.Counter((x['proj'],x['status']) for x in res)
if __name__=='__main__':
    cfg=json.load(open(sys.argv[1])); res,fired,_=classify(cfg)
    c=summarize(res)
    for pr in cfg['projects']: print(pr['id'],{s:c[(pr['id'],s)] for s in ['red','amber','purple','blue','green','reference','grey'] if c[(pr['id'],s)]})
