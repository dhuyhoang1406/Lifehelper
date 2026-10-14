"""Local Phase 5 verification. Python 3.11+, Docker Compose, pnpm; no Python packages.
Only newly-created random databases/buckets are eligible for cleanup.
"""
import argparse
import base64
import hashlib
import hmac
import http.server
import json
import math
import os
import platform
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def command(args, **kwargs):
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def inspect(container):
    return json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]


def environment(container):
    return dict(value.split('=', 1) for value in inspect(container)['Config']['Env'])


def distribution(values):
    values = sorted(values)
    if not values:
        return {'n': 0, 'p50Ms': None, 'p95Ms': None}
    return {'n': len(values), 'p50Ms': round(values[math.ceil(len(values) * .5) - 1], 2),
            'p95Ms': round(values[math.ceil(len(values) * .95) - 1], 2)}


def words(text):
    text = ''.join(c for c in unicodedata.normalize('NFD', text.lower())
                   if unicodedata.category(c) != 'Mn').replace('đ', 'd')
    return set(re.findall(r'\w+', text))


def lexical(query, documents, top_k):
    query_words = words(query)
    # Jaccard over normalized word sets; ties use fixture ID, never expected labels.
    return [doc['id'] for doc in sorted(documents, key=lambda doc: (
        -len(query_words & words(doc['text'])) / max(1, len(query_words | words(doc['text']))), doc['id']))[:top_k]]


class EmbeddingProxy:
    """Test-only fault injection; never stops the application's Ollama container."""
    def __init__(self, upstream):
        self.offline = False
        self.failures = 0
        proxy = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def do_GET(self):
                self.forward()
            def do_POST(self):
                self.forward()
            def forward(self):
                if proxy.offline and self.path == '/api/embed':
                    proxy.failures += 1
                    self.send_response(503)
                    self.end_headers()
                    self.wfile.write(b'{"error":"synthetic unavailable"}')
                    return
                size = int(self.headers.get('Content-Length', '0'))
                if size > 2_000_000:
                    self.send_error(413)
                    return
                data = self.rfile.read(size) if size else None
                request = urllib.request.Request(upstream + self.path, data=data,
                    headers={'Content-Type': 'application/json'}, method=self.command)
                try:
                    response = urllib.request.urlopen(request, timeout=120)
                except urllib.error.HTTPError as error:
                    response = error
                except OSError:
                    self.send_error(502)
                    return
                with response:
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(response.read())
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class Server:
    def __init__(self, service, env):
        self.metrics = []
        self.failure = None
        self.ready = queue.Queue()
        self.process = subprocess.Popen(['node', 'scripts/document-rag-server.cjs', service],
                                        cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True)
        def read():
            for line in self.process.stdout:
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if event.get('type') == 'startup_error':
                    self.failure = event['message']
                if event.get('type') == 'ready':
                    self.ready.put(event['port'])
                elif event.get('type') == 'metric':
                    self.metrics.append(event)
            self.ready.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def origin(self):
        port = self.ready.get(timeout=40)
        if not port:
            raise RuntimeError('Verification service exited before readiness: ' + str(self.failure))
        return 'http://127.0.0.1:' + str(port)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        self.reader.join(timeout=2)
        self.process.stdout.close()


