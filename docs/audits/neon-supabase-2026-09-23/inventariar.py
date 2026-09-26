"""Inventário estático; não abre .env, não conecta a bancos e não executa DDL.
Rodar da raiz: python3 docs/audits/neon-supabase-2026-09-23/inventariar.py
Regex fornece candidatos, não substitui catálogo de um banco aplicado.
"""
import re, csv, json, subprocess
from pathlib import Path
from collections import Counter, defaultdict
ROOT=Path.cwd()
OUT=Path(__file__).resolve().parent
files=subprocess.check_output(['git','ls-files'],text=True).splitlines()
code=[p for p in files if p.endswith(('.ts','.tsx')) and p.split('/')[0] in {'app','lib','hooks','components','workers'} and not re.search(r'\.(test|spec)\.',p) and p!='lib/database.types.ts']
def clean(s):
    # SQL: remove comentários, preservando linhas e strings/dollar bodies.
    return re.sub(r'/\*[\s\S]*?\*/|--[^\n]*',lambda m:'\n'*m[0].count('\n'),s)
def clean_ts(s):
    # Scanner lexical leve: mantém strings e posições; remove comentários JS.
    out=list(s); i=0; quote=None
    while i<len(s):
        if quote:
            if s[i]=='\\': i+=2; continue
            if s[i]==quote: quote=None
            i+=1; continue
        if s[i] in ("'", '"', '`'): quote=s[i]; i+=1; continue
        if s[i:i+2]=='//':
            end=s.find('\n',i); end=len(s) if end<0 else end
            for j in range(i,end): out[j]=' '
            i=end; continue
        if s[i:i+2]=='/*':
            end=s.find('*/',i+2); end=len(s) if end<0 else end+2
            for j in range(i,end):
                if s[j]!='\n': out[j]=' '
            i=end; continue
        i+=1
    return ''.join(out)
def line(s,pos): return s.count('\n',0,pos)+1
def save(name,rows,fields):
    with (OUT/name).open('w') as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
src=Path('supabase/baseline.sql').read_text(); sql=clean(src)
ident=r'"?[a-zA-Z_][\w$]*"?'; qname=rf'{ident}(?:\s*\.\s*{ident})?'
def name(v):
    v=re.sub(r'["\s]','',v).lower()
    return v if '.' in v else 'public.'+v
rows=[]; creates={}; functions=defaultdict(list)
for m in re.finditer(rf'\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?({qname})\s*\(',sql,re.I):
    n=name(m[1]); creates.setdefault(n,[]).append(line(sql,m.start()))
for m in re.finditer(rf'\bcreate\s+(?:or\s+replace\s+)?function\s+({qname})\s*\(',sql,re.I):
    n=name(m[1]); start=m.start(); head=sql[start:]
    dollar=re.search(r'\bas\s+(\$[\w]*\$)',head,re.I)
    end=start+min(len(head),1000)
    if dollar:
        close=head.find(dollar[1],dollar.end())
        if close>=0: end=start+close+len(dollar[1])
    body=sql[start:end]
    functions[n].append({'linha':line(sql,start),'security_definer':bool(re.search(r'security\s+definer',body,re.I)),'auth_users':bool(re.search(r'"?auth"?\s*\.\s*"?users"?',body,re.I)),'auth_context':bool(re.search(r'auth\s*\.\s*(uid|jwt|role)|request\.(jwt|headers)',body,re.I)),'auth_sessions_mfa':bool(re.search(r'auth\.(sessions|mfa_factors)',body,re.I)),'storage':bool(re.search(r'\bstorage\s*\.',body,re.I))})
policies=[]
for m in re.finditer(rf'\bcreate\s+policy\s+({ident})\s+on\s+({qname})',sql,re.I):
    end=sql.find(';',m.end()); body=sql[m.start():end]
    policies.append({'tabela':name(m[2]),'policy':m[1].strip('"'),'linha':line(sql,m.start()),'contexto_auth':bool(re.search(r'auth\s*\.|fn_user|fn_support|fn_is_platform',body,re.I))})
