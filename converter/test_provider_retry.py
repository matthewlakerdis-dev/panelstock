import io,json,unittest,urllib.error
from unittest.mock import patch
from provider_retry import ProviderRetry

class ProviderRetryTests(unittest.TestCase):
    def setup_retry(self):
        self.now=0;self.waits=[]
        def sleep(seconds):self.waits.append(seconds);self.now+=seconds
        return ProviderRetry(lambda:self.now,sleep)
    def error(self,code='rate_limit_exceeded',after='7',status=429):
        return urllib.error.HTTPError('https://api.openai.com',status,'limited',{'Retry-After':after},io.BytesIO(json.dumps({'error':{'code':code}}).encode()))
    def test_retry_after_then_success(self):
        r=self.setup_retry();response=object()
        with patch('urllib.request.urlopen',side_effect=[self.error(),response]) as call:
            self.assertIs(r.open(object(),600,600),response)
            self.assertEqual(call.call_count,2);self.assertEqual(self.waits,[7])
    def test_quota_and_auth_do_not_retry(self):
        for code,status in [('insufficient_quota',429),('billing_hard_limit_reached',429),('invalid_api_key',401)]:
            r=self.setup_retry()
            with patch('urllib.request.urlopen',side_effect=self.error(code,status=status)) as call:
                with self.assertRaises(urllib.error.HTTPError) as caught:r.open(object(),600,70)
                self.assertEqual(call.call_count,1);self.assertFalse(self.waits)
                self.assertIn(code,caught.exception.read().decode())
    def test_retry_is_bounded_and_preserves_error(self):
        r=self.setup_retry()
        with patch('urllib.request.urlopen',side_effect=[self.error(after='bad') for _ in range(3)]) as call:
            with self.assertRaises(urllib.error.HTTPError):r.open(object(),600,600)
            self.assertEqual(call.call_count,3);self.assertEqual(self.waits,[20,40])
    def test_long_cooldown_does_not_hold_short_request(self):
        r=self.setup_retry()
        with patch('urllib.request.urlopen',side_effect=self.error(after='120')) as call:
            with self.assertRaises(urllib.error.HTTPError):r.open(object(),70,70)
            self.assertEqual(call.call_count,1);self.assertFalse(self.waits)
            with self.assertRaises(TimeoutError):r.open(object(),70,70)
            self.assertEqual(call.call_count,1)
    def test_cooldown_shared_with_next_request(self):
        r=self.setup_retry()
        with patch('urllib.request.urlopen',side_effect=[self.error(after='80'),object()]) as call:
            with self.assertRaises(urllib.error.HTTPError):r.open(object(),70,70)
            r.open(object(),600,600)
            self.assertEqual(self.waits,[80]);self.assertEqual(call.call_count,2)
