"""Numeric unit fixtures only, never exposed as ROS topics or acceptance evidence."""
import math
from types import SimpleNamespace as S
import unittest
from sensor_summary import camera_summary, lidar_summary

def header():
    return S(frame_id='unit_fixture', stamp=S(sec=1, nanosec=2))

class SummaryTests(unittest.TestCase):
    def test_invalid_ranges_are_excluded_and_empty_sector_is_unknown(self):
        msg = S(header=header(), ranges=[float('inf'),float('nan'),0.01,2.0,4.0],
                angle_min=-0.3,angle_increment=0.1,range_min=0.1,range_max=12)
        result=lidar_summary(msg)
        self.assertEqual(result['valid_points'],2)
        self.assertEqual(result['front_min_range'],2.0)
        self.assertIsNone(result['left_min_range'])
    def test_rgb_statistics_ignore_row_padding(self):
        msg=S(header=header(),width=1,height=2,step=4,encoding='rgb8',
              data=bytes([0,10,20,255,30,40,50,255]))
        result=camera_summary(msg)
        self.assertTrue(result['available'])
        self.assertEqual(result['summary']['mean'],25)
        self.assertEqual(result['summary']['max'],50)
    def test_unsupported_or_truncated_image_is_not_guessed(self):
        for encoding,data in [('16UC1',bytes(6)),('rgb8',bytes(2))]:
            msg=S(header=header(),width=1,height=2,step=3,encoding=encoding,data=data)
            self.assertFalse(camera_summary(msg)['available'])

if __name__=='__main__':
    unittest.main()
