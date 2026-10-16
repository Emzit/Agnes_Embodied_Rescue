"""Bounded latest ROS-camera reader; no publishers, inference or motion.

The caller supplies reader creation/destruction so lifecycle logic is testable
without ROS. Call start(), wait_fresh() and diagnostics() outside any enclosing
bridge lock. The optional on_frame hook must be a short cache write and must
not call back into this helper.
"""
from dataclasses import dataclass
import threading
import time


class CameraStreamUnavailable(RuntimeError):
    def __init__(self, diagnostics):
        super().__init__("CAMERA_UNAVAILABLE")
        self.diagnostics = diagnostics


@dataclass(frozen=True)
class _Sample:
    message: object
    received_at: float
    stamp: tuple | None
    generation: int
    sequence: int


def frame_stamp(message):
    try:
        return (int(message.header.stamp.sec), int(message.header.stamp.nanosec))
    except (AttributeError, TypeError, ValueError):
        return None


class CameraStream:
    """Own one reader, reject obsolete callbacks and recover only that reader."""

    def __init__(self, create_reader, destroy_reader, *, on_frame=None,
                 monotonic=time.monotonic, recovery_cooldown_sec=5.0):
        self._create_reader = create_reader
        self._destroy_reader = destroy_reader
        self._on_frame = on_frame
        self._clock = monotonic
        self._cooldown = max(0.0, float(recovery_cooldown_sec))
        self._condition = threading.Condition()
        self._lifecycle = threading.Lock()
        self._reader = None
        self._sample = None
        self._generation = 0
        self._messages = 0
        self._generation_messages = 0
        self._obsolete_callbacks = 0
        self._recoveries = 0
        self._last_recovery_at = None
        self._reader_error = None
        self._closed = False

    def _receive(self, generation, message):
        with self._condition:
            if self._closed or generation != self._generation:
                self._obsolete_callbacks += 1
                return
            # Publish the caller's cache before exposing this sample as fresh.
            # The hook is intentionally inside this short critical section.
            try:
                if self._on_frame is not None:
                    self._on_frame(message)
            except Exception:
                self._reader_error = "CAMERA_CACHE_WRITE_FAILED"
                self._condition.notify_all()
                return
            self._messages += 1
            self._generation_messages += 1
            self._sample = _Sample(message, self._clock(), frame_stamp(message),
                                   generation, self._messages)
            self._reader_error = None
            self._condition.notify_all()

    def _install(self, *, recovering=False):
        with self._lifecycle:
            with self._condition:
                if self._closed:
                    return False
                if recovering:
                    now = self._clock()
                    if (self._last_recovery_at is not None
                            and now - self._last_recovery_at < self._cooldown):
                        return False
                    self._last_recovery_at = now
                    self._recoveries += 1
                elif self._reader is not None:
                    return True
                old_reader = self._reader
                self._reader = None
                self._generation += 1
                generation = self._generation
                self._generation_messages = 0
                self._reader_error = None
            if old_reader is not None:
                try:
                    destroyed = self._destroy_reader(old_reader)
                    if destroyed is False:
                        raise RuntimeError("CAMERA_READER_DESTROY_FAILED")
                except Exception:
                    # No replacement on a failed destroy: avoid duplicate readers.
                    with self._condition:
                        # Keep ownership so close/retry can still destroy it.
                        # Old generation callbacks remain rejected.
                        self._reader = old_reader
                        self._reader_error = "CAMERA_READER_DESTROY_FAILED"
                        self._condition.notify_all()
                    return False
            try:
                reader = self._create_reader(
                    lambda message: self._receive(generation, message))
                if reader is None:
                    raise RuntimeError("CAMERA_READER_CREATE_FAILED")
            except Exception:
                with self._condition:
                    self._reader_error = "CAMERA_READER_CREATE_FAILED"
                    self._condition.notify_all()
                return False
            with self._condition:
                self._reader = reader
                self._condition.notify_all()
            return True

    def start(self):
        return self._install()

    def recreate(self):
        """At most one reader; respect cooldown shared across observation calls."""
        return self._install(recovering=True)

    def _fresh_sample(self, now, max_age_sec):
        sample = self._sample
        if (sample is None or sample.generation != self._generation
                or now - sample.received_at > max_age_sec):
            return None
        return sample

    def diagnostics(self, *, max_age_sec=2.0, previous=None):
        with self._condition:
            now = self._clock()
            sample = self._sample
            age = None if sample is None else max(0.0, now - sample.received_at)
            fresh = self._fresh_sample(now, max_age_sec)
            if self._closed:
                reason = "CLOSED"
            elif self._reader_error:
                reason = self._reader_error
            elif sample is None:
                reason = "NO_FRAME"
            elif sample.generation != self._generation:
                reason = "NO_FRAME_AFTER_READER_RECREATE"
            elif fresh is None:
                reason = "STALE_FRAME"
            elif previous is not None and sample.stamp == previous:
                reason = "WAITING_NEW_FRAME"
            else:
                reason = "AVAILABLE"
            return {
                "available": reason == "AVAILABLE", "reason": reason,
                "age_sec": age, "max_age_sec": float(max_age_sec),
                "frame_timestamp": None if sample is None or sample.stamp is None
                    else {"sec": sample.stamp[0], "nanosec": sample.stamp[1]},
                "generation": self._generation,
                "sample_generation": None if sample is None else sample.generation,
                "messages_received": self._messages,
                "generation_messages_received": self._generation_messages,
                "obsolete_callbacks_ignored": self._obsolete_callbacks,
                "reader_recoveries": self._recoveries,
                "reader_active": self._reader is not None,
                "closed": self._closed,
            }

    def wait_fresh(self, previous=None, *, timeout_sec=5.0, max_age_sec=2.0,
                   startup_grace_sec=0.5, recover_once=True):
        """Return actual received message; never promote a stale cached frame."""
        if timeout_sec < 0 or max_age_sec <= 0 or startup_grace_sec < 0:
            raise ValueError("INVALID_CAMERA_WAIT_BUDGET")
        started = self._clock()
        deadline = started + timeout_sec
        recovery_checked = False
        while True:
            should_recover = False
            with self._condition:
                now = self._clock()
                sample = self._fresh_sample(now, max_age_sec)
                if (sample is not None and not self._closed
                        and (previous is None or sample.stamp != previous)):
                    return sample.message
                remaining = deadline - now
                if self._closed or remaining <= 0:
                    break
                # A fresh repeated stamp is not a dead reader; simply await
                # a distinct sensor stamp inside the same deadline.
                if (recover_once and not recovery_checked and sample is None
                        and now - started >= startup_grace_sec):
                    recovery_checked = True
                    should_recover = True
                else:
                    grace_left = startup_grace_sec - (now - started)
                    wait = min(remaining, max(0.001, grace_left)
                               if recover_once and not recovery_checked else remaining)
                    self._condition.wait(wait)
            if should_recover:
                self.recreate()
        raise CameraStreamUnavailable(
            self.diagnostics(max_age_sec=max_age_sec, previous=previous))

    def close(self):
        with self._lifecycle:
            with self._condition:
                if self._closed:
                    return
                self._closed = True
                self._generation += 1
                reader, self._reader = self._reader, None
                self._condition.notify_all()
            if reader is not None:
                try:
                    self._destroy_reader(reader)
                except Exception:
                    with self._condition:
                        self._reader_error = "CAMERA_READER_DESTROY_FAILED"