froms=[]; rpcs=[]; surfaces=[]; pg=[]
for p in code:
    s=clean_ts(Path(p).read_text()); client=bool(re.search(r'''^[\s]*["']use client["']''',s,re.M)) or p.startswith('hooks/')
    for m in re.finditer(r'\.\s*(from|rpc)\s*\(\s*([^\n,)]*)',s):
        if re.search(r'\b(?:Array|Buffer)\s*$',s[max(0,m.start()-25):m.start()]): continue
        arg=m[2].strip(); literal=re.fullmatch(r'''["']([\w.-]+)["']''',arg)
        target=literal[1] if literal else '<dinamico-ou-expressao>'
        storage=bool(re.search(r'\.storage\s*$',s[max(0,m.start()-100):m.start()]))
        row={'arquivo':p,'linha':line(s,m.start()),'alvo':target,'client_candidate':client,'classe':'Storage' if storage else 'RPC' if m[1]=='rpc' else 'from-candidato'}
        (rpcs if m[1]=='rpc' else froms).append(row)
    for kind,pat in {'Auth':r'\.auth\s*\.', 'Storage':r'\.storage\s*\.', 'Realtime':r'\buseRealtimeChannel\s*\(|postgres_changes|\.channel\s*\(|\.realtime\.', 'SQL-direto':r'\b(?:pool|client|db)\.query\s*\(|\bcreatePool\s*\('}.items():
        matches=list(re.finditer(pat,s))
        if matches: surfaces.append({'arquivo':p,'classe':kind,'ocorrencias':len(matches),'linhas':';'.join(str(line(s,m.start())) for m in matches),'client_candidate':client})
for n,lines in sorted(creates.items()):
    refs=[r for r in froms if r['alvo']==n.split('.')[-1] and r['classe']!='Storage']
    rows.append({'tabela':n,'destino':'Supabase Storage' if n.startswith('storage.') else 'Neon (tabela de negocio/plataforma)','linhas_create':';'.join(map(str,lines)),'policies_create_candidatas':len([x for x in policies if x['tabela']==n]),'chamadas_from_literais':len(refs)})
save('tabelas.csv',rows,list(rows[0]))
fnrows=[]
for n,defs in sorted(functions.items()):
    refs=[r for r in rpcs if r['alvo']==n.split('.')[-1]]
    fnrows.append({'funcao':n,'destino':'Neon SQL/servico; revisar auth/storage quando marcado','linhas_definicoes':';'.join(str(d['linha']) for d in defs),'alguma_definicao_security_definer':any(d['security_definer'] for d in defs),'alguma_definicao_auth_users':any(d['auth_users'] for d in defs),'alguma_definicao_auth_context':any(d['auth_context'] for d in defs),'alguma_definicao_auth_sessions_mfa':any(d['auth_sessions_mfa'] for d in defs),'alguma_definicao_storage':any(d['storage'] for d in defs),'rpc_literais_runtime':len(refs)})
save('funcoes.csv',fnrows,list(fnrows[0]))
save('policies.csv',policies,list(policies[0]))
save('chamadas.csv',froms+rpcs,list((froms+rpcs)[0]))
save('superficies.csv',surfaces,list(surfaces[0]))
deps=[]
patterns={'auth-users':r'"?auth"?\s*\.\s*"?users"?', 'auth-sessions':r'auth\.sessions', 'auth-mfa':r'"?auth"?\s*\.\s*"?mfa_\w+', 'contexto-jwt':r'auth\.(?:uid|jwt|role)\s*\(|request\.(?:jwt|headers)', 'storage':r'\bstorage\s*\.', 'realtime':r'supabase_realtime|\brealtime\s*\.', 'extensoes':r'create\s+extension|\bvector\s*\(|gin_trgm_ops|\bcitext\b'}
for kind,pat in patterns.items():
    for m in re.finditer(pat,sql,re.I): deps.append({'classe':kind,'linha':line(sql,m.start()),'trecho':sql.splitlines()[line(sql,m.start())-1].strip()[:220]})
save('dependencias-sql.csv',deps,list(deps[0]))
views=[{'view':name(m[1]),'linha':line(sql,m.start())} for m in re.finditer(rf'create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+({qname})',sql,re.I)]
save('views.csv',views,['view','linha'])
summary={'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'arquivos_runtime_examinados':len(code),'tabelas_create_distintas_baseline':len(creates),'nomes_funcoes_distintos_baseline':len(functions),'declaracoes_create_policy_candidatas':len(policies),'from_candidatos':len(froms),'from_storage_identificado':sum(r['classe']=='Storage' for r in froms),'rpc_candidatos':len(rpcs),'rpc_nomes_literais_distintos':len(set(r['alvo'] for r in rpcs if not r['alvo'].startswith('<'))),'arquivos_com_from_rpc':len(set(r['arquivo'] for r in froms+rpcs)),'alvos_from_nao_encontrados_em_create_table':sorted(set(r['alvo'] for r in froms if r['classe']!='Storage' and 'public.'+r['alvo'] not in creates)),'rpc_nao_encontradas_no_baseline':sorted(set(r['alvo'] for r in rpcs if 'public.'+r['alvo'] not in functions)),'superficies_arquivos':dict(Counter(r['classe'] for r in surfaces))}
(OUT/'resumo.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
