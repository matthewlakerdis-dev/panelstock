import threading
import unittest
from pack_jobs import PackJobs

class BackgroundJobsTests(unittest.TestCase):
    def test_lost_start_response_reuses_read_and_poll_returns_result(self):
        release=threading.Event(); called=threading.Event(); calls=[]
        def analyse(body):
            calls.append(body);called.set();release.wait(2);return {'inventory':{'groups':[]}}
        jobs=PackJobs(analyse,threading.BoundedSemaphore(1))
        body={'jobId':'a'*64,'jobAction':'start','mode':'pack-read','data':'image'}
        self.assertEqual(jobs.request(body)['jobState'],'running')
        self.assertTrue(called.wait(1))
        self.assertEqual(jobs.request(body)['jobState'],'running')
        self.assertEqual(jobs.request({**body,'jobId':'b'*64})['jobState'],'busy')
        with self.assertRaises(ValueError):jobs.request({**body,'data':'changed'})
        release.set()
        # Taking the semaphore waits for the background job to finish.
        self.assertTrue(jobs.limit.acquire(timeout=2));jobs.limit.release()
        result=jobs.request({'jobId':'a'*64,'jobAction':'poll'})
        self.assertEqual(result['result'],{'inventory':{'groups':[]}})
        self.assertEqual(len(calls),1)
        self.assertTrue(calls[0]['_backgroundPack'])

    def test_expiration_and_private_errors(self):
        def fail(body):raise RuntimeError('secret provider payload')
        now=[0];jobs=PackJobs(fail,threading.BoundedSemaphore(1),clock=lambda:now[0])
        jobs.request({'jobId':'a'*64,'jobAction':'start','mode':'pack-read'})
        self.assertTrue(jobs.limit.acquire(timeout=2));jobs.limit.release()
        self.assertNotIn('secret',jobs.request({'jobId':'a'*64,'jobAction':'poll'})['error'])
        now[0]=3601
        self.assertEqual(jobs.request({'jobId':'a'*64,'jobAction':'poll'})['jobState'],'expired')
        with self.assertRaises(ValueError):jobs.request({'jobId':'wrong','jobAction':'poll'})

if __name__=='__main__':unittest.main()
