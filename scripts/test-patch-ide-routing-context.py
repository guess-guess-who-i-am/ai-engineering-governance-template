#!/usr/bin/env python3
import importlib.util,pathlib,unittest,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('patcher',pathlib.Path(__file__).with_name('patch-ide-routing-context.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class PatchTests(unittest.TestCase):
 def source(self):return 'OWNER_USER_CHANGE\n'+p.ANCHOR+"\n        ...(executionMode ? {} : {}) };\n"+p.LOAD+'      conversation.push(...archivedInput.map(normalizeChatMessage));\n'
 def test_requires_known_owner(self):
  for source in ['',self.source()+p.LOAD,self.source().replace(p.ANCHOR,'unknown')]:
   with self.assertRaisesRegex(ValueError,'anchor|Expected'):p.patch(source)
 def test_moves_load_before_hook_and_preserves_original(self):
  source=self.source();out,changed=p.patch(source);self.assertTrue(changed);self.assertEqual(out.count(p.LOAD),1);self.assertLess(out.index(p.LOAD),out.index(p.ANCHOR));self.assertIn('OWNER_USER_CHANGE',out);self.assertIn('conversation.push(...archivedInput.map(normalizeChatMessage))',out);self.assertIn('routing_context: routingContext',out)
 def test_second_application_is_identical(self):
  out,_=p.patch(self.source());again,changed=p.patch(out);self.assertFalse(changed);self.assertEqual(out,again)
 def test_corrupt_existing_patch_rejected(self):
  out,_=p.patch(self.source());
  with self.assertRaises(ValueError):p.patch(out+p.MARKER)
 def test_dependency_refresh_and_idempotence(self):
  with tempfile.TemporaryDirectory() as tmp:
   runner=pathlib.Path(tmp)/'deepseek-run.js';runner.write_text(self.source());out,_=p.patch(self.source())
   self.assertTrue(p.deploy(runner,out,b'version-one'))
   self.assertIsNone(p.deploy(runner,out,b'version-one'))
   backup=p.deploy(runner,out,b'version-two');self.assertTrue(backup)
   self.assertEqual((runner.parent/'skill-routing-context.mjs').read_bytes(),b'version-two')
   self.assertEqual((pathlib.Path(backup)/'skill-routing-context.mjs').read_bytes(),b'version-one')
   self.assertEqual(runner.read_text(),out)
 def test_failed_importer_publish_restores_both_files(self):
  with tempfile.TemporaryDirectory() as tmp:
   runner=pathlib.Path(tmp)/'deepseek-run.js';runner.write_text(self.source());dependency=runner.parent/'skill-routing-context.mjs';dependency.write_bytes(b'old-dependency')
   out,_=p.patch(self.source());original=p.os.replace;calls=0
   def fail_once(source,target):
    nonlocal calls
    calls+=1
    if calls==2:raise OSError('injected importer publication failure')
    return original(source,target)
   with patch.object(p.os,'replace',side_effect=fail_once):
    with self.assertRaisesRegex(OSError,'injected'):p.deploy(runner,out,b'new-dependency')
   self.assertEqual(runner.read_text(),self.source());self.assertEqual(dependency.read_bytes(),b'old-dependency')
if __name__=='__main__':unittest.main()
