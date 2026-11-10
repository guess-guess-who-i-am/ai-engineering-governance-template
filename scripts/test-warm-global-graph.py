#!/usr/bin/env python3
"""A cold start may outlive the query execution budget, but must still prewarm."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import unittest

SCRIPT = Path(os.environ.get('WARM_SCRIPT', Path(__file__).with_name('warm-global-graph.py')))

class WarmTests(unittest.TestCase):
    def run_server(self, responses):
        with tempfile.TemporaryDirectory() as directory:
            graph = str((Path(directory) / 'graph.json').resolve())
            endpoint = Path('/tmp') / f'codex-graph-{os.getuid()}' / (hashlib.sha256(graph.encode()).hexdigest()[:24] + '.sock')
            endpoint.parent.mkdir(exist_ok=True, mode=0o700)
            server = socket.socket(socket.AF_UNIX);server.bind(str(endpoint));server.listen();server.settimeout(5)
            received = []
            def serve():
                try:
                    for response in responses:
                        connection, _ = server.accept()
                        with connection:
                            received.append(json.loads(connection.makefile('rb').readline()))
                            connection.sendall((json.dumps(response)+'\n').encode())
                except socket.timeout:
                    pass
                finally:
                    server.close()
            thread=threading.Thread(target=serve);thread.start()
            result=subprocess.run(['python3',str(SCRIPT),'--graph',graph,'--processes','1'],capture_output=True,text=True,timeout=8)
            thread.join();endpoint.unlink(missing_ok=True)
            return result,received

    def test_retries_expired_cold_start(self):
        result, rows=self.run_server([{'ok':False,'error':'request expired before retrieval'},
                                     {'ok':True,'results':[{'name':'ready'}],'queryPid':123,'readyLanguages':['en','zh'],'prefilter':True}])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(len(rows),2)
        self.assertGreater(rows[1]['deadline'],rows[0]['deadline']-50)

    def test_does_not_hide_corrupt_graph(self):
        result,rows=self.run_server([{'ok':False,'error':'sidecar checksum mismatch'}])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('sidecar checksum mismatch',result.stderr)
        self.assertEqual(len(rows),1)

    def test_requires_bilingual_ready(self):
        result,rows=self.run_server([{'ok':True,'results':[{}],'queryPid':123,'readyLanguages':['en'],'prefilter':True}])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('both English and Chinese',result.stderr)

if __name__=='__main__':unittest.main()
