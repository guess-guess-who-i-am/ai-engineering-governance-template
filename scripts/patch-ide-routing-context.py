#!/usr/bin/env python3
"""Move this session's history before routing Hook; retain original model history."""
import argparse, hashlib, json, os, shutil, tempfile
from pathlib import Path
from datetime import datetime, timezone
MARKER='CONVERSATIONAL_ROUTING_CONTEXT_V1'
LOAD='''      const sourceThread = resumed ? threadId : String(forkThreadId).startsWith('deepseek-') ? forkThreadId : '';
      restoredContext = sourceThread && runtime.loadContext ? await runtime.loadContext(sourceThread) : null;
      const archivedInput = Array.isArray(messages) && messages.length ? messages
        : [...(sourceThread && runtime.loadDialogue ? await runtime.loadDialogue(sourceThread) : []), {role:'user',content:String(prompt||'')}];
'''
ANCHOR="      const lifecycle = { session_id: threadId, turn_id: turnId, prompt: String(prompt || ''), source: 'startup',"

def patch(source):
    if MARKER in source:
        if source.count(MARKER)!=1 or source.index(LOAD)>source.index(ANCHOR):raise ValueError('Existing routing patch differs from required ordering')
        return source,False
    if source.count(LOAD)!=1 or source.count(ANCHOR)!=1:raise ValueError('Expected unique history load and lifecycle anchors; refusing unknown IDE source')
    source=source.replace(LOAD,'',1)
    extra="""      // CONVERSATIONAL_ROUTING_CONTEXT_V1: resolve only this session's
      // in-memory dialogue before Hook; model history itself is unchanged.
      const routingContext = createRoutingContext({sessionId:threadId,cwd,prompt:String(prompt||''),
        messages:Array.isArray(dialogueContext) && dialogueContext.length ? dialogueContext : archivedInput});
"""
    # The lifecycle object itself owns this field. Its unrelated following
    # properties vary between real deployments and must not select the patch.
    source=source.replace(ANCHOR,LOAD+extra+ANCHOR+"\n        routing_context: routingContext,",1)
    source="import {createRoutingContext} from './skill-routing-context.mjs';\n"+source
    return source,True

def deploy(runner, out, dependency_bytes):
    dependency_target=runner.parent/'skill-routing-context.mjs'
    runner_changed=runner.read_bytes()!=out.encode()
    dependency_changed=not dependency_target.exists() or dependency_target.read_bytes()!=dependency_bytes
    if not runner_changed and not dependency_changed:return None
    backup=runner.parent/'backups'/('routing-context-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True,mode=0o700);shutil.copy2(runner,backup/runner.name)
    if dependency_target.exists():shutil.copy2(dependency_target,backup/dependency_target.name)
    # Dependency first, then importer; each rename is atomic. Old importers do
    # not use the new dependency, and updated importers always see a full file.
    def atomic(target, data, mode):
        fd,tmp=tempfile.mkstemp(prefix='.routing-context-',dir=target.parent)
        try:
            with os.fdopen(fd,'wb') as f:f.write(data)
            os.chmod(tmp,mode);os.replace(tmp,target)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
    try:
        atomic(dependency_target,dependency_bytes,0o600)
        if runner_changed:atomic(runner,out.encode(),runner.stat().st_mode & 0o777)
    except BaseException:
        atomic(runner,(backup/runner.name).read_bytes(),runner.stat().st_mode & 0o777)
        old=backup/dependency_target.name
        if old.exists():atomic(dependency_target,old.read_bytes(),0o600)
        elif dependency_target.exists():dependency_target.unlink()
        raise
    return str(backup)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--runner',type=Path,required=True);p.add_argument('--check',action='store_true');p.add_argument('--output',type=Path);a=p.parse_args()
    raw=a.runner.read_bytes();source=raw.decode();out,changed=patch(source)
    dependency=Path(__file__).resolve().parents[1]/'codex-profile/.codex/hooks/routing-context.mjs'
    dependency_bytes=dependency.read_bytes();target=a.runner.parent/'skill-routing-context.mjs'
    result={'changed':changed,'dependencyChanged':not target.exists() or target.read_bytes()!=dependency_bytes,'checkOnly':a.check,'beforeSha256':hashlib.sha256(raw).hexdigest(),'afterSha256':hashlib.sha256(out.encode()).hexdigest()}
    if a.output:a.output.write_text(out)
    elif not a.check:result['backup']=deploy(a.runner,out,dependency_bytes)
    print(json.dumps(result))
if __name__=='__main__':main()
