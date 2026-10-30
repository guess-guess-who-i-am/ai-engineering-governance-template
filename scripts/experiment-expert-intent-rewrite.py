#!/usr/bin/env python3
"""Local intent extraction ablation, without expert names or target labels."""
import argparse
import json
import os
from pathlib import Path
import resource
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
    os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--traces',nargs='+',type=Path,required=True)
    ap.add_argument('--model',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True)
    ap.add_argument('--limit',type=int)
    args=ap.parse_args()
    import torch
    from transformers import AutoTokenizer,AutoModelForCausalLM
    torch.set_num_threads(1)
    tokenizer=AutoTokenizer.from_pretrained(str(args.model),padding_side='left',local_files_only=True)
    model=AutoModelForCausalLM.from_pretrained(str(args.model),dtype=torch.float16,
        attn_implementation='sdpa',local_files_only=True).to('mps').eval()
    instruction=('Rewrite the user request as one concise English search query describing the '
        'professional capabilities needed to perform it. Identify the intended action and '
        'underlying problem, preserve domain and constraints, and avoid overemphasizing incidental '
        'business objects. Do not answer the request or invent details. Output only the search query.')
    cases=[r for f in args.traces for r in json.loads(f.read_text())['rows'] if r['kind']=='expert']
    if args.limit:cases=cases[:args.limit]
    rows=[]
    with torch.inference_mode():
        for case in cases:
            prompt=tokenizer.apply_chat_template([{'role':'system','content':instruction},
                {'role':'user','content':case['query']}],tokenize=False,add_generation_prompt=True,
                enable_thinking=False)
            inputs=tokenizer(prompt,return_tensors='pt').to('mps')
            start=time.perf_counter()
            result=model.generate(**inputs,max_new_tokens=64,do_sample=False,
                pad_token_id=tokenizer.eos_token_id)
            torch.mps.synchronize()
            output=tokenizer.decode(result[0,inputs.input_ids.shape[1]:],skip_special_tokens=True).strip()
            row={k:case[k] for k in ('set','case','language','query')}
            row.update({'rewrite':output,'ms':(time.perf_counter()-start)*1000,
                'inputTokens':inputs.input_ids.shape[1],
                'outputTokens':result.shape[1]-inputs.input_ids.shape[1]})
            rows.append(row)
            args.report.write_text(json.dumps({'instruction':instruction,'model':str(args.model),
                'rows':rows,'productionChanged':False,'paidCalls':0,
                'peakRSSMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024/1024,
                'limitations':['Re-Invoke-inspired intent ablation, not a reproduction of its entire method.',
                    'No expert documents or relevance labels given to the rewriting model.']},ensure_ascii=False,indent=2)+'\n')
            print(json.dumps(row,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
