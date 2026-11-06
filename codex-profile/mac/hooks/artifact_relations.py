"""Offline, source-grounded artifact contracts for the global tool graph.

Read declarations, never execute package content. Free-form narrative, examples,
negated statements and format-only matches do not establish workflow edges.
"""
from collections import defaultdict
import hashlib
from pathlib import Path, PurePosixPath
import re

REVISION = 'explicit-artifact-contracts/v1'
_EXTENSIONS = r'md|json|jsonl|csv|tsv|yaml|yml|html|pdf|docx|pptx|xlsx|png|svg|parquet|h5ad|rds|txt'
_FILE = re.compile(r'(?<![\w.])([\w./-]+\.(?:' + _EXTENSIONS + r'))(?![\w.])', re.I)
_GENERIC = {'readme', 'skill', 'agents', 'input', 'inputs', 'output', 'outputs', 'result', 'results',
            'report', 'reports', 'data', 'dataset', 'file', 'document', 'example', 'sample',
            'config', 'configuration', 'index', 'metadata', 'notes', 'template',
            'findings', 'context', 'review', 'changes', 'features', 'product', 'plugin', 'package-lock', 'package',
            'plan', 'spec', 'task', 'tasks', 'research', 'queries', 'decisions', 'goal', 'state', 'manifest'}
_INPUT = re.compile(r'\b(?:inputs?|consumes?|prerequisites?)\b|输入|前置产物', re.I)
_OUTPUT = re.compile(r'\b(?:outputs?|produces?|deliverables?|artifacts?)\b|输出|交付产物', re.I)
_EXAMPLE = re.compile(r'\b(?:examples?|samples?|optional|suggested)\b|示例|例如|可选|建议', re.I)
_NEGATIVE = re.compile(r"\b(?:not|never|don.t|avoid|unless|may|might|could|prefer)\b|不要|不能|不应|除非|可以|可选", re.I)
_HEADING = re.compile(r'^\s*(#{1,6})\s+(.+?)\s*#*\s*$')


def artifact_key(value):
    value = str(value).strip().replace('\\', '/')
    if not _FILE.fullmatch(value) or value.startswith(('/', '../', '~')) or '..' in value.split('/'):
        return None
    path = PurePosixPath(value)
    if path.stem.casefold() in _GENERIC:
        return None
    # Basenames are matched only literally. A shared extension is no contract.
    return str(path)


def document_contracts(text, source, source_sha256=None):
    """Extract named files only from unambiguous input/output declarations."""
    digest = source_sha256 or hashlib.sha256(text.encode()).hexdigest()
    rows = {'produces': [], 'consumes': []}
    sections = []
    fence = False
    frontmatter = text.lstrip('\ufeff').startswith('---\n')
    seen = set()
    for number, line in enumerate(text.splitlines(), 1):
        if frontmatter:
            if number > 1 and line.strip() == '---':
                frontmatter = False
            continue
        if re.match(r'^\s*(`{3,}|~{3,})', line):
            fence = not fence
            continue
        if fence:
            continue
        heading = _HEADING.match(line)
        if heading:
            depth, title = len(heading[1]), heading[2]
            while sections and sections[-1][0] >= depth:
                sections.pop()
            incoming, outgoing = bool(_INPUT.search(title)), bool(_OUTPUT.search(title))
            role = 'consumes' if incoming and not outgoing else 'produces' if outgoing and not incoming else None
            sections.append((depth, role, bool(_EXAMPLE.search(title))))
            continue
        if _NEGATIVE.search(line):
            continue
        # A local explicit label overrides the surrounding section, e.g. an
        # Input line inside Output Contract must never become a producer.
        label = re.match(r'^\s*(?:[-*+]\s*)?(?:\*\*)?((?:(?:required|expected|core|primary)\s+)?(?:inputs?|outputs?|produces|consumes|deliverables?)|输入|输出)(?:\*\*)?\s*[:：](?:\*\*)?', line, re.I)
        role = None
        if label:
            incoming, outgoing = bool(_INPUT.search(label[1])), bool(_OUTPUT.search(label[1]))
            if incoming != outgoing:
                role = 'consumes' if incoming else 'produces'
        if role is None and sections:
            role = sections[-1][1]
        if role is None or any(s[2] for s in sections):
            continue
        # Treat only the first named deliverable, not incidental mentions in
        # prose, tables, conditions or parenthetical inputs, as a declaration.
        declaration = line[label.end():] if label and role else re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)', '', line)
        declaration = declaration.strip().lstrip('*').strip()
        if declaration.startswith('`'):
            declaration = declaration[1:]
        elif not label:
            continue
        match = _FILE.match(declaration)
        if match is None:
            continue
        for match in [match]:
            key = artifact_key(match[1])
            if key is None or (role, key) in seen:
                continue
            # Package references do not describe task artifacts.
            if key.startswith(('references/', 'scripts/', 'assets/')):
                continue
            seen.add((role, key))
            rows[role].append({'field_name': key, 'type': 'string', 'semantic_tag': key,
                               'required': False, 'source': 'skill-declaration',
                               'evidence': {'path': str(source), 'line': number, 'sha256': digest}})
    return rows


