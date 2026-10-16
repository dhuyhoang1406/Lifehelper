import copy
import json
import unittest
from gemini_review_response import bounded_diff, generation_config, parse_review_response


class GeminiReviewResponseTest(unittest.TestCase):
    valid = {'apps/example.ts': [10, 11]}
    review = {'summary': 'Review complete.', 'findings': []}

    def response(self, review=None, reason='STOP'):
        return {'candidates': [{'finishReason': reason, 'content': {
            'parts': [{'text': json.dumps(self.review if review is None else review)}]}}]}

    def finding(self):
        return {'severity': 'high', 'file': 'apps/example.ts', 'line': 10,
                'title': 'Concrete bug', 'detail': 'Failure scenario', 'suggestion': 'Concrete fix'}

    def test_requests_structured_output(self):
        config = generation_config()
        self.assertEqual(config['responseMimeType'], 'application/json')
        self.assertEqual(config['responseJsonSchema']['required'], ['summary', 'findings'])

    def test_skips_thoughts_and_joins_final_parts(self):
        text = json.dumps(self.review)
        response = self.response()
        response['candidates'][0]['content']['parts'] = [
            {'thought': True, 'text': 'Wait! Let me think...'},
            {'text': text[:15]}, {'text': text[15:]}, {'thoughtSignature': 'metadata'},
        ]
        self.assertEqual(parse_review_response(response, self.valid), self.review)

    def test_rejects_truncation_even_when_json_is_valid(self):
        for reason in ('MAX_TOKENS', 'SAFETY', None):
            with self.subTest(reason=reason), self.assertRaises(ValueError):
                parse_review_response(self.response(reason=reason), self.valid)

    def test_does_not_publish_raw_reasoning_on_invalid_json(self):
        response = self.response()
        response['candidates'][0]['content']['parts'] = [{'text': 'Wait! Look at line 120: secret'}]
        with self.assertRaises(ValueError) as error:
            parse_review_response(response, self.valid)
        self.assertNotIn('secret', str(error.exception))

    def test_thought_only_is_not_a_successful_empty_review(self):
        response = self.response()
        response['candidates'][0]['content']['parts'][0]['thought'] = True
        with self.assertRaises(ValueError):
            parse_review_response(response, self.valid)

    def test_valid_findings_and_explicit_empty_are_accepted(self):
        review = {'summary': 'Bug found.', 'findings': [self.finding()]}
        self.assertEqual(parse_review_response(self.response(review), self.valid), review)
        self.assertEqual(parse_review_response(self.response(), self.valid)['findings'], [])

    def test_rejects_invalid_fields_and_locations(self):
        for patch in ({'severity': 'urgent'}, {'file': 'other.ts'}, {'line': 99},
                      {'line': True}, {'title': ''}, {'detail': None}, {'extra': 'unexpected'}):
            with self.subTest(patch=patch):
                finding = {**self.finding(), **patch}
                with self.assertRaises(ValueError):
                    parse_review_response(self.response({'summary': 'Review', 'findings': [finding]}), self.valid)

    def test_null_line_can_remain_in_summary(self):
        finding = self.finding()
        finding['line'] = None
        review = {'summary': 'Review', 'findings': [finding]}
        self.assertEqual(parse_review_response(self.response(review), self.valid), review)

    def test_rejects_malformed_response_and_missing_summary(self):
        for response in ({}, {'candidates': []}, {'candidates': [None]},
                         self.response({'findings': []}), self.response({'summary': '', 'findings': []})):
            with self.subTest(response=copy.deepcopy(response)), self.assertRaises(ValueError):
                parse_review_response(response, self.valid)

