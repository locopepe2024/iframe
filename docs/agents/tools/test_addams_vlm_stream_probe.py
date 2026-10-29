"""Offline transport behavior, including body interruption after a saved delta."""
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from addams_vlm_stream_probe import receive


class Body(httpx.SyncByteStream):
    def __init__(self, lines, fail=False):
        self.lines, self.fail = lines, fail

    def __iter__(self):
        for line in self.lines:
            yield line.encode()
        if self.fail:
            raise httpx.ReadError('simulated disconnect')


class ReceptionTests(unittest.TestCase):
    def run_body(self, lines, fail=False):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        out = Path(directory.name)
        def handler(request):
            self.calls += 1
            return httpx.Response(200, headers={'x-request-id': 'server-test'},
                                  stream=Body(lines, fail))
        self.calls = 0
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            trace = receive(client, 'https://example.invalid/v1/chat/completions',
                            {'X-Client-Request-Id': 'local-test'}, {}, out)
        self.assertEqual(self.calls, 1)
        self.assertEqual(trace['response_ids']['x-request-id'], 'server-test')
        return trace, out

    def test_complete_content_usage_and_done(self):
        trace, out = self.run_body([
            ': heartbeat\n\n',
            'data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n',
            'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: {"choices":[],"usage":{"total_tokens":9}}\n\n',
            'data: [DONE]\n\n'])
        self.assertEqual(trace['client_response_status'], 'complete')
        self.assertEqual(trace['usage']['total_tokens'], 9)
        self.assertEqual((out / 'response.txt').read_text(), '你好')
        self.assertIn(': heartbeat', (out / 'events.sse').read_text())

    def test_interruption_keeps_partial_and_trace(self):
        trace, out = self.run_body([
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'], True)
        self.assertEqual(trace['client_response_status'], 'interrupted')
        self.assertEqual(trace['upstream_status'], 'unknown')
        self.assertEqual((out / 'response.txt').read_text(), 'partial')
        self.assertEqual(json.loads((out / 'transport.json').read_text())['error_cause_types'], ['ReadError'])

    def test_eof_without_done_is_incomplete(self):
        trace, _ = self.run_body([
            'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\n'])
        self.assertEqual(trace['client_response_status'], 'incomplete')

    def test_token_limit_is_not_complete(self):
        trace, _ = self.run_body([
            'data: {"choices":[{"delta":{"content":"{"},"finish_reason":"length"}]}\n\n',
            'data: [DONE]\n\n'])
        self.assertEqual(trace['client_response_status'], 'incomplete')


if __name__ == '__main__':
    unittest.main()
