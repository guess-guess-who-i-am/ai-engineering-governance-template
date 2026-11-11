#!/usr/bin/env python3
"""Exercise private load inputs at the real socket boundary without publishing text."""
import hashlib,json,os,socket,subprocess,sys,tempfile,threading,unittest
from pathlib import Path
SCRIPT=Path(__file__).with_name('benchmark-graph-load.py')
class LoadInputTests(unittest.TestCase):
 def test_private_prompts_reach_socket_with_quotas_but_not_report(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory).resolve();registry=root/'skill-registry';registry.mkdir();graph=root/'graph.json';graph.write_text('{}')
   (registry/'skills-index.json').write_text(json.dumps({'externalGraphPath':str(graph)}))
   prompt='private representative task';inputs=root/'prompts.json';inputs.write_text(json.dumps([prompt]));report=root/'report.json'
   endpoint=Path('/tmp')/f'codex-graph-{os.getuid()}'/(hashlib.sha256(str(graph).encode()).hexdigest()[:24]+'.sock');endpoint.parent.mkdir(exist_ok=True)
   server=socket.socket(socket.AF_UNIX);server.bind(str(endpoint));server.listen();server.settimeout(5);rows=[]
   def serve():
    try:
     for _ in range(2):
      connection,_=server.accept()
      with connection:
       rows.append(json.loads(connection.makefile('rb').readline()));connection.sendall((json.dumps({'ok':True,'results':[{'name':'fixture'}],'pid':os.getpid(),'queryPid':os.getpid(),'loads':1})+'\n').encode())
    finally:server.close()
   thread=threading.Thread(target=serve);thread.start()
   try:
    result=subprocess.run([sys.executable,str(SCRIPT),'--codex-home',str(root),'--count','2','--prompts-json',str(inputs),'--output',str(report)],capture_output=True,text=True,timeout=8)
    self.assertEqual(result.returncode,0,result.stdout+result.stderr);data=json.loads(report.read_text());self.assertEqual(data['success'],2)
    self.assertEqual(data['basePromptBytes'],[len(prompt.encode())]);self.assertNotIn(prompt,result.stdout+report.read_text())
    self.assertTrue(all(row['query'].startswith(prompt) and row['category_slots']=={'expert':2,'skill':4,'mcp':2} for row in rows))
   finally:thread.join();endpoint.unlink(missing_ok=True)
 def test_invalid_prompt_array_fails_before_any_load(self):
  with tempfile.TemporaryDirectory() as directory:
   inputs=Path(directory)/'bad.json';inputs.write_text('[]')
   result=subprocess.run([sys.executable,str(SCRIPT),'--prompts-json',str(inputs)],capture_output=True,text=True,timeout=5)
   self.assertNotEqual(result.returncode,0);self.assertIn('nonempty JSON array',result.stderr)
if __name__=='__main__':unittest.main()
