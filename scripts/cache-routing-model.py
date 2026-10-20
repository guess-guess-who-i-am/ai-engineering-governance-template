"""Cache the public, pinned routing encoder; never change to another model."""
import argparse
import json
import os
from pathlib import Path
from huggingface_hub import snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError
from sentence_transformers import SentenceTransformer

MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
REVISION = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
FILES = ['config.json','modules.json','sentence_bert_config.json','config_sentence_transformers.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','sentencepiece.bpe.model','1_Pooling/config.json','model.safetensors']
parser=argparse.ArgumentParser()
parser.add_argument('--codex-home',default=os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))
args=parser.parse_args()
cache=str(Path(args.codex_home)/'tools/embedding-models')
options=dict(repo_id=MODEL,revision=REVISION,cache_dir=cache,allow_patterns=FILES,token=False)
try:
    location=snapshot_download(**options,local_files_only=True)
    if any(not (Path(location)/name).is_file() or not (Path(location)/name).stat().st_size for name in FILES):
        raise LocalEntryNotFoundError('Encoder snapshot is incomplete')
except LocalEntryNotFoundError:
    location=snapshot_download(**options)
# GraphToolCall restores providers by model ID. Keep that ID's main alias in
# this private routing cache pinned too, rather than depending on a global HF
# cache or silently loading a different revision during offline restoration.
model_cache=Path(location).parent.parent
assert model_cache.resolve().is_relative_to(Path(cache).resolve())
references=model_cache/'refs'
references.mkdir(exist_ok=True)
(references/'main').write_text(REVISION,encoding='utf-8')
encoder=SentenceTransformer(location,device='cpu',local_files_only=True,trust_remote_code=False)
assert encoder.get_sentence_embedding_dimension()==384
print(json.dumps({'model':MODEL,'revision':REVISION,'cache':location,'dimensions':384}))
