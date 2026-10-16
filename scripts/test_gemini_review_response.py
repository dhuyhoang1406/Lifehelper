import copy
import json
import unittest
from gemini_review_response import generation_config, parse_review_response


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

from gemini_review import review_chunks, review_all, request_review, format_result
from unittest.mock import Mock
import io
from urllib.error import HTTPError, URLError


class CompleteDiffReviewTest(unittest.TestCase):
    def diff(self, path='a.ts', text='new code'):
        return f'diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n-old code\n+{text}\n'

    def successful(self, prompt, valid, models, key, deadline):
        return {'summary': 'Segment reviewed.', 'findings': []}, models[0]

    def test_diff_larger_than_previous_limit_is_fully_partitioned(self):
        raw = self.diff('first.ts', 'x'*70000) + self.diff('second.ts', 'y'*60000)
        chunks = review_chunks(raw)
        self.assertGreater(len(chunks), 2)
        self.assertEqual(''.join(c['diff'] for c in chunks), raw)
        self.assertTrue(all(len(c['diff']) <= 45000 for c in chunks))
        review = Mock(side_effect=self.successful)
        result = review_all(chunks, 'guidelines', ['fake'], 'not-secret', 999, review=review)
        self.assertEqual(review.call_count, len(chunks))
        self.assertTrue(result['coverage']['complete'])
        self.assertEqual(result['coverage']['reviewedChars'], len(raw))
        self.assertEqual(result['coverage']['totalChars'], len(raw))

    def test_only_deletions_renames_and_binary_metadata_are_preserved(self):
        raw = ('diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-delete me\n'
               'diff --git a/a.ts b/b.ts\nsimilarity index 100%\nrename from a.ts\nrename to b.ts\n'
               'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n')
        chunks = review_chunks(raw, limit=80)
        self.assertEqual(''.join(c['diff'] for c in chunks), raw)
        paths = {p for chunk in chunks for p in chunk['valid']}
        self.assertTrue({'old.ts', 'b.ts', 'image.png'} <= paths)
        self.assertTrue(all(not lines for chunk in chunks for lines in chunk['valid'].values()))

    def test_no_change_of_line_numbers_across_hunks(self):
        raw = self.diff() + '@@ -100,2 +110,2 @@\n context\n-added\n+replacement\n'
        chunks = review_chunks(raw)
        self.assertEqual(chunks[0]['valid']['a.ts'], [1, 110, 111])

    def test_one_failed_segment_prevents_full_success_but_keeps_other_findings(self):
        chunks = review_chunks(self.diff('a.ts') + self.diff('b.ts'), limit=100)
        finding = GeminiReviewResponseTest().finding()
        finding['file'], finding['line'] = 'a.ts', 1
        def review(prompt, valid, models, key, deadline):
            if 'a.ts' in valid:
                return {'summary':'Bug', 'findings':[finding]}, models[0]
            return None, None
        result = format_result(review_all(chunks, '', ['fake'], 'key', 999, review=review))
        self.assertFalse(result['coverage']['complete'])
        self.assertTrue(result['coverage']['failedParts'])
        self.assertEqual(result['totalFindings'], 1)
        self.assertEqual(len(result['comments']), 1)

    def test_deduplicates_overlapping_findings(self):
        chunk = review_chunks(self.diff())[0]
        finding = GeminiReviewResponseTest().finding()
        finding['file'], finding['line'] = 'a.ts', 1
        result = review_all([chunk, chunk], '', ['fake'], 'key', 999,
                            review=lambda *_: ({'summary':'Bug', 'findings':[finding]}, 'fake'))
        self.assertEqual(len(result['findings']), 1)
        self.assertTrue(result['coverage']['complete'])

    def test_no_input_is_not_a_full_clean_review(self):
        self.assertFalse(review_all([], '', ['fake'], 'key', 0)['coverage']['complete'])

    def test_reuses_successful_fallback_for_next_segment(self):
        chunk = review_chunks(self.diff())[0]
        review = Mock(return_value=({'summary':'Reviewed', 'findings':[]}, 'fallback'))
        review_all([chunk, chunk], '', ['primary', 'fallback'], 'key', 999, review=review)
        self.assertEqual(review.call_args_list[1].args[2], ['fallback', 'primary'])

    def call_review(self, responses, *, clock=lambda: 0, deadline=999):
        response = iter(responses)
        def request(*_, **kwargs):
            item = next(response)
            if isinstance(item, Exception):
                raise item
            return io.BytesIO(json.dumps(item).encode())
        request_mock = Mock(side_effect=request)
        sleep = Mock()
        result = request_review('prompt', {'apps/example.ts':[10]}, ['primary','fallback'],
                                'key', deadline, request=request_mock, clock=clock, sleep=sleep)
        return result, request_mock, sleep

    def test_bad_output_is_retried_and_falls_back(self):
        fixture = GeminiReviewResponseTest()
        bad = fixture.response(reason='MAX_TOKENS')
        (parsed, model), request, _ = self.call_review([bad, bad, fixture.response()])
        self.assertEqual(model, 'fallback')
        self.assertEqual(request.call_count, 3)
        self.assertEqual(parsed['findings'], [])

    def test_all_models_exhausted_are_incomplete(self):
        bad = GeminiReviewResponseTest().response(reason='MAX_TOKENS')
        result, request, _ = self.call_review([bad]*4)
        self.assertEqual(result, (None, None))
        self.assertEqual(request.call_count, 4)

    def test_http_and_network_errors_fall_back_with_bounded_sleep(self):
        errors = [HTTPError('https://invalid',503,'busy',{'Retry-After':'99999'},None), URLError('network')]
        (parsed, model), request, sleep = self.call_review([*errors, GeminiReviewResponseTest().response()])
        self.assertEqual(model, 'fallback')
        self.assertEqual(request.call_count, 3)
        sleep.assert_called_once_with(60)
        self.assertIsNotNone(parsed)

    def test_deadline_prevents_more_requests(self):
        result, request, _ = self.call_review([], clock=lambda:100, deadline=100)
        self.assertEqual(result, (None,None))
        request.assert_not_called()

    def test_auth_failure_does_not_retry_all_models(self):
        result, request, _ = self.call_review([HTTPError('https://invalid',403,'denied',{},None)])
        self.assertEqual(result, (None,None))
        self.assertEqual(request.call_count, 1)

    def test_more_than_thirty_findings_remain_in_summary(self):
        findings = [{**GeminiReviewResponseTest().finding(), 'line': n} for n in range(1,36)]
        result = format_result({'summary':'Review', 'coverage':{'complete':True}, 'findings':findings, 'model':'fake'})
        self.assertEqual(len(result['comments']),30)
        self.assertEqual(len(result['findings']),5)
        self.assertEqual(len(result['allFindings']),35)