def enrich_artifact_relations(graph):
    """Index declarations once, join exact artifact identities, add PRECEDES.

    These edges express a possible producer/consumer pairing, never a mandatory
    dependency or permission to execute it. Existing REQUIRES edges win.
    """
    documents = {}
    producers, consumers = defaultdict(list), defaultdict(list)
    errors = []
    sources = {}
    for name, tool in graph.tools.items():
        path = (tool.metadata or {}).get('skill_path', '')
        if path:
            try:
                resolved = Path(path).resolve(strict=True)
                if resolved not in documents:
                    raw = resolved.read_bytes()
                    digest = hashlib.sha256(raw).hexdigest()
                    documents[resolved] = (document_contracts(raw.decode('utf-8-sig'), resolved, digest), digest)
                contract, digest = documents[resolved]
                sources[str(resolved)] = digest
            except (OSError, UnicodeError) as exc:
                errors.append({'tool': name, 'error': type(exc).__name__})
                continue
            if any(contract.values()):
                tool.metadata['artifact_contract'] = contract
        else:
            # Native MCP metadata is supplied by GraphToolCall's IO builder.
            contract = (tool.metadata or {}).get('api_contract', {})
        for role, index in [('produces', producers), ('consumes', consumers)]:
            for row in contract.get(role, []):
                key = artifact_key(row.get('semantic_tag') or row.get('field_name', ''))
                if not key and not path:
                    from graph_tool_call.core.contract_matching import canonical_field_key, is_identifier_like
                    field = row.get('field_name', '')
                    if is_identifier_like(field):
                        server = tool.metadata.get('mcp_server', '')
                        field_type = row.get('type', row.get('field_type', ''))
                        if server and field_type:
                            key = f'mcp:{server}:{canonical_field_key(field)}:{field_type}'
                            row = {**row, 'evidence': {'server': server, 'field': field,
                                   'schema': 'outputSchema' if role == 'produces' else 'inputSchema'}}
                if key:
                    index[key].append((name, row))
    linked = 0
    ambiguous = []
    for artifact in sorted(producers.keys() & consumers.keys()):
        output = producers[artifact]
        # Multiple versions/modules may mirror the same source. A unique
        # physical producer entry is necessary; different producers are held
        # for review rather than expanded into a dense bipartite graph.
        identities = {str(Path(graph.tools[n].metadata.get('skill_path') or n).resolve()) for n, _ in output}
        if len(identities) != 1:
            ambiguous.append({'artifact': artifact, 'producerCount': len(output)})
            continue
        for producer, out in output:
            for consumer, inp in consumers[artifact]:
                if producer == consumer:
                    continue
                producer_path = graph.tools[producer].metadata.get('skill_path')
                consumer_path = graph.tools[consumer].metadata.get('skill_path')
                if producer_path and consumer_path and Path(producer_path).resolve() == Path(consumer_path).resolve():
                    continue
                if graph.graph.has_edge(producer, consumer):
                    continue
                evidence = {'artifact': artifact, 'producer': out.get('evidence'), 'consumer': inp.get('evidence')}
                # PRECEDES is a native graph traversal relation; using REQUIRES
                # would incorrectly claim this is the only way to get the file.
                graph.add_relation(producer, consumer, 'precedes', confidence='INFERRED',
                                   layer=2, evidence=f'{REVISION}: exact artifact {artifact}')
                attrs = graph.graph.get_edge_attrs(producer, consumer)
                attrs['artifact_evidence'] = evidence
                graph.graph.add_edge(producer, consumer, **attrs)
                linked += 1
    report = {'revision': REVISION, 'documentsRead': len(documents),
              'producerDeclarations': sum(map(len, producers.values())),
              'consumerDeclarations': sum(map(len, consumers.values())),
              'edgesAdded': linked, 'ambiguousArtifacts': ambiguous, 'readErrors': errors}
    graph.metadata['artifact_relation_sources'] = sources
    graph.metadata['artifact_relations'] = report
    return report


def attach_artifact_links(records, identifiers, graph):
    """Expose one-hop evidence conditional on choosing a retrieved entry.

    Reuse the existing result budget; do not alter scores, primary candidates,
    or execute a neighbor. No package content is opened at query time.
    """
    remaining = len(records)
    for record, identifier in zip(records, identifiers):
        links = []
        for source, target, attrs in sorted(graph.graph.get_edges_from(identifier, direction='both'),
                                            key=lambda edge: (edge[0], edge[1])):
            evidence = attrs.get('artifact_evidence')
            if not evidence or remaining <= 0:
                continue
            partner = target if source == identifier else source
            tool = graph.tools.get(partner)
            if tool is None:
                continue
            metadata = tool.metadata or {}
            links.append({'name':metadata.get('skill_name', metadata.get('mcp_original_name', partner)),
                          'path':metadata.get('skill_path',''), 'kind':metadata.get('kind','skill'),
                          'mcp_server':metadata.get('mcp_server',''),
                          'artifact':evidence['artifact'],
                          'direction':'downstream' if source == identifier else 'upstream',
                          'confidence':'INFERRED',
                          'evidence':evidence})
            remaining -= 1
        if links:
            record['artifact_links'] = links