class GeminiWorkflowRetryTest(unittest.TestCase):
    """Execute the real workflow's Python step with a fake HTTP transport."""
    def execute_workflow(self, responses):
        import contextlib
        import io
        import os
        from pathlib import Path
        import tempfile
        import textwrap
        from types import SimpleNamespace
        from unittest.mock import patch
        workflow = Path('.github/workflows/ai-review.yml').read_text()
        step = workflow.split('      - name: Review changes with Gemini', 1)[1]
        code = textwrap.dedent(step.split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0])
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / 'numbered.diff').write_text('apps/example.ts:10:\tchanged code')
            (base / 'review-coverage.json').write_text(json.dumps({'truncated':False, 'reviewedLines':1, 'totalLines':1}))
            (base / 'valid-lines.json').write_text(json.dumps({'apps/example.ts': [10]}))
            code = code.replace('/tmp/', str(base) + '/')
            response = iter(responses)
            def urlopen(*_args, **_kwargs):
                item = next(response)
                if isinstance(item, Exception):
                    raise item
                return io.BytesIO(json.dumps(item).encode())
            log = io.StringIO()
            with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-not-a-secret',
                    'GEMINI_MODELS': 'fake-primary,fake-fallback', 'PR_NUMBER': '1',
                    'BASE_SHA': 'base', 'HEAD_SHA': 'head'}), \
                 patch('urllib.request.urlopen', side_effect=urlopen) as request, \
                 patch('subprocess.run', return_value=SimpleNamespace(stdout='apps/example.ts\n')), \
                 patch('time.sleep'), contextlib.redirect_stdout(log):
                try:
                    exec(compile(code, '<review workflow>', 'exec'), {})
                except SystemExit as error:
                    self.assertEqual(error.code, 0)
            return json.loads((base / 'review.json').read_text()), request.call_count, log.getvalue()

    def test_invalid_outputs_fall_back_without_publishing_raw_reasoning(self):
        fixture = GeminiReviewResponseTest()
        broken = fixture.response()
        broken['candidates'][0]['content']['parts'] = [{'text': 'Wait! raw private reasoning'}]
        result, calls, logs = self.execute_workflow([broken, broken, fixture.response()])
        self.assertEqual(calls, 3)
        self.assertEqual(result['model'], 'fake-fallback')
        self.assertEqual(result['totalFindings'], 0)
        self.assertNotIn('raw private reasoning', logs)

    def test_exhaustion_reports_incomplete_rather_than_empty_success(self):
        broken = GeminiReviewResponseTest().response(reason='MAX_TOKENS')
        result, calls, _logs = self.execute_workflow([broken] * 4)
        self.assertEqual(calls, 4)
        self.assertTrue(result['unavailable'])
        self.assertNotIn('totalFindings', result)

    def test_network_exhaustion_uses_next_model(self):
        from urllib.error import URLError
        fixture = GeminiReviewResponseTest()
        result, calls, _logs = self.execute_workflow([
            URLError('network failed'), URLError('network failed'), fixture.response()])
        self.assertEqual(calls, 3)
        self.assertEqual(result['model'], 'fake-fallback')

    def test_http_retry_after_is_bounded_and_errors_do_not_leak_payloads(self):
        from urllib.error import HTTPError
        import io
        from unittest.mock import patch
        fixture = GeminiReviewResponseTest()
        errors = [HTTPError('https://example.invalid', 503, 'Unavailable',
                  {'Retry-After': '99999'}, io.BytesIO(b'provider private payload')) for _ in range(2)]
        with patch('time.sleep'):
            result, calls, logs = self.execute_workflow([*errors, fixture.response()])
        self.assertEqual(calls, 3)
        self.assertEqual(result['model'], 'fake-fallback')
        self.assertIn('retry in 60s', logs)
        self.assertNotIn('provider private payload', logs)


class BoundedDiffTest(unittest.TestCase):
    def test_full_diff_preserves_locations(self):
        text, valid, coverage = bounded_diff(['a.ts:1:\tx', 'b.ts:2:\ty'])
        self.assertEqual(valid, {'a.ts': [1], 'b.ts': [2]})
        self.assertFalse(coverage['truncated'])
        self.assertIn('b.ts:2:', text)

    def test_partial_diff_never_splits_lines_or_authorizes_omitted_locations(self):
        text, valid, coverage = bounded_diff(['a.ts:1:\tx', 'b.ts:2:\ty'], limit=10)
        self.assertEqual(valid, {'a.ts': [1]})
        self.assertNotIn('b.ts:2:', text)
        self.assertEqual(coverage, {'truncated':True, 'reviewedLines':1, 'totalLines':2})

    def test_oversized_first_line_has_no_reviewable_locations(self):
        _text, valid, coverage = bounded_diff(['a.ts:1:\t' + 'x'*100], limit=10)
        self.assertEqual(valid, {})
        self.assertTrue(coverage['truncated'])


if __name__ == '__main__':
    unittest.main()
