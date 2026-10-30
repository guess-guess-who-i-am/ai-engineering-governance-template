#!/usr/bin/env python3
"""Offline source-only bilingual query expansion; no benchmark input is read."""
import argparse
import json
import os
from pathlib import Path
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
    os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--sources',type=Path,required=True)
    ap.add_argument('--model',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True)
    ap.add_argument('--batch-size',type=int,default=8)
    args=ap.parse_args()
    import torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    torch.set_num_threads(1)
    tokenizer=AutoTokenizer.from_pretrained(str(args.model),padding_side='left',local_files_only=True)
    model=AutoModelForCausalLM.from_pretrained(str(args.model),dtype=torch.float16,
        attn_implementation='sdpa',local_files_only=True).to('mps').eval()
    sources=[x for x in json.loads(args.sources.read_text()) if not x.get('error')]
    instruction=('Using only the expert role below, write ONE realistic short user request that the '
        'role can fulfill, followed by the SAME request in Chinese. Describe a concrete problem '
        'and desired action; do not name the expert or add unsupported capabilities. '
        'English <=25 words, Chinese <=50 characters. Output exactly two lines: EN: ... and ZH: ...')
    rows=[];began=time.perf_counter()
    with torch.inference_mode():
        for offset in range(0,len(sources),args.batch_size):
            batch=sources[offset:offset+args.batch_size]
            prompts=[tokenizer.apply_chat_template([{'role':'system','content':instruction},
                {'role':'user','content':x['primary']+'\n'+x['intro']}],tokenize=False,
                add_generation_prompt=True,enable_thinking=False) for x in batch]
            inputs=tokenizer(prompts,return_tensors='pt',padding=True).to('mps')
            start=time.perf_counter()
            output=model.generate(**inputs,max_new_tokens=144,do_sample=False,
                pad_token_id=tokenizer.eos_token_id)
            torch.mps.synchronize()
            texts=tokenizer.batch_decode(output[:,inputs.input_ids.shape[1]:],skip_special_tokens=True)
            for source,text in zip(batch,texts):
                rows.append({'id':source['id'],'name':source['name'],'primarySha256':source['primarySha256'],
                    'generated':text.strip()})
            args.report.write_text(json.dumps({'instruction':instruction,'model':str(args.model),'rows':rows,
                'seconds':time.perf_counter()-began,'productionChanged':False,'paidCalls':0,
                'limitations':['Synthetic retrieval hints, not verified capability declarations.',
                    'Only source roles supplied; no benchmark queries or relevance labels.']},ensure_ascii=False,indent=2)+'\n')
            print(json.dumps({'done':len(rows),'batchSeconds':time.perf_counter()-start,'totalSeconds':time.perf_counter()-began}),flush=True)


if __name__=='__main__':main()
