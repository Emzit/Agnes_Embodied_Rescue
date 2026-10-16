"""Synthetic unit fixtures only; live acceptance always consumes Gazebo ROS Images."""
from types import SimpleNamespace as S
import unittest
import numpy as np
from cv_detector import detect_pixels

def message(pixels,frame='unit-fixture'):
    return S(encoding='rgb8',width=pixels.shape[1],height=pixels.shape[0],step=pixels.shape[1]*3,
             data=pixels.astype(np.uint8).tobytes(),header=S(frame_id=frame,stamp=S(sec=1,nanosec=2)))
class Tests(unittest.TestCase):
    def test_localization_is_derived_from_pixels(self):
        a=np.zeros((100,150,3),dtype=np.uint8)
        a[10:70,10:30]=[200,10,10]
        a[20:50,50:90]=[10,30,200]
        a[10:70,110:140]=[200,10,200]
        ds=detect_pixels(message(a))
        self.assertEqual({d['label'] for d in ds},{'person','toolbox','fire_extinguisher'})
        self.assertEqual(next(d for d in ds if d['label']=='toolbox')['bbox'],[50,20,90,50])
    def test_metadata_never_creates_a_detection(self):
        self.assertEqual(detect_pixels(message(np.zeros((100,100,3)),frame='person_fire_extinguisher')),[])
    def test_color_distractor_and_clipping_quality(self):
        a=np.zeros((100,150,3),dtype=np.uint8)
        a[10:40,10:70]=[200,10,10] # Wide red shape fails tall-cylinder test.
        self.assertEqual(detect_pixels(message(a)),[])
        a[:]=0;a[20:60,0:30]=[10,30,200]
        clipped=detect_pixels(message(a))[0]['confidence']
        a[:]=0;a[20:60,50:80]=[10,30,200]
        complete=detect_pixels(message(a))[0]['confidence']
        self.assertLess(clipped,complete)
if __name__=='__main__':unittest.main()
