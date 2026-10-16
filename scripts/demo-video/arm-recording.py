#!/usr/bin/env python3
"""Bind a real fresh browser capture to an already prepared native demo run.

This helper writes only recording-go and an audit journal. It never creates
human approval, starts a recorder, prompts a model, or controls the simulator.
"""
from pathlib import Path
import argparse
import datetime
import json
import math
import os
import re
import sys
import time
import uuid

ROOT = Path("/data-ssd/zhongchengkai/agnes")
OUT = ROOT / "artifacts/demo-video-20261013"
RECORDINGS = OUT / "recordings"
RUNS = OUT / "runs"
SOURCE = "user_selected_browser_display_capture"
START_MAX_SECONDS = 118  # run-demo initial binding requires started_at < 120s


def read(path):
    if not path.resolve().is_relative_to(ROOT):
        raise ValueError("PROJECT_PATH_REQUIRED")
    return json.loads(path.read_text())


def iso_seconds(value):
    if not isinstance(value, str):
        raise ValueError("ISO_TIMESTAMP_REQUIRED")
    value = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("TIMEZONE_REQUIRED")
    return value.timestamp()


def eligible_capture(metadata, path, used_ids, now):
    try:
        ident = metadata["id"]
        parsed = uuid.UUID(ident)
        if parsed.version != 4 or str(parsed) != ident or path.parent.name != ident or ident in used_ids:
            return False
        if metadata["status"] != "RECORDING" or metadata["source"] != SOURCE:
            return False
        started = iso_seconds(metadata["started_at"])
        updated = iso_seconds(metadata["updated_at"])
        limit = metadata["limits"]["maxSeconds"]
        chunks = metadata.get("chunk_count", 0)
        if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not math.isfinite(limit) or not 0 < limit <= 1200:
            return False
        return (
            0 <= now - started < min(START_MAX_SECONDS, limit)
            and -2 <= now - updated < 15
            and type(chunks) is int
            and chunks >= 2
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def used_recording_ids():
    ids = set()
    for path in [*RUNS.glob("*/recording.json"), *RUNS.glob("*/candidate-review-*/recording.json")]:
        ident = read(path).get("id")
        if ident:
            ids.add(ident)
    for path in RUNS.glob("*/recording-go.json"):
        ident = read(path).get("recording_id")
        if ident:
            ids.add(ident)
    for path in RUNS.glob("*/recording-history.jsonl"):
        if not path.resolve().is_relative_to(ROOT):
            raise ValueError("PROJECT_PATH_REQUIRED")
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            value = json.loads(line)
            for key in ("current", "previous"):
                ident = value.get(key, {}).get("id")
                if ident:
                    ids.add(ident)
    return ids


def ready_run(run_id, directory):
    active = read(OUT / "active-run.json")
    state = read(directory / "state.json")
    plan = read(directory / "plan.json")
    expected = directory.resolve()
    if expected != RUNS.resolve() / run_id or not expected.is_relative_to(ROOT):
        raise ValueError("EXPECTED_RUN_DIRECTORY_REQUIRED")
    if (
        active.get("run_id") != run_id
        or active.get("status") != "READY_FOR_RECORDING"
        or Path(active.get("directory", "")).resolve() != expected
        or state.get("run_id") != run_id
        or state.get("status") != "READY_FOR_RECORDING"
        or plan.get("run_id") != run_id
        or not isinstance(state.get("session_id"), str)
        or not state["session_id"]
        or active.get("session_id") != state["session_id"]
        or plan.get("session_id") != state["session_id"]
    ):
        raise ValueError("ACTIVE_READY_RUN_AND_SESSION_REQUIRED")
    return state["session_id"]


def authorized(directory, run_id, session_id, now):
    try:
        value = read(directory / "human-approval.json")
        return (
            value.get("authorized") is True
            and value.get("run_id") == run_id
            and value.get("session_id") == session_id
            and iso_seconds(value.get("expires_at")) > now
        )
    except (OSError, ValueError, TypeError):
        return False


def write_exclusive_atomic(path, value):
    """Publish a complete file atomically; an existing target is never replaced."""
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)  # atomic creation, fails if recording-go already exists
        dirfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="Prepared guided-demo-ID")
    parser.add_argument("--wait-seconds", type=int, default=900)
    args = parser.parse_args(argv)
    if Path.cwd().resolve() != ROOT or not re.fullmatch(r"guided-demo-\d+", args.run):
        parser.error("Run inside the exact SSH project workspace with a guided-demo-ID")
    if not 1 <= args.wait_seconds <= 3600:
        parser.error("--wait-seconds must be between 1 and 3600")
    directory = RUNS / args.run
    session_id = ready_run(args.run, directory)
    target = directory / "recording-go.json"
    audit_path = directory / "recording-binding-audit.jsonl"

    def audit(event, **details):
        value = {
            "event": event,
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": args.run,
            "session_id": session_id,
            "watcher_pid": os.getpid(),
            **details,
        }
        with audit_path.open("a") as stream:
            stream.write(json.dumps(value, ensure_ascii=False) + "\n")
        print(json.dumps(value, ensure_ascii=False), flush=True)

    if target.exists():
        audit("REFUSED_EXISTING_RECORDING_GO", existing=read(target))
        return 2
    audit("ARMED_WAITING_FOR_REAL_CAPTURE", wait_seconds=args.wait_seconds, start_age_limit_seconds=START_MAX_SECONDS)
    deadline = time.monotonic() + args.wait_seconds
    while time.monotonic() < deadline:
        session_id = ready_run(args.run, directory)
        if target.exists():
            audit("REFUSED_EXISTING_RECORDING_GO", existing=read(target))
            return 2
        now = time.time()
        if not authorized(directory, args.run, session_id, now):
            time.sleep(0.25)
            continue
        used = used_recording_ids()
        captures = sorted(RECORDINGS.glob("*/metadata.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        for path in captures:
            try:
                metadata = read(path)
            except (OSError, ValueError):
                continue
            if not eligible_capture(metadata, path, used, now):
                continue
            # Recheck run identity, approval, binding exclusions and heartbeat just
            # before publication; a stale loop choice cannot bind.
            session_id = ready_run(args.run, directory)
            current = read(path)
            now = time.time()
            if not authorized(directory, args.run, session_id, now) or not eligible_capture(current, path, used_recording_ids(), now):
                continue
            go = {
                "run_id": args.run,
                "session_id": session_id,
                "recording_id": current["id"],
                "recording_source": current["source"],
                "bound_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            try:
                write_exclusive_atomic(target, go)
            except FileExistsError:
                audit("REFUSED_CONCURRENT_RECORDING_GO", existing=read(target))
                return 2
            audit(
                "BOUND_REAL_CAPTURE",
                recording_id=current["id"],
                started_at=current["started_at"],
                updated_at=current["updated_at"],
                source=current["source"],
                chunk_count=current["chunk_count"],
                age_seconds=now - iso_seconds(current["started_at"]),
                heartbeat_age_seconds=now - iso_seconds(current["updated_at"]),
                recorder_max_seconds=current["limits"]["maxSeconds"],
                authorization_file=str((directory / "human-approval.json").relative_to(ROOT)),
                recording_go=str(target.relative_to(ROOT)),
                generated_approval=False,
                recorder_started_by_helper=False,
            )
            return 0
        time.sleep(0.25)
    audit("TIMED_OUT_NO_ELIGIBLE_REAL_CAPTURE")
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(json.dumps({"event": "ARMING_REFUSED", "error": str(error), "robot_actions": False, "model_calls": False}), file=sys.stderr)
        raise SystemExit(2)