class PublishReviewFormatTest(unittest.TestCase):
    def publish(self, result, fail_inline=False):
        from pathlib import Path
        import subprocess
        import textwrap
        workflow = Path('.github/workflows/ai-review.yml').read_text()
        code = textwrap.dedent(workflow.split('          script: |\n', 1)[1])
        harness = r"""
        const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        const sent = [];
        const fakeGithub = { rest: { pulls: {
          listReviews: async () => ({data: []}),
          createReview: async payload => {
            if (input.failInline && payload.comments) throw new Error('inline unavailable');
            sent.push(payload); return {data:{id:1}};
          }
        }}};
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const run = new AsyncFunction('require', 'github', 'context', 'console', input.code);
        run(() => ({readFileSync: () => JSON.stringify(input.result)}), fakeGithub,
            {repo:{owner:'test',repo:'test'},issue:{number:1}}, {log:()=>{}})
          .then(() => process.stdout.write(JSON.stringify(sent)))
          .catch(() => {process.exitCode=1;});
        """
        result = subprocess.run(['node','-e',harness], input=json.dumps({
            'code':code,'result':result,'failInline':fail_inline}), text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def result(self, complete=True, finding=False):
        findings = [GeminiReviewResponseTest().finding()] if finding else []
        return format_result({'summary':'Summary', 'findings':findings, 'model':'fake', 'coverage':{
            'complete':complete,'reviewedParts':2 if complete else 1, 'totalParts':2,
            'reviewedChars':100 if complete else 50,'totalChars':100,
            'failedParts':[] if complete else [2]}})

    def test_all_parts_are_reported_with_no_raw_json(self):
        review = self.publish(self.result())[0]
        self.assertIn('2/2', review['body'])
        self.assertIn('100/100', review['body'])
        self.assertIn('toàn bộ diff', review['body'])
        self.assertNotIn('"findings"', review['body'])

    def test_a_failed_part_never_claims_a_clean_full_review(self):
        review = self.publish(self.result(complete=False))[0]
        self.assertIn('Review chưa hoàn tất', review['body'])
        self.assertNotIn('✅', review['body'])

    def test_findings_keep_copilot_style_inline_comments(self):
        review = self.publish(self.result(finding=True))[0]
        self.assertEqual(review['comments'][0]['path'],'apps/example.ts')
        self.assertEqual(review['comments'][0]['line'],10)
        self.assertIn('[High]',review['comments'][0]['body'])
        self.assertIn('Suggestion:',review['comments'][0]['body'])

    def test_inline_publish_failure_preserves_the_findings_in_summary(self):
        review = self.publish(self.result(finding=True),fail_inline=True)[0]
        self.assertIn('Concrete bug',review['body'])
        self.assertIn('Failure scenario',review['body'])
        self.assertIn('Concrete fix',review['body'])


if __name__ == '__main__':
    unittest.main()
