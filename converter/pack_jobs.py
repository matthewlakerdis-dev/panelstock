"""Bounded background page reads. Opaque job keys are scoped by the Worker."""
import hashlib
import json
import re
import threading
import time


class PackJobs:
    def __init__(self, analyse, limit, clock=time.monotonic):
        self.analyse, self.limit, self.clock = analyse, limit, clock
        self.jobs = {}
        self.lock = threading.Lock()

    def request(self, body):
        key = body.get('jobId', '')
        if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9]{64}', key):
            raise ValueError('Invalid drawing job identifier.')
        with self.lock:
            now = self.clock()
            self.jobs = {k:v for k,v in self.jobs.items() if v['state']=='running' or now-v['updated']<3600}
            job = self.jobs.get(key)
            if body.get('jobAction') == 'poll':
                if job is None:
                    return {'jobState':'expired','error':'Drawing job expired or the service restarted. Resume to read this page again.'}
            elif body.get('jobAction') == 'start':
                payload = {k:v for k,v in body.items() if k not in ('jobId','jobAction')}
                if payload.get('mode') not in ('pack-read','pack-verify'):
                    raise ValueError('Background reading is only available for drawing packs.')
                fingerprint = hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
                if job is not None and job['fingerprint'] != fingerprint:
                    raise ValueError('Drawing job input changed. Start a new reading.')
                if job is None:
                    if len(self.jobs)>=32:
                        completed = [k for k,v in self.jobs.items() if v['state']!='running']
                        if completed: del self.jobs[min(completed,key=lambda k:self.jobs[k]['updated'])]
                    if len(self.jobs)>=32 or not self.limit.acquire(blocking=False):
                        return {'jobState':'busy','error':'Drawing reader is busy with other pages.'}
                    job = {'state':'running','updated':now,'fingerprint':fingerprint}
                    self.jobs[key] = job
                    threading.Thread(target=self.run,args=(job,payload),daemon=True).start()
            else:
                raise ValueError('Invalid drawing job action.')
            return {'jobState':job['state'], **({'result':job['result']} if job['state']=='completed' else {}), **({'error':job['error']} if job['state']=='failed' else {})}

    def run(self, job, payload):
        from cad_ai import SketchServiceError
        from panel_cad import CadError
        try:
            result = self.analyse({**payload, '_backgroundPack':True})
            if len(json.dumps(result))>12*1024*1024:
                raise CadError('Drawing result exceeded the size limit.')
            with self.lock:
                job.update(state='completed',result=result,updated=self.clock())
        except Exception as error:
            message = str(error)[:500] if isinstance(error,(SketchServiceError,CadError,ValueError)) else 'Drawing reader failed unexpectedly. Retry this page.'
            with self.lock:
                job.update(state='failed',error=message,updated=self.clock())
        finally:
            self.limit.release()
