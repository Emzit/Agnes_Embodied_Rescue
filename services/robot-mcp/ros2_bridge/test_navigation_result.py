import unittest
from navigation_result import nav2_result_details

class NavigationResultTest(unittest.TestCase):
    def test_controller_patience_preserves_raw_message_and_no_collision_claim(self):
        actual = nav2_result_details('ABORTED', 104, 'Controller patience exceeded')
        self.assertEqual(actual, {'error_code':104, 'error_msg':'Controller patience exceeded',
                                  'reason':'CONTROLLER_PATIENCE_EXCEEDED'})
        self.assertNotEqual(actual['reason'], 'NAVIGATION_SYSTEM_UNHEALTHY')
        self.assertNotIn('collision', actual)

    def test_other_abort_is_not_hardware_failure(self):
        self.assertEqual(nav2_result_details('ABORTED',105,'No progress')['reason'], 'NAVIGATION_ABORTED')
        self.assertEqual(nav2_result_details('ABORTED',102,'TF error','TF_UNAVAILABLE')['reason'], 'TF_UNAVAILABLE')

    def test_cancel_and_success_are_not_reclassified_by_leftover_codes(self):
        self.assertEqual(nav2_result_details('CANCELED',104,'cancel')['reason'], 'ROBOT_STOPPED')
        self.assertEqual(nav2_result_details('SUCCEEDED',0,''), {'error_code':0,'error_msg':''})

    def test_blocked_reason_is_preserved_only_when_independently_supplied(self):
        self.assertEqual(nav2_result_details('ABORTED',104,'patience','PATH_BLOCKED')['reason'], 'PATH_BLOCKED')
        self.assertEqual(nav2_result_details('ABORTED',104,'patience','NAVIGATION_SYSTEM_UNHEALTHY')['reason'],
                         'CONTROLLER_PATIENCE_EXCEEDED')

if __name__ == '__main__':
    unittest.main()
