#!/usr/bin/env python3
"""Read-only timing analysis of real AGH recording evidence; never drives the robot.

A generated draft is deliberately unreviewed. Unknown intervals remain at 1x.
Source-bound, manually reviewed stationary intervals may be accelerated.
Action speed proposals are limited to 1-4x and remain visibly labelled, unreviewed drafts.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "artifacts/demo-video-20261013"
STAGES = ("start", "near", "middle_scan", "middle", "front", "confirm")
MOVING = {"navigate_to", "inspect_room", "inspect_object", "open_door", "stop_robot"}


def inside(value):
    p = Path(value)
    p = (p if p.is_absolute() else ROOT / p).resolve()
    if not p.is_relative_to(ROOT):
        raise ValueError("Path outside authorized workspace")
    return p


def rel(p):
    return str(inside(p).relative_to(ROOT))


def obj(x):
    for _ in range(3):
        if not isinstance(x, str):
            break
        try:
            x = json.loads(x)
        except (ValueError, TypeError):
            break
    return x if isinstance(x, dict) else {}


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def epoch(x):
    if finite(x):
        return float(x) / 1000 if x > 1e11 else float(x)
    if isinstance(x, str):
        try:
            return dt.datetime.fromisoformat(x.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    return None


def read_json(p, default=None):
    p = inside(p)
    return json.loads(p.read_text()) if p.exists() else default


def rows(p, needles=()):
    p = inside(p)
    if not p.exists():
        return
    with p.open() as f:
        for n, line in enumerate(f, 1):
            if needles and not any(needle in line for needle in needles):
                continue
            if line.strip():
                try:
                    yield n, json.loads(line)
                except json.JSONDecodeError as ex:
                    # An actively appended final line may be incomplete.
                    if not line.endswith("\n"):
                        return
                    raise ValueError(f"{rel(p)}:{n}: {ex}") from ex


def sha256(p):
    p = inside(p)
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def overlap(a, b):
    return min(a[1], b[1]) > max(a[0], b[0]) + 1e-6


def merge(items):
    output = []
    for a, b in sorted(items):
        if b <= a:
            continue
        if output and a <= output[-1][1]:
            output[-1][1] = max(output[-1][1], b)
        else:
            output.append([a, b])
    return output


def motion_times(m):
    samples = m.get("samples", [])
    times = [epoch(s.get("at")) for s in samples if isinstance(s, dict)]
    summary = obj(m.get("sample_summary"))
    for key in ("first", "last"):
        times.append(epoch(obj(summary.get(key)).get("at")))
    times = [t for t in times if t is not None]
    return (min(times), max(times)) if times else None


def walk_motions(value, path=""):
    if isinstance(value, dict):
        if value.get("motion") == "ROTATION_ONLY":
            yield path, value
        for k, v in value.items():
            if k != "samples":
                yield from walk_motions(v, path + "." + k)
    elif isinstance(value, list):
        for n, v in enumerate(value):
            yield from walk_motions(v, path + f"[{n}]")


def analyze(args):
    run = inside(args.run) if "/" in args.run else BASE / "runs" / args.run
    state = read_json(run / "state.json", {})
    association = read_json(run / "recording.json", {})
    if args.recording_id and args.recording_id != association.get("id"):
        matches = [obj(row.get(key)) for _, row in rows(run / "recording-history.jsonl")
                   if row.get("run_id") == run.name for key in ("previous", "current")
                   if obj(row.get(key)).get("id") == args.recording_id]
        if not matches:
            raise ValueError("Requested recording is not linked to this run's retained history")
        association = matches[0]
    recording_id = association.get("id")
    if not recording_id or Path(recording_id).name != recording_id:
        raise ValueError("Run must identify its actual recording.json")
    rec = inside(BASE / "recordings" / recording_id)
    metadata = read_json(rec / "metadata.json", {})
    if metadata.get("id") != recording_id or metadata.get("started_at") != association.get("started_at"):
        raise ValueError("Run and recording metadata do not match")
    origin = epoch(metadata.get("started_at"))
    if origin is None:
        raise ValueError("Missing recording wall-clock start")
    source = inside(rec / "source.webm")
    completed = metadata.get("status") == "COMPLETE" and source.exists()
    actual_sha = sha256(source) if completed else None
    if completed and actual_sha != metadata.get("sha256"):
        raise ValueError("Source SHA256 disagrees with recording metadata")
    duration = obj(metadata.get("probe")).get("duration_seconds")
    if not finite(duration):
        duration = max(0, (epoch(metadata.get("updated_at")) or origin) - origin)
    duration = float(duration)
    alignment = read_json(inside(args.alignment), {}) if args.alignment else {}
    aligned = bool(alignment.get("verified") is True and actual_sha and
                   alignment.get("source_sha256") == actual_sha and
                   all(alignment.get(k) for k in ("reviewer", "reviewed_at", "notes")) and
                   finite(alignment.get("offset_seconds")))
    if args.alignment and not aligned:
        raise ValueError("Alignment needs verified source-bound human review")
    offset = float(alignment.get("offset_seconds", 0))
    margin = args.margin
    if not finite(margin) or margin < 1 or margin > 10:
        raise ValueError("Margin must be 1..10 seconds")
    def position(t):
        return max(0, min(duration, t - origin + offset))
    protected, motions, candidates, operations, inspections, calls = [], [], [], {}, {}, []
    def protect(a, b, reason, evidence, **extra):
        if a is None or b is None or b < a:
            return
        start, end = position(a - margin), position(b + margin)
        if end > start:
            protected.append(dict(start=start, end=end, reason=reason, evidence=evidence, **extra))
    event_path = run / "tool-results.jsonl"
    event_rows = list(rows(event_path))
    last_event = max([epoch(x.get("at")) or origin for _, x in event_rows] + [origin])
    for n, e in event_rows:
        d = obj(e.get("result"))
        ref = dict(file=rel(event_path), line=n, event_seq=e.get("event_seq"),
                   tool_call_id=e.get("tool_call_id"), stage=e.get("stage"))
        at, call_at = epoch(e.get("at")), epoch(e.get("call_at")) or epoch(e.get("at"))
        tool = e.get("tool")
        if tool in MOVING and (d or not isinstance(e.get("result"), str)):
            calls.append(dict(tool=tool, at=at, call_at=call_at, result=d,
                              args=obj(e.get("args")), ref=ref))
        if tool == "navigate_to" and d.get("accepted") is True and d.get("operation_id"):
            operations[d["operation_id"]] = dict(start=call_at, end=None, evidence=[ref],
                                                  target=obj(e.get("args")).get("location"))
        if tool == "inspect_room" and d.get("accepted") is True and d.get("inspection_id"):
            inspections[d["inspection_id"]] = dict(start=call_at, end=None, snapshots=[],
                                                     evidence=[ref], room=d.get("room"))
        op = d.get("navigation_operation_id")
        if op in operations and d.get("navigation_terminal_known") is True and d.get("navigation_active") is False:
            operations[op]["end"] = operations[op]["end"] or at
            operations[op]["evidence"].append(ref)
        ins = obj(d.get("inspection"))
        iid = ins.get("inspection_id")
        if iid in inspections:
            inspections[iid]["snapshots"].append((at, ins, ref))
            if ins.get("terminal_known") is True and ins.get("active") is False:
                inspections[iid]["end"] = inspections[iid]["end"] or epoch(ins.get("updated_at")) or at
    if args.trace_dir:
        trace = inside(args.trace_dir) / "onboard-path-events.jsonl"
        for n, e in rows(trace):
            op = operations.get(e.get("operation_id"))
            if not op:
                continue
            stamp = epoch(e.get("wall_time"))
            if stamp is None or stamp < origin - 10:
                continue
            ref = dict(file=rel(trace), line=n, operation_id=e.get("operation_id"),
                       goal_id=e.get("goal_id"))
            if e.get("type") == "navigation_accepted":
                op["start"] = epoch(e.get("accepted_at")) or stamp
                op["evidence"].append(ref)
            elif e.get("type") == "navigation_terminal" and e.get("terminal_known") is True:
                op["end"] = stamp
                op["evidence"].append(ref)
        # Budget-compacted tool responses omit per-view wall-clock motion samples.
        # Recover only this run's inspection IDs from the original bridge audit.
        raw_trace = inside(args.trace_dir) / "ros2-events.jsonl"
        if inspections:
            for n, e in rows(raw_trace, tuple(inspections)):
                result = obj(e.get("result"))
                inspection = obj(result.get("inspection")) or obj(obj(result.get("robot")).get("inspection"))
                iid = inspection.get("inspection_id")
                stamp = epoch(e.get("time"))
                if iid not in inspections or stamp is None or stamp < origin - 10:
                    continue
                ref = dict(file=rel(raw_trace), line=n, inspection_id=iid,
                           request_id=e.get("request_id"), method=e.get("method"))
                inspections[iid]["snapshots"].append((stamp, inspection, ref))
                if inspection.get("terminal_known") is True and inspection.get("active") is False:
                    inspections[iid]["end"] = inspections[iid]["end"] or epoch(inspection.get("updated_at")) or stamp
    for oid, op in operations.items():
        protect(op["start"], op["end"] or max(last_event, origin + duration - offset),
                "Navigation; preserve physical travel at 1x", op["evidence"],
                operation_id=oid, terminal_known=op["end"] is not None, target=op["target"])
    for iid, ins in inspections.items():
        scan_motions = {}
        for at, snapshot, ref in ins["snapshots"]:
            for path, m in walk_motions(snapshot):
                times = motion_times(m)
                if times:
                    a, b = times
                    scan_motions[(a, b)] = dict(start=a, end=b, evidence=[ref], detail=path,
                                                 inspection_id=iid, status=m.get("status"))
        ordered = sorted(scan_motions.values(), key=lambda m: m["start"])
        terminal = ins["end"] or max(last_event, origin + duration - offset)
        if not ordered:
            protect(ins["start"], terminal, "Scan lacks motion timestamps; preserve whole call",
                    ins["evidence"], inspection_id=iid)
            continue
        protect(ins["start"], ordered[0]["start"], "Scan startup without independently timed motion",
                ins["evidence"], inspection_id=iid)
        for m in ordered:
            protect(m["start"], m["end"], "Measured camera rotation", m["evidence"],
                    inspection_id=iid, motion_status=m["status"])
            motions.append(dict(start=position(m["start"]), end=position(m["end"]),
                                **{k:v for k,v in m.items() if k not in ("start","end")}))
        for previous, following in zip(ordered, ordered[1:]):
            a, b = position(previous["end"] + margin), position(following["start"] - margin)
            if b > a:
                candidates.append(dict(start=a, end=b, reason="Gap between measured scan rotations; visually verify stationary inference wait",
                                       evidence=previous["evidence"] + following["evidence"],
                                       verified=False, inspection_id=iid))
        # Terminal/return motion may be omitted from compact responses, and partial scans
        # can contain a failed rotation after their last saved view. Preserve this tail.
        protect(ordered[-1]["end"], terminal, "Scan tail or return rotation; retain incomplete/unsampled movement",
                ins["evidence"], inspection_id=iid)
    for c in calls:
        tool, d = c["tool"], c["result"]
        if tool == "navigate_to" and d.get("operation_id") in operations:
            continue
        if tool == "inspect_room" and d.get("inspection_id") in inspections:
            continue
        # Open-door calls include real handle and hinge animation; never guess away
        # these portions. Object inspection also contains movement and fresh frames.
        protect(c["call_at"], c["at"], "Conservative full tool interval: " + str(tool), [c["ref"]])
        for path, m in walk_motions(d):
            times = motion_times(m)
            if times:
                motions.append(dict(start=position(times[0]), end=position(times[1]),
                                    evidence=[c["ref"]], detail=path, status=m.get("status")))
    # Unclassified time is never automatically called stationary. A reviewer must
    # inspect the video and supply source-bound intervals before any acceleration.
    merged = merge([(p["start"],p["end"]) for p in protected])
    waits_doc = read_json(inside(args.reviewed_waits), {}) if args.reviewed_waits else {}
    waits = []
    if args.reviewed_waits:
        if not completed or not aligned:
            raise ValueError("Reviewed waits require complete recording and verified alignment")
        if (waits_doc.get("source_sha256") != actual_sha or
            waits_doc.get("verified") is not True or
            not all(waits_doc.get(k) for k in ("reviewer", "reviewed_at", "notes"))):
            raise ValueError("Wait review must explicitly verify this source and explain observation")
        for w in waits_doc.get("intervals", []):
            a, b = w.get("start"), w.get("end")
            if not finite(a) or not finite(b) or a < 0 or b > duration or b <= a or not w.get("reason"):
                raise ValueError("Invalid reviewed stationary wait interval")
            if any(overlap((a,b), p) for p in merged):
                raise ValueError("Reviewed wait intersects protected real or unknown action")
            waits.append(dict(start=a,end=b,reason=w["reason"]))
        if any(overlap((a["start"],a["end"]),(b["start"],b["end"])) for i,a in enumerate(waits) for b in waits[i+1:]):
            raise ValueError("Reviewed waits overlap")
    waiting = sum(w["end"]-w["start"] for w in waits)
    action_duration = sum(b-a for a,b in merged)
    action_saved = action_duration * (1 - 1 / args.action_speed)
    kept = duration - waiting - action_saved
    speed = 1.0
    feasible = duration - action_saved <= args.target
    if duration - action_saved > args.target and waiting > 0 and kept < args.target:
        requested_speed = waiting / (args.target - kept)
        speed = min(32.0, max(1.0, requested_speed))
        feasible = requested_speed <= 32
    expected = kept + waiting / speed
    stages = {}
    for stage in STAGES:
        candidates_stage = [p for p in run.glob("stage-*.json")
                            if p.name == "stage-" + stage + ".json" or p.name.startswith("stage-" + stage + "-resume-")]
        if candidates_stage:
            p = max(candidates_stage, key=lambda candidate: candidate.stat().st_mtime_ns)
            stages[stage] = obj(read_json(p)).get("evidence")
    final_at = epoch(state.get("updated_at"))
    success = (state.get("status") == "LOCATED_AND_STOPPED" and
               all(obj(stages.get(s)).get("ok") is True for s in STAGES) and
               final_at is not None and origin <= final_at <= origin + duration + 2)
    focus = read_json(run / "focus-ready.json", {})
    focus_at = epoch(focus.get("at"))
    ending = dict(result="located_and_stopped" if success else "search_incomplete",
                  evidence=[rel(run/"state.json")] + ([rel(run/"stage-confirm.json")] if success else []))
    boundaries = {0.0,duration}
    for w in waits:
        boundaries.update((float(w["start"]),float(w["end"])))
    for a,b in merged:
        boundaries.update((a,b))
    segments = []
    points = sorted(boundaries)
    for a,b in zip(points,points[1:]):
        if b-a < 0.001:
            continue
        wait = next((w for w in waits if w["start"] <= a+1e-6 and w["end"] >= b-1e-6),None)
        action = any(overlap((a,b),p) for p in merged)
        kind = "wait" if wait else "action" if action else "overview"
        caption = "等待模型观察（已核验静止等待）" if wait else "预设搜寻路线 · 实时执行"
        segments.append(dict(id=f"segment_{len(segments)+1:03}", start=round(a,6),end=round(b,6),
                             speed=speed if wait else args.action_speed if action else 1,
                             kind=kind,caption=caption,
                             **({"speed_reason":"Review this complete real action at modest speed; retain source order and visible speed subtitle."} if action and args.action_speed > 1 else {}),
                             evidence=[rel(event_path)]))
    draft = dict(version=1,source_kind="screen-recording",source=rel(source),
                 source_sha256=actual_sha or "RECORDING_NOT_COMPLETE",
                 review=dict(verified=False,reviewer="",reviewed_at="",
                             notes="自动生成待审核时间线；核对录像、对齐偏移、动作完整性与字幕后才能交付。"),
                 target_duration=args.target,tolerance_seconds=15,ending=ending,segments=segments)
    report = dict(version=1,run_id=run.name,recording_id=recording_id,status=state.get("status"),
                  recording_complete=completed,source=rel(source),source_sha256=actual_sha,
                  duration_seconds=duration,recording_started_at=metadata.get("started_at"),
                  alignment=dict(verified=aligned,offset_seconds=offset,
                                 convention="source_seconds = wall_epoch - recording_started_epoch + offset_seconds",
                                 caution="Server start precedes MediaRecorder start; default zero is approximate. ROS frame timestamps are simulation time, never used as wall clock."),
                  focus_ready_source_seconds=position(focus_at) if focus_at else None,
                  protected_intervals=protected,protected_union=merged,measured_motions=motions,
                  stationary_wait_candidates=candidates,reviewed_waits=waits,
                  timing_budget=dict(target_seconds=args.target,protected_seconds=sum(b-a for a,b in merged),
                                     kept_output_seconds=kept,reviewed_wait_seconds=waiting,
                                     proposed_action_speed=args.action_speed,action_seconds_saved=action_saved,
                                     proposed_wait_speed=speed,expected_output_seconds=expected,
                                     can_fit_target_at_proposed_speeds=feasible,
                                     note="Action speed is a draft proposal and must carry a speed label. Unclassified time stays 1x; lengthen output when the verified cuts cannot meet target."),
                  stage_evidence=stages,ending=ending,
                  next_steps=["Visually calibrate recording offset using first actual motion, preserving >=1s margin.",
                              "Review candidate waits in source video; supply verified alignment and reviewed-waits JSON.",
                              "Review generated draft and captions; never change failed run into a success ending."])
    out = inside(args.out or (run/"timing-analysis"))
    if out in (run,rec) or out == ROOT or out.is_relative_to(rec):
        raise ValueError("Use a dedicated analysis output directory outside recording inputs")
    out.mkdir(parents=True, exist_ok=True)
    for name,value in (("analysis.json",report),("timeline.draft.json",draft)):
        (out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"report":rel(out/"analysis.json"),"draft":rel(out/"timeline.draft.json"),
                      "status":state.get("status"),"duration_seconds":duration,
                      "protected_intervals":len(merged),"measured_motion_intervals":len(motions),
                      "candidate_waits":len(candidates),"expected_output_seconds":expected,
                      "review_verified":False},ensure_ascii=False))


def self_test():
    assert epoch(1791883765000) == epoch(1791883765)
    assert epoch({"sec":1,"nanosec":0}) is None
    assert merge([(1,2),(2,3),(5,6)]) == [[1,3],[5,6]]
    assert overlap((1,2),(1.5,3)) and not overlap((1,2),(2,3))
    assert motion_times({"samples":[{"at":100},{"at":102}]}) == (100,102)
    assert motion_times({"sample_summary":{"first":{"at":100},"last":{"at":102}}}) == (100,102)
    assert motion_times({"duration_sec":20}) is None
    try:
        inside("/etc/passwd")
        raise AssertionError("Accepted outside path")
    except ValueError:
        pass
    assert obj("approval rejected") == {}
    assert obj('"{\\"status\\":\\"SUCCEEDED\\"}"') == {"status":"SUCCEEDED"}
    print("10 timing-analysis unit checks passed; no recording or robot was used")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run")
    p.add_argument("--recording-id",help="Analyze a retained recording linked by this run recording-history.jsonl")
    p.add_argument("--trace-dir",help="Project trace directory; reads matching navigation operations only")
    p.add_argument("--alignment",help="Manually verified JSON: verified, source_sha256, offset_seconds, reviewer, reviewed_at, notes")
    p.add_argument("--reviewed-waits",help="Manually verified JSON: verified, source_sha256, reviewer, reviewed_at, notes, intervals[{start,end,reason}]")
    p.add_argument("--out")
    p.add_argument("--target",type=float,default=300)
    p.add_argument("--margin",type=float,default=1.5)
    p.add_argument("--action-speed",type=float,default=1,help="Draft action acceleration 1-4x; requires review and visible speed labels before delivery")
    p.add_argument("--self-test",action="store_true")
    args = p.parse_args()
    if args.self_test:
        self_test()
    elif not args.run:
        p.error("--run is required")
    elif not finite(args.action_speed) or not 1 <= args.action_speed <= 4:
        p.error("--action-speed must be finite and between 1 and 4")
    elif not finite(args.target) or not 1 <= args.target <= 7200:
        p.error("--target must be finite and between 1 and 7200")
    else:
        analyze(args)
