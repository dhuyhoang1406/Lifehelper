"""Strict Gemini review output contract; development tooling only."""
import json

SEVERITIES = ('critical', 'high', 'medium', 'low')
FINDING_FIELDS = ('severity', 'file', 'line', 'title', 'detail', 'suggestion')
REVIEW_SCHEMA = {
    'type': 'object',
    'properties': {
        'summary': {'type': 'string'},
        'findings': {'type': 'array', 'maxItems': 30, 'items': {
            'type': 'object',
            'properties': {
                'severity': {'type': 'string', 'enum': list(SEVERITIES)},
                'file': {'type': 'string'},
                'line': {'type': ['integer', 'null']},
                'title': {'type': 'string'},
                'detail': {'type': 'string'},
                'suggestion': {'type': 'string'},
            },
            'required': list(FINDING_FIELDS),
            'additionalProperties': False,
        }},
    },
    'required': ['summary', 'findings'],
    'additionalProperties': False,
}


def generation_config():
    return {'temperature': 0.2, 'maxOutputTokens': 8192,
            'responseMimeType': 'application/json', 'responseJsonSchema': REVIEW_SCHEMA}


def parse_review_response(data, valid_lines):
    """Accept a completed final answer, never a thought, truncation or malformed review.

    Errors contain safe fixed messages: do not echo provider content into PRs/logs.
    Location-less findings are permitted only within supplied diff file paths.
    """
    candidates = data.get('candidates') if isinstance(data, dict) else None
    if not isinstance(candidates, list) or len(candidates) != 1:
        raise ValueError('Expected one review candidate')
    candidate = candidates[0]
    if not isinstance(candidate, dict) or candidate.get('finishReason') != 'STOP':
        raise ValueError('Review response did not finish normally')
    content = candidate.get('content')
    parts = content.get('parts') if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise ValueError('Missing final review parts')
    text = ''.join(part['text'] for part in parts
                   if isinstance(part, dict) and not part.get('thought', False)
                   and isinstance(part.get('text'), str))
    try:
        review = json.loads(text)
    except (ValueError, TypeError):
        raise ValueError('Final review was not valid JSON') from None
    if not isinstance(review, dict) or set(review) != {'summary', 'findings'}:
        raise ValueError('Invalid review object')
    if not isinstance(review['summary'], str) or not review['summary'].strip():
        raise ValueError('Missing review summary')
    findings = review['findings']
    if not isinstance(findings, list) or len(findings) > 30:
        raise ValueError('Invalid findings list')
    for finding in findings:
        if not isinstance(finding, dict) or set(finding) != set(FINDING_FIELDS):
            raise ValueError('Invalid finding fields')
        if finding['severity'] not in SEVERITIES:
            raise ValueError('Invalid finding severity')
        for key in ('file', 'title', 'detail', 'suggestion'):
            if not isinstance(finding[key], str) or not finding[key].strip():
                raise ValueError('Missing finding text')
        if finding['file'] not in valid_lines:
            raise ValueError('Finding references a file outside the supplied diff')
        line = finding['line']
        if line is not None and (type(line) is not int or line not in valid_lines[finding['file']]):
            raise ValueError('Finding references a line outside the supplied diff')
    return review


def bounded_diff(numbered_lines, limit=60000):
    """Keep whole numbered lines and validate only locations actually supplied."""
    shown = []
    used = 0
    valid = {}
    for line in numbered_lines:
        cost = len(line) + (1 if shown else 0)
        if used + cost > limit:
            break
        prefix = line.split('\t', 1)[0]
        path, number, _empty = prefix.rsplit(':', 2)
        valid.setdefault(path, []).append(int(number))
        shown.append(line)
        used += cost
    coverage = {'truncated': len(shown) != len(numbered_lines),
                'reviewedLines': len(shown), 'totalLines': len(numbered_lines)}
    text = '\n'.join(shown)
    if coverage['truncated']:
        text += '\n... (numbered diff truncated; review coverage is partial)'
    return text, valid, coverage
