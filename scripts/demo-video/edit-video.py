#!/usr/bin/env python3
"""Edit a reviewed, chronologically ordered real screen recording inside this workspace."""
import argparse
import hashlib
import json
import math
import os
import re
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "runtime/ros2-jazzy/.pixi/envs/default/bin"
VALIDATION_DIR = ROOT / "artifacts/demo-video-20261013/edit-validation"
DISCLOSURE = "Agnes Harness · 室内火灾搜寻演示"
ENDINGS = {
    "located_and_stopped": "已定位人员目标并停止\n本次展示完成视觉搜寻与接近确认",
    "search_incomplete": "搜寻尚未完成\n结果以 AGH 执行记录与实时观测为准",
    "observation_only": "本次完成环境观察\n尚未确认人员目标",
}

def inside(value, exists=False):
    p = Path(value)
    p = (ROOT / p).resolve() if not p.is_absolute() else p.resolve()
    if p != ROOT and ROOT not in p.parents:
        raise ValueError("Path must stay inside project workspace: " + str(value))
    if exists and not p.is_file():
        raise ValueError("Required file is missing: " + str(p))
    return p

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def run(args):
    subprocess.run([str(x) for x in args], check=True)

def probe(path):
    raw = subprocess.check_output([str(BIN / "ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], text=True)
    return json.loads(raw)

def seconds(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be a finite number")
    return float(value)

def stamp(seconds_, ass=False):
    total = int(round(seconds_ * (100 if ass else 1000)))
    unit = 100 if ass else 1000
    h, total = divmod(total, 3600 * unit)
    m, total = divmod(total, 60 * unit)
    s, fraction = divmod(total, unit)
    return f"{h}:{m:02}:{s:02}.{fraction:02}" if ass else f"{h:02}:{m:02}:{s:02},{fraction:03}"

def plain(text):
    value = str(text).replace("\r", "").strip()
    if any(ord(c) < 32 and c != "\n" for c in value):
        raise ValueError("Control character in subtitle")
    return value

def tempo_chain(speed):
    filters = []
    while speed > 2:
        filters.append("atempo=2")
        speed /= 2
    if speed != 1:
        filters.append(f"atempo={speed:.9f}")
    return filters



def build_subtitles(segments, duration, ending_code, hide_speed_label=False, technical_validation=False):
    """Visible captions are independent of the exact acceleration provenance."""
    subtitles = []
    for segment in segments:
        a, b = segment["output_start"], segment["output_end"]
        boundaries = sorted({a, b, *[x for x in (12.0, max(12.0, duration - 8.0)) if a < x < b]})
        for start, end in zip(boundaries, boundaries[1:]):
            text = segment["caption"]
            if segment["speed"] != 1 and not hide_speed_label:
                text += f"\n{segment['speed']:g}×"
            if start < 12:
                text = DISCLOSURE + "\n画面经剪辑\n" + text
            if start >= max(12.0, duration - 8.0):
                text += "\n" + ENDINGS[ending_code]
            if technical_validation:
                text = "技术验证素材 · 非真实机器人录像\n" + text
            subtitles.append((start, end, text))
    return subtitles


def reviewed(value):
    return isinstance(value, dict) and value.get("verified") is True and all(
        isinstance(value.get(k), str) and plain(value[k]) for k in ("reviewer", "reviewed_at", "notes"))


def media_duration(source, media):
    try:
        duration = float(media.get("format", {}).get("duration", 0))
    except (TypeError, ValueError):
        duration = 0
    if not math.isfinite(duration) or duration <= 0:
        raw = subprocess.check_output([str(BIN / "ffprobe"), "-v", "error", "-select_streams", "v:0",
             "-show_entries", "packet=pts_time,duration_time", "-of", "json", str(source)], text=True)
        ends = []
        for packet in json.loads(raw).get("packets", []):
            try:
                pts = float(packet.get("pts_time", 0))
                length = float(packet.get("duration_time", 0))
            except (TypeError, ValueError):
                continue
            if math.isfinite(pts) and math.isfinite(length):
                ends.append(pts + max(0, length))
        duration = max(ends, default=0)
    if duration <= 0:
        raise ValueError("Source must contain a measurable real video duration")
    return duration


def load_sources(timeline, args, output, review):
    multiple = "sources" in timeline
    if multiple:
        entries, order = timeline["sources"], timeline.get("source_order")
        if not isinstance(entries, dict) or not 1 <= len(entries) <= 8:
            raise ValueError("sources must map 1-8 source IDs to reviewed recordings")
        if (not isinstance(order, list) or any(not isinstance(x, str) for x in order) or
                len(set(order)) != len(order) or set(order) != set(entries)):
            raise ValueError("source_order must list each source ID exactly once")
        if "source" in timeline or "source_sha256" in timeline:
            raise ValueError("Use either legacy source or sources mapping, not both")
    else:
        order = ["source"]
        entries = {"source": {"path": timeline["source"], "sha256": timeline.get("source_sha256"), "review": review}}
    sources, paths, previous_capture_end = {}, set(), None
    for source_id in order:
        entry = entries[source_id]
        if not isinstance(entry, dict):
            raise ValueError("Each source entry must be an object")
        source = inside(entry["path"], exists=True)
        if source == output or source in paths:
            raise ValueError("Sources must be distinct original files and cannot equal output")
        paths.add(source)
        if args.technical_validation and source.parent != VALIDATION_DIR and VALIDATION_DIR not in source.parents:
            raise ValueError("Synthetic inputs belong only in edit-validation/")
        if not args.technical_validation and (source.parent == VALIDATION_DIR or VALIDATION_DIR in source.parents):
            raise ValueError("Technical validation footage cannot be presented as a real screen recording")
        digest = sha256(source)
        if entry.get("sha256") != digest:
            raise ValueError("Source SHA256 does not match reviewed recording: " + source_id)
        source_review = entry.get("review", review if args.technical_validation else {})
        if not reviewed(source_review):
            raise ValueError("Each actual source requires its own verified source review: " + source_id)
        media = probe(source)
        if not any(s["codec_type"] == "video" for s in media["streams"]):
            raise ValueError("Source contains no video: " + source_id)
        duration = media_duration(source, media)
        item = {"path": source, "source": str(source.relative_to(ROOT)), "source_sha256": digest,
                "source_duration": duration, "review": source_review,
                "has_audio": any(s["codec_type"] == "audio" for s in media["streams"])}
        if multiple and not args.technical_validation:
            metadata_path = inside(entry.get("recording_metadata", source.parent / "metadata.json"), exists=True)
            recordings = ROOT / "artifacts/demo-video-20261013/recordings"
            if (source.name != "source.webm" or metadata_path != source.parent / "metadata.json"
                    or source.parent.parent != recordings
                    or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", source.parent.name)):
                raise ValueError("Multi-source delivery must reference original source.webm in a real recording UUID directory")
            meta = json.loads(metadata_path.read_text())
            if (meta.get("status") != "COMPLETE" or meta.get("source") != "user_selected_browser_display_capture"
                    or meta.get("id") != source.parent.name or meta.get("sha256") != digest):
                raise ValueError("Source lacks matching completed real capture provenance: " + source_id)
            started = datetime.fromisoformat(meta["started_at"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                raise ValueError("Capture timestamp must include its timezone")
            start_epoch = started.timestamp()
            if previous_capture_end is not None and start_epoch < previous_capture_end:
                raise ValueError("source_order reverses or overlaps actual recording chronology")
            previous_capture_end = start_epoch + duration
            item.update(capture_start_epoch=start_epoch, capture_end_epoch=previous_capture_end,
                        recording_metadata={"path": str(metadata_path.relative_to(ROOT)), "sha256": sha256(metadata_path),
                            "id": meta["id"], "started_at": meta["started_at"], "finished_at": meta.get("finished_at"),
                            "capture_duration_ms": meta.get("capture_duration_ms")})
        sources[source_id] = item
    if len({item["has_audio"] for item in sources.values()}) != 1:
        raise ValueError("All sources must consistently contain audio or no audio; mixed layouts require separate review")
    return sources, order, multiple


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeline", required=True, help="Workspace-relative reviewed JSON")
    parser.add_argument("--output", required=True, help="New workspace-relative .mp4 file")
    parser.add_argument("--check", action="store_true", help="Validate without writing or encoding")
    parser.add_argument("--technical-validation", action="store_true", help="Synthetic codec check only, constrained to edit-validation/")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--font-dir", help="Project directory containing licensed Chinese fonts; burn the reviewed subtitles into the video")
    parser.add_argument("--preset", choices=("veryfast", "fast", "medium"), default="fast")
    parser.add_argument("--hide-speed-label", action="store_true", help="Hide numeric speed badges in subtitles; retain exact speeds and reasons in the edit manifest")
    args = parser.parse_args()
    font_dir = inside(args.font_dir) if args.font_dir else None
    if font_dir and (not font_dir.is_dir() or not any(font_dir.glob("*.otf")) and not any(font_dir.glob("*.ttf"))):
        raise ValueError("font-dir must contain project-local OTF/TTF files")
    timeline_path = inside(args.timeline, exists=True)
    output = inside(args.output)
    if output.suffix.lower() != ".mp4":
        raise ValueError("Output must be MP4")
    if output.exists():
        raise ValueError("Refusing to overwrite existing output")
    if not (320 <= args.width <= 3840 and 180 <= args.height <= 2160) or args.width % 2 or args.height % 2:
        raise ValueError("Use even dimensions within 320x180 to 3840x2160")
    if not 15 <= args.fps <= 60:
        raise ValueError("FPS must be 15–60")
    timeline = json.loads(timeline_path.read_text())
    if timeline.get("version") != 1:
        raise ValueError("Unknown timeline version")
    if args.technical_validation:
        if output.parent != VALIDATION_DIR and VALIDATION_DIR not in output.parents:
            raise ValueError("Synthetic technical output belongs only in edit-validation/")
        if timeline.get("source_kind") != "synthetic-validation":
            raise ValueError("Technical validation source must be explicitly labelled synthetic-validation")
    elif timeline.get("source_kind") != "screen-recording":
        raise ValueError("Delivery requires a real screen-recording source")
    review = timeline.get("review", {})
    if not reviewed(review):
        raise ValueError("Fill review.verified, reviewer, reviewed_at and notes after checking the source recording")
    sources, source_order, multiple = load_sources(timeline, args, output, review)
    first_source = sources[source_order[0]]
    source, digest, duration = first_source["path"], first_source["source_sha256"], first_source["source_duration"]
    has_audio = first_source["has_audio"]
    target = seconds(timeline.get("target_duration", 300), "target_duration")
    tolerance = seconds(timeline.get("tolerance_seconds", 15), "tolerance_seconds")
    if not args.technical_validation and (not 285 <= target <= 315 or not 0 <= tolerance <= 20):
        raise ValueError("Delivery should target about five minutes (285–315 seconds)")
    segments, cursor, omitted, transitions = [], 0.0, [], []
    previous_id, previous_index = None, -1
    source_ends = {key: 0.0 for key in source_order}
    for i, entry in enumerate(timeline.get("segments", [])):
        source_id = entry.get("source_id") if multiple else entry.get("source_id", "source")
        if source_id not in sources:
            raise ValueError("Each segment must name a known source_id")
        index = source_order.index(source_id)
        if index < previous_index:
            raise ValueError("Segments may not return to an earlier recording")
        media_source = sources[source_id]
        source_duration = media_source["source_duration"]
        prior_end = source_ends[source_id]
        start, end, speed = (seconds(entry.get(k), k) for k in ("start", "end", "speed"))
        if start < 0 or start < prior_end - 0.001 or end <= start or end > source_duration + 0.1:
            raise ValueError(f"Segment {i + 1}: invalid, overlapping, reordered or out-of-source timestamps")
        kind = entry.get("kind")
        if kind not in ("action", "wait", "overview"):
            raise ValueError("Segment kind must be action, wait or overview")
        if not 1 <= speed <= 32 or (kind == "overview" and speed != 1) or (kind == "action" and speed > 4):
            raise ValueError("Waits allow 1–32x; real actions allow 1–4x with documented speed provenance; overview stays 1x")
        if kind == "action" and speed != 1 and not plain(entry.get("speed_reason", "")):
            raise ValueError("Accelerated actions require a reviewed speed_reason")
        stage = plain(entry.get("caption", ""))
        if not stage:
            raise ValueError("Each segment needs a reviewed caption")
        refs = []
        for ref in entry.get("evidence", []):
            path = inside(ref, exists=True)
            refs.append({"path": str(path.relative_to(ROOT)), "sha256": sha256(path)})
        transition_reason = ""
        if previous_id is not None and source_id != previous_id:
            transition_reason = plain(entry.get("source_transition_reason", ""))
            evidence = []
            for ref in entry.get("source_transition_evidence", []):
                path = inside(ref, exists=True)
                evidence.append({"path": str(path.relative_to(ROOT)), "sha256": sha256(path)})
            if not transition_reason or not evidence:
                raise ValueError("Changing source requires source_transition_reason and source_transition_evidence")
            transition = {"from_source_id": previous_id, "to_source_id": source_id,
                "from_source_end": source_ends[previous_id], "to_source_start": start,
                "reason": transition_reason, "evidence_files": evidence}
            if "capture_start_epoch" in media_source:
                transition["omitted_wall_clock_seconds_approx"] = (
                    media_source["capture_start_epoch"] + start -
                    sources[previous_id]["capture_start_epoch"] - source_ends[previous_id])
            transitions.append(transition)
            previous_tail = sources[previous_id]["source_duration"] - source_ends[previous_id]
            if previous_tail > 0.001:
                omitted.append({"source_id": previous_id, "source_start": source_ends[previous_id],
                    "source_end": sources[previous_id]["source_duration"], "reason": transition_reason})
        if start > prior_end + 0.001:
            reason = plain(entry.get("omitted_before_reason", "")) or transition_reason
            if not reason:
                raise ValueError("Every omitted interval needs omitted_before_reason")
            omitted.append({"source_id": source_id, "source_start": prior_end, "source_end": start, "reason": reason})
        length = (end - start) / speed
        segments.append({**entry, "source_id": source_id, "start": start, "end": end, "speed": speed, "caption": stage,
                         "output_start": cursor, "output_end": cursor + length, "evidence_files": refs})
        cursor += length
        source_ends[source_id] = end
        previous_id, previous_index = source_id, index
    if not segments:
        raise ValueError("Timeline has no segments")
    if set(source_ends) != {segment["source_id"] for segment in segments}:
        raise ValueError("Every declared source must be used in source_order")
    tail = sources[previous_id]["source_duration"] - source_ends[previous_id]
    if multiple and tail > 0.001:
        reason = plain(timeline.get("omitted_tail_reason", ""))
        if not reason:
            raise ValueError("Multi-source omitted final tail requires omitted_tail_reason")
        omitted.append({"source_id": previous_id, "source_start": source_ends[previous_id],
                        "source_end": sources[previous_id]["source_duration"], "reason": reason})
    if abs(cursor - target) > tolerance:
        raise ValueError(f"Reviewed cuts yield {cursor:.3f}s; target {target:.3f}s ± {tolerance:.3f}s. Adjust waits/cuts; no padding, loops or invented action.")
    ending = timeline.get("ending", {})
    ending_code = ending.get("result")
    if ending_code not in ENDINGS:
        raise ValueError("Use a supported ending result; do not label approach as physical rescue")
    ending_evidence = []
    for ref in ending.get("evidence", []):
        path = inside(ref, exists=True)
        ending_evidence.append({"path": str(path.relative_to(ROOT)), "sha256": sha256(path)})
    if ending_code == "located_and_stopped" and not ending_evidence:
        raise ValueError("Located-and-stopped conclusion requires real supporting observation and stopped-state records")
    plan = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "technical_validation_only": args.technical_validation,
        "source": str(source.relative_to(ROOT)), "source_sha256": digest, "source_duration": duration,
        "multiple_sources": multiple, "source_order": source_order,
        "sources": {key: {k:v for k,v in value.items() if k != "path"} for key,value in sources.items()},
        "source_transitions": transitions,
        "timeline": str(timeline_path.relative_to(ROOT)), "timeline_sha256": sha256(timeline_path),
        "review": review, "expected_duration": cursor, "target_duration": target, "segments": segments,
        "omitted_intervals": omitted, "omitted_tail_seconds": max(0, tail),
        "ending": {"result": ending_code, "evidence_files": ending_evidence},
        "processing": {"chronological": True, "action_speeds": sorted({s["speed"] for s in segments if s["kind"] == "action"}), "frame_interpolation": False, "source_audio_preserved": has_audio,
                       "resize": "aspect-preserving fit with padding", "subtitle_delivery": ("burned Chinese subtitles plus default MP4 text track, SRT and ASS" if font_dir else "default MP4 text track plus UTF-8 SRT and ASS"),
                       "synthetic_actions": False, "width": args.width, "height": args.height, "fps": args.fps,
                       "visible_speed_labels": not args.hide_speed_label, "exact_speeds_retained_in_manifest": True,
                       "editing_disclosure_visible": True}
    }
    if args.check:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    work = output.parent / (output.stem + ".edit-work")
    if work.exists():
        raise ValueError("Working directory already exists; use a new output name")
    work.mkdir()
    subtitle_fonts = None
    if font_dir:
        subtitle_fonts = work / "fonts"
        subtitle_fonts.mkdir()
        for font in sorted([*font_dir.glob("*.otf"), *font_dir.glob("*.ttf")]):
            (subtitle_fonts / font.name).symlink_to(inside(font, exists=True))
        plan["subtitle_fonts"] = [{"path": str(font.relative_to(ROOT)), "sha256": sha256(font)}
                                   for font in sorted([*font_dir.glob("*.otf"), *font_dir.glob("*.ttf")])]
    subtitles = build_subtitles(segments, cursor, ending_code, args.hide_speed_label, args.technical_validation)
    srt = output.with_suffix(".zh-CN.srt")
    ass = output.with_suffix(".zh-CN.ass")
    manifest = output.with_suffix(".edit-manifest.json")
    for path in (srt, ass, manifest):
        if path.exists():
            raise ValueError("Refusing to overwrite " + str(path))
    srt.write_text("\n\n".join(f"{i}\n{stamp(a)} --> {stamp(b)}\n{text}" for i, (a, b, text) in enumerate(subtitles, 1)) + "\n", encoding="utf-8")
    ass_header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK SC,32,&H00FFFFFF,&H000000FF,&H00151820,&H90000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,32,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ass_lines = []
    for a, b, text in subtitles:
        escaped = text.replace("\\", "\\\\").replace("{", "｛").replace("}", "｝").replace("\n", "\\N")
        ass_lines.append(f"Dialogue: 0,{stamp(a, True)},{stamp(b, True)},Default,,0,0,0,,{escaped}")
    ass.write_text(ass_header + "\n".join(ass_lines) + "\n", encoding="utf-8")
    manifest.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    encoded = []
    for i, segment in enumerate(segments):
        source = sources[segment["source_id"]]["path"]
        path = work / f"segment-{i:03d}.mp4"
        filters = [f"setpts=(PTS-STARTPTS)/{segment['speed']:.9f}",
                   f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease:force_divisible_by=2",
                   f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:color=0x111820", "setsar=1",
                   f"fps={args.fps}", "format=yuv420p"]
        command = [BIN / "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-n",
                   "-ss", f"{segment['start']:.6f}", "-t", f"{segment['end'] - segment['start']:.6f}", "-i", source,
                   "-map", "0:v:0", "-vf", ",".join(filters), "-c:v", "libx264", "-crf", "20", "-preset", args.preset, "-threads", "4"]
        if has_audio:
            command += ["-map", "0:a:0", "-af", ",".join(["asetpts=PTS-STARTPTS", *tempo_chain(segment["speed"])]), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]
        else:
            command += ["-an"]
        command += ["-map_metadata", "-1", "-movflags", "+faststart", path]
        print(f"Encoding segment {i + 1}/{len(segments)}: {segment['caption']}", flush=True)
        run(command)
        encoded.append(path)
    concat = work / "segments.txt"
    concat.write_text("".join("file '" + p.name + "'\n" for p in encoded))
    command = [BIN / "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning", "-n",
               "-f", "concat", "-safe", "1", "-i", concat, "-i", srt, "-map", "0:v:0"]
    if has_audio:
        command += ["-map", "0:a:0"]
    command += ["-map", "1:s:0"]
    if font_dir:
        # Paths enter a filter argument directly, never a shell command.
        def filter_path(value):
            return str(value).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,").replace("[", "\\[").replace("]", "\\]")
        command += ["-vf", "subtitles=filename='" + filter_path(ass) + "':fontsdir='" + filter_path(subtitle_fonts) + "'",
                    "-c:v", "libx264", "-crf", "20", "-preset", args.preset, "-threads", "4"]
    else:
        command += ["-c:v", "copy"]
    if has_audio:
        command += ["-c:a", "aac", "-b:a", "160k", "-af", "aresample=async=1:first_pts=0"]
    command += ["-c:s", "mov_text", "-disposition:s:0", "default",
                "-metadata:s:s:0", "language=zho", "-metadata:s:s:0", "title=中文说明 · 搜寻演示",
                "-metadata", "title=" + ("TECHNICAL VALIDATION ONLY" if args.technical_validation else "Agnes 室内火灾人员搜寻演示"),
                "-metadata", "comment=Ordered screen-recording edit; preset route retained in execution records; exact acceleration retained in manifest; " +
                ("speed badges hidden by user request; " if args.hide_speed_label else "accelerated segments labelled; ") +
                "no physical evacuation claim.",
                "-movflags", "+faststart", output]
    run(command)
    final_probe = probe(output)
    actual = float(final_probe["format"]["duration"])
    if abs(actual - cursor) > max(0.75, len(segments) / args.fps + 0.1):
        raise ValueError(f"Encoded duration differs from timeline: {actual:.3f}s versus {cursor:.3f}s")
    if any(s["codec_type"] == "video" and s["codec_name"] != "h264" for s in final_probe["streams"]):
        raise ValueError("Expected H.264 output")
    plan["output"] = {"path": str(output.relative_to(ROOT)), "sha256": sha256(output), "duration": actual,
                      "streams": [{"type": s["codec_type"], "codec": s["codec_name"]} for s in final_probe["streams"]]}
    plan["subtitle_files"] = [str(srt.relative_to(ROOT)), str(ass.relative_to(ROOT))]
    manifest.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(plan["output"], ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError, OSError, json.JSONDecodeError) as exc:
        print("Edit failed: " + str(exc), file=sys.stderr)
        sys.exit(1)
