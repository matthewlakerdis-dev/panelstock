"""Bounded CAD throttling recovery shared by threads in one converter process."""
import io
import json
import threading
import time
import urllib.error
import urllib.request


class ProviderRetry:
    def __init__(self, clock=time.monotonic, sleep=time.sleep):
        self.clock, self.sleep = clock, sleep
        self.lock = threading.Lock()
        self.next_request = 0.

    def open(self, request, deadline, request_timeout):
        for attempt in range(3):
            with self.lock:
                wait=max(0.,self.next_request-self.clock())
                if self.clock()+wait+1>=deadline:
                    raise TimeoutError('Provider cooldown exceeds request deadline')
                # Spread threads returning from the same cooldown.
                if wait:self.next_request+=2
            if wait:self.sleep(wait)
            try:
                return urllib.request.urlopen(request,timeout=max(1,min(request_timeout,deadline-self.clock())))
            except urllib.error.HTTPError as error:
                if error.code!=429:raise
                body=error.read(65536)
                replacement=urllib.error.HTTPError(error.url,error.code,error.msg,error.headers,io.BytesIO(body))
                try:code=json.loads(body).get('error',{}).get('code')
                except (ValueError,AttributeError):code=None
                if code in ('insufficient_quota','billing_hard_limit_reached'):raise replacement from None
                try:delay=float(error.headers.get('Retry-After',''))
                except (ValueError,TypeError,AttributeError):delay=20*(attempt+1)
                if not 0<delay<float('inf'):delay=20*(attempt+1)
                with self.lock:self.next_request=max(self.next_request,self.clock()+delay)
                if attempt==2 or self.clock()+delay+1>=deadline:raise replacement from None


CAD_PROVIDER_RETRY = ProviderRetry()
