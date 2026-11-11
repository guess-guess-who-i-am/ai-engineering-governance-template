"""Full token coverage with window-mean embeddings for the MiniLM encoders."""
import numpy as np
import torch
from collections import OrderedDict

REPRESENTATION = 'complete-token-pcw-mean/v1'


def complete_provider(provider, *, cache_windows=False):
    """Keep GraphToolCall's native provider identity and model configuration."""
    if cache_windows and not hasattr(provider, '_complete_window_cache'):
        provider._complete_window_cache = OrderedDict()
    if not getattr(provider, '_complete_token_encoding', False) or cache_windows:
        provider.encode_batch = lambda texts: encode_complete(provider._get_model(), texts,
            window_cache=getattr(provider, '_complete_window_cache', None)).tolist()
        provider._complete_token_encoding = True
    return provider


def encode_complete(model, texts, batch_size=64, audit=None, window_cache=None):
    """Encode every source token; keep one normalized vector per input.

    Implements the unweighted PCW mean baseline from LongEmbed. Expert/tool
    identity remains at document level, with no extra routable graph nodes.
    """
    tokenizer = model.tokenizer
    limit = model.max_seq_length
    special = tokenizer.num_special_tokens_to_add(pair=False)
    if special != 2 or tokenizer('', truncation=False)['input_ids'] != [
            tokenizer.cls_token_id, tokenizer.sep_token_id]:
        raise ValueError('Encoder must use the verified CLS/text/SEP template')
    width = limit - special
    if width <= 0:
        raise ValueError('Encoder has no content-token budget')
    rows = []
    counts = {'documents': len(texts), 'chunks': 0, 'sourceTokens': 0,
              'coveredTokens': 0, 'overLimitDocuments': 0, 'maxSourceTokens': 0,
              'maxChunkTokens': 0}
    model.eval()
    for start in range(0, len(texts), batch_size):
        source = texts[start:start+batch_size]
        bare = tokenizer(source, add_special_tokens=False, truncation=False,
                         padding=False)['input_ids']
        windows, owners, actual = [], [], []
        for owner, ids in enumerate(bare):
            counts['sourceTokens'] += len(ids)
            counts['maxSourceTokens'] = max(counts['maxSourceTokens'], len(ids)+special)
            counts['overLimitDocuments'] += int(len(ids)+special > limit)
            for offset in range(0, max(1, len(ids)), width):
                piece = ids[offset:offset+width]
                window = [tokenizer.cls_token_id, *piece, tokenizer.sep_token_id]
                windows.append(window)
                owners.append(owner)
                actual.append(len(piece))
                counts['maxChunkTokens'] = max(counts['maxChunkTokens'], len(window))
        counts['coveredTokens'] += sum(actual)
        counts['chunks'] += len(windows)
        values = []
        with torch.inference_mode():
            for offset in range(0, len(windows), batch_size):
                batch = windows[offset:offset+batch_size]
                if window_cache is not None:
                    # Model and cache are owned by one immutable provider.
                    # Include the original padding width and every token ID.
                    # Reuse independent windows; always recompute changed ones.
                    keys = [(max(map(len, batch)), tuple(window)) for window in batch]
                    missing = [key for key in keys if key not in window_cache]
                    if missing:
                        features = tokenizer.pad({'input_ids': [list(key[1]) for key in missing]},
                            padding='max_length', max_length=keys[0][0], return_tensors='pt')
                        features = {key: value.to(model.device) for key, value in features.items()}
                        output = model(features)['sentence_embedding']
                        computed = torch.nn.functional.normalize(output.float(), dim=1).cpu().numpy()
                        fresh = dict(zip(missing, computed))
                    else:
                        fresh = {}
                    values.append(np.stack([fresh[key] if key in fresh else window_cache[key] for key in keys]))
                    for key in keys:
                        window_cache[key] = fresh[key] if key in fresh else window_cache[key]
                        window_cache.move_to_end(key)
                    while len(window_cache) > 512:
                        window_cache.popitem(last=False)
                    continue
                features = tokenizer.pad({'input_ids': batch}, padding=True, return_tensors='pt')
                features = {key: value.to(model.device) for key, value in features.items()}
                output = model(features)['sentence_embedding']
                values.append(torch.nn.functional.normalize(output.float(), dim=1).cpu().numpy())
        vectors = np.concatenate(values)
        pooled = np.zeros((len(source), vectors.shape[1]), dtype=np.float32)
        np.add.at(pooled, owners, vectors)
        pooled /= np.bincount(owners, minlength=len(source))[:, None]
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if np.any(norms == 0) or not np.isfinite(pooled).all():
            raise ValueError('Invalid complete document vector')
        rows.append(pooled / norms)
    if counts['sourceTokens'] != counts['coveredTokens']:
        raise AssertionError('Incomplete source-token coverage')
    if audit is not None:
        audit.update(counts)
    return np.concatenate(rows) if rows else np.empty(
        (0, model.get_sentence_embedding_dimension()), dtype=np.float32)
