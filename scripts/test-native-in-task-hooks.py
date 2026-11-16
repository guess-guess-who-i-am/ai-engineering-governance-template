#!/usr/bin/env python3
"""Real Codex harness + deterministic local Responses/graph fixtures; no model fees."""
import argparse, json, os, pathlib, shutil, socketserver, subprocess, tempfile, threading, hashlib, http.server, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--codex',default='codex');p.add_argument('--output');a=p.parse_args()
class Model(http.server.BaseHTTPRequestHandler):
    requests=[]
    def log_message(self,*args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));self.requests.append(body)
        n=len(self.requests);tools=body.get('tools',[])
        names=[t.get('name') for t in tools]
        if n<=2:
            name=next((x for x in ['exec_command','shell_command','shell'] if x in names),None)
            if name is None:
                self.send_error(400,'shell tool missing');return
            command='printf native-routing-probe' if n==1 else 'exit 7'
            args={'command':['/bin/sh','-c',command]} if name=='shell' else {'command':command} if name=='shell_command' else {'cmd':command,'max_output_tokens':100}
            item={'type':'function_call','id':f'fc_{n}','call_id':f'call_{n}','name':name,'arguments':json.dumps(args)}
        else:
            item={'type':'message','id':'msg_final','role':'assistant','content':[{'type':'output_text','text':'Native hook probe complete.','annotations':[]}]}
        response={'id':f'resp_{n}','object':'response','status':'completed','output':[item],'usage':{'input_tokens':10,'output_tokens':10,'total_tokens':20}}
        events=[{'type':'response.created','response':{'id':f'resp_{n}','status':'in_progress','output':[]}}, {'type':'response.output_item.added','output_index':0,'item':item},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':response}]
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
        for event in events:self.wfile.write(('event: '+event['type']+'\ndata: '+json.dumps(event)+'\n\n').encode())
        self.wfile.flush()
with tempfile.TemporaryDirectory(prefix='native-in-task-') as tmp:
    home=pathlib.Path(tmp);hooks=home/'hooks';hooks.mkdir();reg=home/'skill-registry';reg.mkdir();workspace=home/'workspace';workspace.mkdir()
    for name in ['skill-router.mjs','routing-context.mjs','routing-checkpoint.mjs','hook-dispatch.mjs']:
        shutil.copyfile(ROOT/'codex-profile/.codex/hooks'/name,hooks/name)
    (hooks/'graph_skill_index.py').write_text('# fixture: real socket server owns retrieval\n')
    graph=reg/'graph.json';graph.write_text('{}')
    (reg/'skills-index.json').write_text(json.dumps({'skills':[],'externalGraphPath':str(graph.resolve())}));(reg/'routing-rules.json').write_text('{}')
    skill=home/'SKILL.md';skill.write_text('---\nname: native-hook-marker\ndescription: Probe workflow.\n---\nNative fixture.\n')
    graph_queries=[]
    class Graph(socketserver.StreamRequestHandler):
        def handle(self):
            payload=json.loads(self.rfile.readline());graph_queries.append(payload['query'])
            marker='NATIVE_OUTCOME_ROUTED' if payload['query'].startswith('Review the current') else 'NATIVE_PHASE_ROUTED'
            result={'name':marker,'description':'Native hook retrieval fixture','path':str(skill),'score':1,'kind':'skill'}
            self.wfile.write((json.dumps({'ok':True,'results':[result]})+'\n').encode())
    sockdir=pathlib.Path('/tmp')/f'codex-graph-{os.getuid()}';sockdir.mkdir(mode=0o700,exist_ok=True)
    sock=sockdir/(hashlib.sha256(str(graph.resolve()).encode()).hexdigest()[:24]+'.sock')
    graph_server=socketserver.ThreadingUnixStreamServer(str(sock),Graph);threading.Thread(target=graph_server.serve_forever,daemon=True).start()
    model=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
    node=shutil.which('node') or '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
    capture=home/'hook-inputs.jsonl'
    wrapper=home/'capture.mjs'
    wrapper.write_text("import {appendFileSync} from 'node:fs';import{spawnSync}from'node:child_process';let s='';for await(const c of process.stdin)s+=c;appendFileSync("+json.dumps(str(capture))+",s+'\\n');const r=spawnSync(process.execPath,["+json.dumps(str(hooks/'hook-dispatch.mjs'))+"],{input:s,encoding:'utf8',env:process.env});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;")
    command=f"'{node}' '{wrapper}'"
    (home/'hooks.json').write_text(json.dumps({'hooks':{event:[{'hooks':[{'type':'command','command':command,'timeout':60}]}] for event in ['PreToolUse','PostToolUse']}}))
    (home/'config.toml').write_text(f'''model = "fixture"
model_provider = "fixture"
[features]
hooks = true
[model_providers.fixture]
name = "Fixture"
base_url = "http://127.0.0.1:{model.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
''')
    started=time.monotonic()
    try:
        result=subprocess.run([a.codex,'exec','--json','--skip-git-repo-check','--dangerously-bypass-hook-trust','-s','danger-full-access','-C',str(workspace),'Run the two shell probes and finish.'],capture_output=True,text=True,timeout=90,env={**os.environ,'CODEX_HOME':str(home),'CODEX_GRAPH_TOOL_PYTHON':shutil.which('python3') or '/usr/bin/python3'})
        events=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        # Hooks must actually enter the next request, rather than just logging.
        encoded=[json.dumps(body) for body in Model.requests]
        report={'exitCode':result.returncode,'durationMs':round((time.monotonic()-started)*1000),'modelRequests':len(encoded),'hookInputs':[json.loads(line) for line in capture.read_text().splitlines()] if capture.exists() else [],'graphQueries':graph_queries,'phaseInjected':len(encoded)>1 and 'NATIVE_PHASE_ROUTED' in encoded[1],'outcomeInjected':len(encoded)>1 and 'NATIVE_OUTCOME_ROUTED' in encoded[1],'toolResults':[e for e in events if e.get('item',{}).get('type')=='command_execution'],'stderr':result.stderr[-4000:]}
        if a.output:pathlib.Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False))
        assert result.returncode==0 and report['phaseInjected'] and report['outcomeInjected'], 'Native hooks did not reach model request'
    finally:
        model.shutdown();graph_server.shutdown();model.server_close();graph_server.server_close();sock.unlink(missing_ok=True)
