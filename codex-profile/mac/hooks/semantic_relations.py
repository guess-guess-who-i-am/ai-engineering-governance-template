"""Portable, source-checked semantic relationships; no model work at query time."""
import hashlib
import json
from pathlib import Path
import re

REVISION = 'source-grounded-semantic-relations/v1'


def identity(metadata, content_hash):
    """Machine paths are deliberately absent from the portable identity."""
    origin = metadata.get('module_id', '') or (Path(metadata['skill_path']).parent.name if metadata.get('skill_path') else '')
    value = [metadata.get('kind', 'skill'), metadata.get('skill_name', metadata.get('mcp_original_name', '')),
             origin, metadata.get('mcp_server', '') if metadata.get('kind') == 'mcp' else '', content_hash]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False).encode()).hexdigest()


def tool_source(tool):
    metadata = tool.metadata or {}
    if metadata.get('skill_path'):
        raw = Path(metadata['skill_path']).read_bytes()
    else:
        # Native MCP identity includes the complete advertised schemas.
        raw = json.dumps(metadata.get('mcp', {}), sort_keys=True, ensure_ascii=False).encode()
    return raw, source_digest(metadata, raw)


def source_digest(metadata, raw):
    """Hash every byte; canonicalize only generated expert location headers.

    Original role bytes, declared role hash and all adapter instructions remain
    hash inputs. A different machine root alone must not erase verified edges.
    """
    root=metadata.get('package_root','')
    primary=metadata.get('retrieval_provenance',{}).get('primary_path','')
    if metadata.get('kind')=='expert' and root and primary and b'[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]' in raw:
        prefix=f'Package root: {root}\nOriginal primary role: {root}/{primary}\n'.encode()
        if raw.count(prefix)!=1:raise ValueError('Expert location header disagrees with metadata')
        raw=raw.replace(prefix,f'Package root: $PACKAGE\nOriginal primary role: $PACKAGE/{primary}\n'.encode(),1)
    return hashlib.sha256(raw).hexdigest()


def declarations(text):
    """Retain natural-language IO declarations, nested lists and table rows.

    This is an evidence collector, not an assertion of semantic compatibility.
    Every source line is visited; absent declarations stay explicitly absent.
    """
    roles, stack = {'inputs': [], 'outputs': []}, []
    fence = None
    lines = text.splitlines()
    in_frontmatter = bool(lines and lines[0].lstrip('\ufeff').strip() == '---')
    for number, line in enumerate(lines, 1):
        if in_frontmatter:
            if number > 1 and line.strip() == '---': in_frontmatter = False
            continue
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            if fence is None: fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence): fence = None
            continue
        if fence: continue
        heading = re.match(r'^\s*(#{1,6})\s+(.+?)\s*#*\s*$', line)
        if heading:
            depth, title = len(heading[1]), heading[2]
            while stack and stack[-1][0] >= depth: stack.pop()
            incoming = bool(re.search(r'\b(inputs?|consumes?|prerequisites?)\b|输入|前置产物', title, re.I))
            outgoing = bool(re.search(r'\b(outputs?|produces?|deliverables?|artifacts?)\b|输出|交付产物', title, re.I))
            role = 'inputs' if incoming and not outgoing else 'outputs' if outgoing and not incoming else None
            blocked = bool(re.search(r'\b(examples?|samples?)\b|示例|例如', title, re.I))
            stack.append((depth, role, blocked))
            continue
        if not line.strip() or re.match(r'^\s*\|?[\s:|-]+\|\s*$', line): continue
        if any(s[2] for s in stack): continue
        # Keep conditional declarations as text: the semantic verifier must
        # distinguish optional context from a produced artifact.
        label = re.match(r'^\s*(?:[-*+]\s*)?(?:\*\*)?(inputs?|outputs?|produces|consumes|输入|输出)(?:\*\*)?\s*[:：]', line, re.I)
        if label:
            role = 'inputs' if re.search(r'input|consum|输入', label[1], re.I) else 'outputs'
        else:
            role = next((s[1] for s in reversed(stack) if s[1]), None)
        if role:
            roles[role].append({'line': number, 'text': line.strip()})
    return roles


def apply_semantic_relations(graph, file=None):
    file = Path(file) if file else Path(__file__).with_name('semantic-relations.json')
    if not file.exists():
        return {'revision': REVISION, 'state': 'not-built', 'processed': 0, 'added': 0}
    document = json.loads(file.read_text())
    if document.get('schemaVersion') != REVISION:
        raise ValueError('Invalid semantic relationship registry')
    if document.get('verification',{}).get('complete') is not True:
        raise ValueError('Semantic relationships require complete blind verification')
    names, raw_sources = {}, {}
    matched, stale = 0, []
    for name, tool in graph.tools.items():
        path = (tool.metadata or {}).get('skill_path')
        key = path or name
        if key not in raw_sources: raw_sources[key] = tool_source(tool)
        raw, digest = raw_sources[key]
        identifier = identity(tool.metadata, digest)
        if identifier in names: raise ValueError('Ambiguous semantic tool identity')
        names[identifier] = name
        annotation = document['nodes'].get(identifier)
        if annotation:
            matched += 1
            tool.metadata['semantic_contract'] = annotation
        else:
            stale.append(name)
    added = 0
    priorities={'precedes':0,'complementary':1,'similar_to':2}
    for edge in sorted(document['edges'], key=lambda e: priorities.get(e['relation'],3)):
        source, target = names.get(edge['source']), names.get(edge['target'])
        if not source or not target: continue
        if source == target or edge['relation'] not in ('similar_to', 'precedes', 'complementary'):
            raise ValueError('Invalid semantic relation')
        if graph.graph.has_edge(source, target): continue
        graph.add_relation(source, target, edge['relation'], confidence='INFERRED',
                           layer=2, evidence=edge['reason'])
        attrs = graph.graph.get_edge_attrs(source, target)
        attrs['semantic_evidence'] = {k: edge[k] for k in ('sourceQuote', 'targetQuote', 'reason', 'relation')}
        attrs['candidate_similarity'] = edge.get('candidateSimilarity',0)
        graph.graph.add_edge(source, target, **attrs)
        added += 1
    report = {'revision': REVISION, 'state': 'ready' if not stale else 'needs-rebuild',
              'processed': matched, 'unmatched': len(stale), 'added': added,
              'registrySha256': hashlib.sha256(file.read_bytes()).hexdigest()}
    graph.metadata['semantic_relations'] = report
    return report


def attach_semantic_links(records, identifiers, graph):
    """Fair one-per-entry hints use the existing candidate count as budget."""
    for record, identifier in zip(records, identifiers):
        candidates = []
        for source, target, attrs in graph.graph.get_edges_from(identifier, direction='both'):
            evidence = attrs.get('semantic_evidence')
            if not evidence: continue
            partner = target if source == identifier else source
            tool = graph.tools.get(partner)
            if not tool: continue
            metadata = tool.metadata or {}
            candidates.append({'name': metadata.get('skill_name', metadata.get('mcp_original_name', partner)),
                'path': metadata.get('skill_path', ''), 'kind': metadata.get('kind', 'skill'),
                'mcp_server': metadata.get('mcp_server', ''), 'relation': attrs['relation'],
                'candidate_similarity': attrs.get('candidate_similarity',0),
                'direction': 'downstream' if source == identifier else 'upstream', 'evidence': evidence})
        if candidates:
            candidates.sort(key=lambda c: (c['relation'] == 'similar_to', -c['candidate_similarity'], c['name'], c['path']))
            record['semantic_links'] = candidates[:1]
