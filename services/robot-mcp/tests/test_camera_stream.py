"""Camera reader lifecycle tests run without ROS, model calls or motion."""
from pathlib import Path
import sys
import threading
import time
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ros2_bridge"))
from camera_stream import CameraStream, CameraStreamUnavailable


def image(sec=1, nanosec=0):
    return SimpleNamespace(header=SimpleNamespace(
        stamp=SimpleNamespace(sec=sec, nanosec=nanosec)))


class Readers:
    def __init__(self):
        self.callbacks = []
        self.destroyed = []

    def create(self, callback):
        self.callbacks.append(callback)
        return len(self.callbacks)

    def destroy(self, reader):
        self.destroyed.append(reader)


class CameraStreamTests(unittest.TestCase):
    def setUp(self):
        self.readers = Readers()
        self.stream = CameraStream(self.readers.create, self.readers.destroy,
                                   recovery_cooldown_sec=0.05)
        self.assertTrue(self.stream.start())

    def tearDown(self):
        self.stream.close()

    def later(self, callback, delay=0.01):
        timer = threading.Timer(delay, callback)
        timer.start()
        self.addCleanup(timer.join)

    def test_startup_wait_receives_actual_new_frame_without_rebuild(self):
        msg = image(12)
        self.later(lambda: self.readers.callbacks[0](msg))
        self.assertIs(self.stream.wait_fresh(timeout_sec=.15,
                                            startup_grace_sec=.10), msg)
        self.assertEqual(len(self.readers.callbacks), 1)

    def test_stale_reader_is_rebuilt_once_and_new_generation_frame_required(self):
        old = image(10)
        self.readers.callbacks[0](old)
        time.sleep(.015)
        def deliver_replacement():
            until = time.monotonic() + .2
            while len(self.readers.callbacks) < 2 and time.monotonic() < until:
                time.sleep(.001)
            self.readers.callbacks[-1](image(11))
        self.later(deliver_replacement)
        msg = self.stream.wait_fresh(timeout_sec=.2, max_age_sec=.01,
                                     startup_grace_sec=0)
        self.assertEqual(msg.header.stamp.sec, 11)
        self.assertEqual(self.readers.destroyed, [1])
        self.assertEqual(self.stream.diagnostics()["reader_recoveries"], 1)

    def test_missing_camera_timeout_fails_closed_after_only_one_rebuild(self):
        with self.assertRaises(CameraStreamUnavailable) as caught:
            self.stream.wait_fresh(timeout_sec=.025, startup_grace_sec=0)
        self.assertEqual(len(self.readers.callbacks), 2)
        self.assertEqual(caught.exception.diagnostics["messages_received"], 0)
        self.assertFalse(caught.exception.diagnostics["available"])

    def test_late_callback_from_destroyed_reader_cannot_restore_old_image(self):
        self.readers.callbacks[0](image(10))
        self.assertTrue(self.stream.recreate())
        self.readers.callbacks[0](image(999))
        self.assertEqual(self.stream.diagnostics()["messages_received"], 1)
        self.assertEqual(self.stream.diagnostics()["obsolete_callbacks_ignored"], 1)
        self.assertFalse(self.stream.diagnostics()["available"])
        self.readers.callbacks[1](image(11))
        self.assertEqual(self.stream.wait_fresh().header.stamp.sec, 11)

    def test_fresh_previous_stamp_waits_for_next_stamp_without_rebuilding(self):
        self.readers.callbacks[0](image(17))
        self.later(lambda: self.readers.callbacks[0](image(18)))
        self.assertEqual(self.stream.wait_fresh((17, 0), timeout_sec=.15,
                                               startup_grace_sec=0).header.stamp.sec, 18)
        self.assertEqual(len(self.readers.callbacks), 1)

    def test_repeated_stamp_cannot_fake_new_frame(self):
        self.readers.callbacks[0](image(17))
        with self.assertRaises(CameraStreamUnavailable) as caught:
            self.stream.wait_fresh((17, 0), timeout_sec=.01, startup_grace_sec=0)
        self.assertEqual(caught.exception.diagnostics["reason"], "WAITING_NEW_FRAME")
        self.assertEqual(len(self.readers.callbacks), 1)

    def test_clock_reset_does_not_mark_received_image_stale(self):
        self.readers.callbacks[0](image(50000))
        self.readers.callbacks[0](image(0, 2000000))
        self.assertTrue(self.stream.diagnostics()["available"])
        self.assertEqual(self.stream.wait_fresh((50000, 0)).header.stamp.sec, 0)

    def test_recovery_cooldown_applies_across_calls(self):
        self.assertTrue(self.stream.recreate())
        self.assertFalse(self.stream.recreate())
        self.assertEqual(len(self.readers.callbacks), 2)

    def test_cache_hook_completes_before_sample_becomes_available(self):
        cache = []
        extra = CameraStream(self.readers.create, self.readers.destroy,
                             on_frame=cache.append)
        self.addCleanup(extra.close)
        extra.start()
        msg = image(33)
        self.readers.callbacks[-1](msg)
        self.assertIs(extra.wait_fresh(), cache[-1])

    def test_failed_reader_creation_is_diagnostic_and_no_frame_is_returned(self):
        stream = CameraStream(lambda callback: None, self.readers.destroy)
        self.addCleanup(stream.close)
        self.assertFalse(stream.start())
        self.assertEqual(stream.diagnostics()["reason"], "CAMERA_READER_CREATE_FAILED")
        with self.assertRaises(CameraStreamUnavailable):
            stream.wait_fresh(timeout_sec=.001, recover_once=False)

    def test_failed_destroy_does_not_create_duplicate_reader(self):
        stream = CameraStream(self.readers.create,
                              lambda reader: (_ for _ in ()).throw(RuntimeError()))
        self.addCleanup(stream.close)
        self.assertTrue(stream.start())
        before = len(self.readers.callbacks)
        self.assertFalse(stream.recreate())
        self.assertEqual(len(self.readers.callbacks), before)
        self.assertEqual(stream.diagnostics()["reason"], "CAMERA_READER_DESTROY_FAILED")

    def test_destroy_false_return_preserves_ownership_and_no_duplicate(self):
        attempts = []
        def deny(reader):
            attempts.append(reader)
            return False
        stream = CameraStream(self.readers.create, deny, recovery_cooldown_sec=0)
        self.addCleanup(stream.close)
        self.assertTrue(stream.start())
        before = len(self.readers.callbacks)
        self.assertFalse(stream.recreate())
        self.assertFalse(stream.recreate())
        self.assertEqual(len(self.readers.callbacks), before)
        self.assertEqual(len(attempts), 2)
        self.assertTrue(stream.diagnostics()["reader_active"])
        self.assertFalse(stream.diagnostics()["available"])

    def test_start_is_idempotent_does_not_add_second_reader(self):
        self.assertTrue(self.stream.start())
        self.assertEqual(len(self.readers.callbacks), 1)

    def test_close_wakes_waiter_and_destroys_only_own_reader(self):
        self.later(self.stream.close)
        with self.assertRaises(CameraStreamUnavailable) as caught:
            self.stream.wait_fresh(timeout_sec=.2, startup_grace_sec=.1)
        self.assertEqual(caught.exception.diagnostics["reason"], "CLOSED")
        self.assertEqual(self.readers.destroyed, [1])

    def test_invalid_budgets_are_rejected(self):
        for kwargs in [{"timeout_sec": -1}, {"max_age_sec": 0},
                       {"startup_grace_sec": -1}]:
            with self.assertRaises(ValueError):
                self.stream.wait_fresh(**kwargs)


if __name__ == "__main__":
    unittest.main()