class Resources:
    def __init__(self):
        self.tag = uuid.uuid4().hex[:12]
        self.pg = os.environ.get('VERIFY_POSTGRES_CONTAINER', 'lifehelper-postgres-1')
        self.s3 = os.environ.get('VERIFY_LOCALSTACK_CONTAINER', 'lifehelper-localstack-1')
        self.pg_env = environment(self.pg)
        self.databases = []
        self.buckets = []
        self.servers = []

    def sql(self, query, database='postgres'):
        return subprocess.check_output(['docker', 'exec', self.pg, 'psql', '-U',
            self.pg_env['POSTGRES_USER'], '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', query]).decode().strip()

    def database(self, service):
        if service not in ['document', 'ai', 'productivity']:
            raise ValueError('Unknown verification service')
        name = 'rag_' + self.tag + '_' + service + '_test'
        self.sql('CREATE DATABASE "' + name + '"')
        self.databases.append(name)  # Only register after CREATE succeeds.
        credentials = ':'.join(urllib.parse.quote(self.pg_env[k], safe='')
                               for k in ['POSTGRES_USER', 'POSTGRES_PASSWORD'])
        return 'postgresql://' + credentials + '@127.0.0.1:' + os.environ.get('VERIFY_POSTGRES_PORT', '55432') + '/' + name

    def aws(self, *args):
        raw = subprocess.check_output(['docker', 'exec', self.s3, 'awslocal', 's3api', *args, '--output', 'json'])
        return json.loads(raw) if raw.strip() else {}

    def bucket(self, region):
        name = 'lifehelper-rag-' + self.tag
        args = ['create-bucket', '--bucket', name, '--region', region]
        if region != 'us-east-1':
            args += ['--create-bucket-configuration', json.dumps({'LocationConstraint': region})]
        self.aws(*args)
        self.buckets.append(name)
        self.aws('put-bucket-versioning', '--bucket', name, '--versioning-configuration', '{"Status":"Enabled"}')
        self.aws('put-public-access-block', '--bucket', name, '--public-access-block-configuration', json.dumps({
            k: True for k in ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']}))
        return name

    def close(self):
        errors = []
        for server in reversed(self.servers):
            try:
                server.close()
            except Exception as error:
                errors.append(error)
        for name in reversed(self.buckets):
            try:
                # Pages are drained by deletion; never list or delete another bucket.
                for _ in range(100):
                    listing = self.aws('list-object-versions', '--bucket', name, '--max-keys', '500', '--no-paginate')
                    objects = [{'Key': v['Key'], 'VersionId': v['VersionId']}
                               for v in listing.get('Versions', []) + listing.get('DeleteMarkers', [])]
                    if not objects:
                        break
                    result = self.aws('delete-objects', '--bucket', name, '--delete', json.dumps({'Objects': objects}))
                    if result.get('Errors'):
                        raise RuntimeError('Owned bucket version cleanup failed')
                self.aws('delete-bucket', '--bucket', name)
            except Exception as error:
                errors.append(error)
        for name in reversed(self.databases):
            try:
                self.sql('DROP DATABASE "' + name + '" WITH (FORCE)')
            except Exception as error:
                errors.append(error)
        if errors:
            raise ExceptionGroup('Verification cleanup failed; inspect owned resources', errors)
        print('Cleanup complete: all owned test databases and buckets removed.', flush=True)


def token(user, env):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    now = int(time.time())
    body = b'.'.join([encode({'alg': 'HS256', 'typ': 'JWT'}), encode({
        'sub': user, 'sessionId': str(uuid.uuid4()), 'tokenType': 'access', 'iat': now,
        'exp': now + 3600, 'iss': env['JWT_ISSUER'], 'aud': env['JWT_AUDIENCE']})])
    return (body + b'.' + base64.urlsafe_b64encode(hmac.new(env['JWT_ACCESS_SECRET'].encode(), body, hashlib.sha256).digest()).rstrip(b'=')).decode()


class Evaluation:
    def __init__(self, resources, env, origin, ai_origin, report, max_wait, proxy):
        self.resources, self.env, self.origin, self.ai_origin = resources, env, origin, ai_origin
        self.report, self.max_wait = report, max_wait
        self.auth = token(str(uuid.uuid4()), env)
        self.foreign = token(str(uuid.uuid4()), env)
        self.latencies = {}
        self.ids = {}
        self.cases = []
        self.proxy = proxy

    def request(self, origin, path, body=None, method=None, auth=None, key=None, expected=200, stage=None):
        headers = {'Authorization': 'Bearer ' + (auth or self.auth), 'x-correlation-id': 'rag-eval-' + self.resources.tag}
        if key:
            headers['x-idempotency-key'] = key
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        start = time.monotonic()
        req = urllib.request.Request(origin + path, data=data, headers=headers, method=method or ('POST' if data is not None else 'GET'))
        try:
            with urllib.request.urlopen(req, timeout=self.max_wait) as response:
                code, raw = response.status, response.read()
                if response.headers.get('x-correlation-id') != headers['x-correlation-id']:
                    raise RuntimeError('HTTP correlation ID was not preserved')
        except urllib.error.HTTPError as error:
            code, raw = error.code, error.read()
        if stage:
            self.latencies.setdefault(stage, []).append((time.monotonic() - start) * 1000)
        result = json.loads(raw) if raw else None
        if code != expected:
            # Do not print tokens, signed URLs, request bodies or upstream error text.
            raise RuntimeError(path.split('?')[0] + ': expected HTTP ' + str(expected) + ', got ' + str(code) + ' code=' + str((result or {}).get('code', 'UNKNOWN')))
        return result

    def upload(self, fixture, pdf=False):
        data = fixture['text'].encode()
        if pdf:
            raw = subprocess.check_output(['node', 'scripts/document-rag-server.cjs', 'pdf'],
                cwd=ROOT, input=json.dumps([fixture['text']], ensure_ascii=False).encode())
            data = base64.b64decode(raw)
        filename = fixture['id'] + ('.pdf' if pdf else '.txt')
        mime = 'application/pdf' if pdf else 'text/plain'
        proposal = self.request(self.origin, '/documents/upload-url', {'filename': filename, 'mimeType': mime,
            'sizeBytes': len(data), 'checksumSha256': hashlib.sha256(data).hexdigest()}, expected=201)
        document = proposal['document']['id']
        self.ids[fixture['id']] = document
        upload = proposal['upload']
        boundary = '----Lifehelper' + uuid.uuid4().hex
        fields = [('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n').encode()
                  for k, v in upload['fields'].items()]
        fields += [('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode() + data + b'\r\n', ('--' + boundary + '--\r\n').encode()]
        with urllib.request.urlopen(urllib.request.Request(upload['url'], data=b''.join(fields), method='POST',
            headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}), timeout=30) as response:
            if response.status != 204:
                raise RuntimeError('Private upload rejected')
        self.request(self.origin, '/documents/' + document + '/upload-complete', {}, stage='upload_completion_http')
        return document

    def ready(self, document, generation=1):
        start = time.monotonic()
        while time.monotonic() - start < self.max_wait:
            row = self.request(self.origin, '/documents/' + document)
            if row['status'] == 'FAILED':
                raise RuntimeError('Indexing failed: ' + str(row['processingError']))
            if row['status'] == 'READY':
                chunks = self.request(self.origin, '/internal/documents/' + document + '/chunks')
                if chunks['items'] and chunks['items'][0]['generation'] == generation:
                    self.latencies.setdefault('processing_to_ready_wall', []).append((time.monotonic() - start) * 1000)
                    return
            time.sleep(.25)
        raise RuntimeError('Indexing exceeded configured evaluation wait budget')

    def run(self):
        fixtures = ROOT / 'apps/document-service/test/fixtures'
        corpus = json.loads((fixtures / 'vietnamese-retrieval.json').read_text())
        rag = json.loads((fixtures / 'vietnamese-rag.json').read_text())
        for fixture in corpus['documents'] + [rag['adversarial']]:
            document = self.upload(fixture, pdf=fixture['id'] == 'leave')
            self.ready(document)
            print('READY synthetic fixture:', fixture['id'], flush=True)
        if self.proxy is not None:
            # Force a genuine HTTP 503 at the embedding boundary; recover without restarting Ollama.
            self.proxy.offline = True
            offline = self.upload({'id': 'offline-recovery', 'text': 'Tài liệu kiểm tra phục hồi embedding.'})
            deadline = time.monotonic() + 30
            while self.proxy.failures == 0 and time.monotonic() < deadline:
                time.sleep(.1)
            if self.proxy.failures == 0:
                raise RuntimeError('Embedding outage was not exercised')
            # The failed attempt must not mark incomplete vectors READY.
            state = self.request(self.origin, '/documents/' + offline)
            if state['status'] == 'READY':
                raise RuntimeError('Embedding outage incorrectly produced READY')
            self.proxy.offline = False
            self.ready(offline)
            self.report['embeddingOfflineRecovery'] = 'controlled 503 then READY after recovery'
        mapping = {value: key for key, value in self.ids.items()}
        retrieval = []
        # Fixed scope excludes the deliberately duplicated adversarial leave passage.
        scope = [self.ids[doc['id']] for doc in corpus['documents']]
        for query in corpus['queries'] + corpus['factualQueries']:
            response = self.request(self.origin, '/internal/documents/search',
                {'query': query['text'], 'topK': 3, 'documentIds': scope}, stage='retrieval_http')
            actual = [mapping[item['documentId']] for item in response['items']]
            retrieval.append({'expected': query['expected'], 'actual': actual,
                'hitAt3': query['expected'] in actual,
                'lexicalHitAt3': query['expected'] in lexical(query['text'], corpus['documents'], 3)})
        unknown = []
        for query in corpus['unknownQueries']:
            response = self.request(self.origin, '/internal/documents/search',
                {'query': query, 'topK': 3, 'documentIds': scope}, stage='retrieval_http')
            unknown.append(not response['items'])
        self.report['retrieval'] = {'sampleSize': len(retrieval), 'topK': 3,
            'hitCount': sum(case['hitAt3'] for case in retrieval),
            'lexicalHitCount': sum(case['lexicalHitAt3'] for case in retrieval),
            'unknownSampleSize': len(unknown), 'emptyUnknownCount': sum(unknown), 'cases': retrieval}
        self.report['groundingCases'] = self.cases
        for case in rag['queries']:
            self.chat_case(case)
        self.chat_case({'id': 'ordered-summary', 'document': 'leave', 'question': 'Tóm tắt quy định nghỉ phép.', 'anchors': ['12', 'ba'], 'mode': 'summarize'})
        self.request(self.origin, '/documents/upload-url', {'filename': 'malware.exe', 'mimeType': 'application/octet-stream', 'sizeBytes': 6}, expected=400)
        self.request(self.origin, '/documents/upload-url', {'filename': 'oversize.txt', 'mimeType': 'text/plain', 'sizeBytes': 9007199254740991}, expected=400)
        document = self.ids['leave']
        for path in ['/documents/' + document, '/documents/' + document + '/download-url', '/internal/documents/' + document + '/chunks']:
            self.request(self.origin, path, auth=self.foreign, expected=404)
        self.request(self.origin, '/internal/documents/search', {'query': 'nghỉ phép', 'documentIds': [document]}, auth=self.foreign, expected=404)
        for mode in ['search', 'summarize']:
            self.request(self.ai_origin, '/ai/chat', {'prompt': 'Tóm tắt tài liệu', 'documentScope': {'mode': mode, 'documentIds': [document]}}, auth=self.foreign, expected=404)
        if self.request(self.origin, '/documents', auth=self.foreign):
            raise RuntimeError('Foreign user can list private metadata')
        key = str(uuid.uuid4())
        self.request(self.origin, '/documents/' + document + '/reprocess', method='POST', expected=400)
        self.request(self.origin, '/documents/' + document + '/reprocess', method='POST', key='invalid', expected=400)
        first = self.request(self.origin, '/documents/' + document + '/reprocess', method='POST', key=key, expected=202)
        second = self.request(self.origin, '/documents/' + document + '/reprocess', method='POST', key=key, expected=202)
        if first['jobId'] != second['jobId']:
            raise RuntimeError('Duplicate reprocess created another job')
        self.request(self.origin, '/internal/documents/' + document + '/chunks?generation=1')
        self.ready(document, generation=2)
        self.request(self.origin, '/documents/' + document, method='DELETE', expected=204)
        self.request(self.origin, '/documents/' + document, method='DELETE', expected=204)
        for path in ['/documents/' + document, '/documents/' + document + '/download-url', '/internal/documents/' + document + '/chunks']:
            self.request(self.origin, path, expected=404)
        self.request(self.ai_origin, '/ai/chat', {'prompt': 'Tóm tắt', 'documentScope': {'mode': 'summarize', 'documentIds': [document]}}, expected=404)
        doc_database = 'rag_' + self.resources.tag + '_document_test'
        events = json.loads(self.resources.sql("SELECT coalesce(json_agg(payload),'[]'::json) FROM outbox_events", doc_database))
        allowed = {'documentId', 'jobId', 'generation', 'attempt', 'errorCode', 'durationMs', 'chunkCount',
                   'textChars', 'estimatedInputTokens', 'embeddingValues', 'embeddingModel', 'embeddingVersion', 'embeddingDimensions'}
        for event in events:
            if (event.get('version') != 1 or not event.get('occurredAt', '').endswith('Z')
                    or event.get('correlationId') != event['payload'].get('jobId')
                    or not set(event['payload']).issubset(allowed)):
                raise RuntimeError('Outbox contract, correlation or redaction mismatch')
        if not events:
            raise RuntimeError('Expected durable lifecycle outbox events')
        self.report['outboxUtcCorrelationRedaction'] = {'eventsChecked': len(events), 'passed': True}
        self.report['httpSecurityLifecycle'] = 'passed'
        self.report['passed'] = (all(case['hitAt3'] for case in retrieval) and all(unknown)
                                 and all(case['pass'] for case in self.cases))
        if not self.report['passed']:
            raise RuntimeError('Evaluation recorded failed relevance/grounding cases')

    def chat_case(self, case):
        document = self.ids[case['document']]
        try:
            response = self.request(self.ai_origin, '/ai/chat', {'prompt': case['question'],
                'documentScope': {'mode': case.get('mode', 'search'), 'documentIds': [document]}}, stage='chat_http_total')
        except RuntimeError as error:
            self.cases.append({'id': case['id'], 'pass': False, 'controlledError': str(error), 'manualEntailment': 'not applicable'})
            print('RAG case:', case['id'], 'FAIL (controlled HTTP error)', flush=True)
            return
        if response.get('pendingActions'):
            raise RuntimeError('Document grounding attempted to authorize an action')
        citations = response.get('citations', [])
        valid = True
        for citation in citations:
            chunk = self.request(self.origin, '/internal/documents/' + citation['documentId'] + '/chunks/' + citation['chunkId'] + '?generation=' + str(citation['generation']))
            locator = chunk['locator']
            valid &= citation['documentId'] == document and citation['filename'] == chunk['filename']
            prefix = 'page' if locator['kind'] == 'PAGE' else 'line'
            valid &= citation.get(prefix + 'Start') == locator['start'] and citation.get(prefix + 'End') == locator['end']
        history = self.request(self.ai_origin, '/ai/conversations/' + response['conversationId'])
        saved = next(message for message in history['messages']['items'] if message['id'] == response['assistantMessageId'])
        valid &= saved.get('citations', []) == citations
        insufficient = not citations and 'Không đủ thông tin' in response['content']
        anchors = all(value.lower() in response['content'].lower() for value in case.get('anchors', []))
        forbidden = any(value.lower() in response['content'].lower() for value in case.get('forbidden', []))
        passed = insufficient if case.get('insufficient') else bool(citations) and valid and anchors and not forbidden
        if case.get('mode') == 'summarize':
            passed &= response.get('documentCoverage', {}).get('partial') is False
        # Synthetic output retained for manual entailment review; anchor checks are not entailment.
        self.cases.append({'id': case['id'], 'pass': bool(passed), 'sourceMembershipAndLocator': valid,
            'citationCount': len(citations), 'insufficient': insufficient, 'anchorCheck': anchors,
            'content': response['content'], 'manualEntailment': 'pending'})
        print('RAG case:', case['id'], 'PASS' if passed else 'FAIL', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['regression', 'real'], default='regression')
    parser.add_argument('--report', type=Path, default=Path('/tmp/lifehelper-rag-report.json'))
    parser.add_argument('--generation-provider', choices=['ollama', 'cloudflare'], default='cloudflare')
    parser.add_argument('--generation-model')
    parser.add_argument('--generation-url')
    parser.add_argument('--embedding-url')
    parser.add_argument('--embedding-provider', choices=['ollama', 'cloudflare'])
    parser.add_argument('--max-wait', type=int, default=240)
    args = parser.parse_args()
    if not 30 <= args.max_wait <= 900:
        parser.error('--max-wait must be 30..900 seconds')
    resources = Resources()
    changed = subprocess.check_output(['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    fingerprint = hashlib.sha256()
    for name in sorted(set(changed)):
        if not name or name.startswith('docs/'):
            continue
        path = ROOT / name
        if path.is_file():
            fingerprint.update(name.encode() + b'\0' + path.read_bytes() + b'\0')
    report = {'schemaVersion': 1, 'startedAt': datetime.now(timezone.utc).isoformat(),
        'mode': args.mode, 'workingTreeChangesSha256': fingerprint.hexdigest(), 'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
        'platform': platform.platform(), 'cpu': platform.processor(), 'logicalCpus': os.cpu_count(),
        'passed': False, 'limitations': ['Tiny synthetic corpus; not production accuracy.',
        'p95 uses nearest rank and small samples; no universal SLA.',
        'Anchor checks are not factual entailment; review synthetic outputs manually.']}
    try:
        urls = {service: resources.database(service) for service in ['document', 'ai', 'productivity']}
        env = os.environ.copy()
        env.update(NODE_ENV='test', LOG_LEVEL='fatal', DOCUMENT_WORKER_ENABLED='false', DOCUMENT_MAINTENANCE_ENABLED='false',
            AWS_ENDPOINT_URL='http://127.0.0.1:4566', DOCUMENT_S3_PUBLIC_ENDPOINT='http://127.0.0.1:4566',
            AWS_REGION='ap-southeast-1', AWS_ACCESS_KEY_ID='test', AWS_SECRET_ACCESS_KEY='test',
            REDIS_URL='redis://127.0.0.1:56379', S3_BUCKET='lifehelper-local', SQS_QUEUE_NAME='lifehelper-events')
        for service, url in urls.items():
            command(['pnpm', '--filter', '@lifehelper/' + service + '-service', 'db:migrate'], env={**env, 'DATABASE_URL': url})
        if args.mode == 'regression':
            for test in ['test:persistence', 'test:worker', 'test:storage', 'test:e2e']:
                command(['pnpm', '--filter', '@lifehelper/document-service', test], env={**env, 'DATABASE_URL': urls['document']})
            for test in ['test:persistence', 'test:e2e', 'test:workflow']:
                command(['pnpm', '--filter', '@lifehelper/ai-service', test], env={**env,
                    'DATABASE_URL': urls['ai'], 'DOCUMENT_DATABASE_URL': urls['document'], 'PRODUCTIVITY_DATABASE_URL': urls['productivity']})
            report['passed'] = True
        else:
            doc_env = environment('lifehelper-document-service-1')
            ai_env = environment('lifehelper-ai-service-1')
            selected_embedding = args.embedding_provider or doc_env.get('EMBEDDING_PROVIDER', 'ollama')
            original_embedding = doc_env.get('EMBEDDING_PROVIDER', 'ollama')
            proxy = None
            if selected_embedding == 'ollama':
                network = inspect('lifehelper-document-embeddings-1')['NetworkSettings']['Networks']
                embedding_url = args.embedding_url or 'http://' + next(iter(network.values()))['IPAddress'] + ':11434'
                proxy = EmbeddingProxy(embedding_url)
                resources.servers.append(proxy)
            shared = {**env, 'JWT_ACCESS_SECRET': uuid.uuid4().hex + uuid.uuid4().hex,
                'JWT_ISSUER': 'rag-verification', 'JWT_AUDIENCE': 'rag-verification'}
            doc_env.update(shared, DATABASE_URL=urls['document'], EMBEDDING_PROVIDER=selected_embedding,
                EMBEDDING_BASE_URL=proxy.origin if proxy else 'https://api.cloudflare.com', EMBEDDING_MAX_ATTEMPTS='1', DOCUMENT_PROCESSING_RETRY_BASE_MS='2000', DOCUMENT_S3_BUCKET=resources.bucket(env['AWS_REGION']),
                DOCUMENT_WORKER_ENABLED='true', DOCUMENT_WORKER_POLL_MS='100')
            if selected_embedding == 'cloudflare':
                doc_env.update(EMBEDDING_MODEL='@cf/baai/bge-m3', EMBEDDING_MODEL_VERSION='cloudflare-bge-m3-v1',
                    EMBEDDING_DIMENSIONS='1024', CLOUDFLARE_ACCOUNT_ID=ai_env['CLOUDFLARE_ACCOUNT_ID'],
                    CLOUDFLARE_API_TOKEN=ai_env['CLOUDFLARE_API_TOKEN'])
            elif original_embedding != 'ollama':
                doc_env.update(EMBEDDING_MODEL='bge-m3:567m',
                    EMBEDDING_MODEL_VERSION='7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab',
                    EMBEDDING_DIMENSIONS='1024')
            doc = Server('document', doc_env)
            resources.servers.append(doc)
            origin = doc.origin()
            ai_env.update(shared, DATABASE_URL=urls['ai'], DOCUMENT_SERVICE_URL=origin, DOCUMENT_TIMEOUT_MS='60000',
                AI_PROVIDER=args.generation_provider, AI_TIMEOUT_MS='120000', AI_RAG_OUTPUT_TOKENS='1024')
            if args.generation_model:
                ai_env['AI_MODEL'] = args.generation_model
            if args.generation_url:
                ai_env['AI_BASE_URL'] = args.generation_url
            if args.generation_provider == 'ollama' and not (args.generation_model and args.generation_url):
                raise RuntimeError('Local generation needs explicit --generation-model and --generation-url')
            if args.generation_provider == 'ollama':
                with urllib.request.urlopen(args.generation_url + '/api/tags', timeout=10) as response:
                    models = json.load(response)['models']
                model = next((model for model in models if model['name'] == args.generation_model), None)
                if not model:
                    raise RuntimeError('Requested generation model is not installed')
                report['generationManifestDigest'] = model['digest']
            ai = Server('ai', ai_env)
            resources.servers.append(ai)
            ai_origin = ai.origin()
            report['configuration'] = {k: doc_env.get(k) for k in ['EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'EMBEDDING_MODEL_VERSION',
                'EMBEDDING_DIMENSIONS', 'EMBEDDING_BATCH_SIZE', 'DOCUMENT_RETRIEVAL_MIN_SIMILARITY', 'DOCUMENT_CHUNK_TARGET_TOKENS']}
            report['configuration'].update(generationProvider=ai_env['AI_PROVIDER'], generationModel=ai_env['AI_MODEL'],
                ragOutputTokens=ai_env['AI_RAG_OUTPUT_TOKENS'], corpusDocuments=9, additionalRecoveryDocuments=1 if proxy else 0, warmupExcluded=False)
            evaluation = Evaluation(resources, shared, origin, ai_origin, report, args.max_wait, proxy)
            try:
                evaluation.run()
            finally:
                latencies = dict(evaluation.latencies)
                for server in [doc, ai]:
                    for metric in server.metrics:
                        if metric['success']:
                            latencies.setdefault(metric['stage'], []).append(metric['ms'])
                report['latency'] = {stage: distribution(samples) for stage, samples in latencies.items()}
    except BaseException as error:
        report['passed'] = False
        report['failure'] = type(error).__name__ + ': ' + str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise
    finally:
        try:
            resources.close()
            report['cleanup'] = 'all owned resources removed'
        except BaseException:
            report['cleanup'] = 'FAILED; inspect resources with run ID ' + resources.tag
            report['passed'] = False
            raise
        finally:
            report['finishedAt'] = datetime.now(timezone.utc).isoformat()
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            print('Report:', args.report, flush=True)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        main()
    except Exception:
        print('Verification failed; see sanitized report. Cleanup was attempted.', file=sys.stderr)
        sys.exit(1)
