#!/usr/bin/env python3
"""Add reviewed narration to a real silent edit without changing its video or subtitles."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "runtime/ros2-jazzy/.pixi/envs/default/bin"
VALIDATION = ROOT / "artifacts/demo-video-20261013/edit-validation"


def inside(value, exists=False):
    p = Path(value)
    p = (ROOT / p).resolve() if not p.is_absolute() else p.resolve()
    if p == ROOT or ROOT not in p.parents:
        raise ValueError("Path must stay inside the project workspace")
    if exists and not p.is_file():
        raise ValueError("Missing file: " + str(p.relative_to(ROOT)))
    return p


def relative(path):
    return str(path.relative_to(ROOT))


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def probe(path):
    return json.loads(subprocess.check_output(
        [str(BIN / "ffprobe"), "-v", "error", "-show_format", "-show_streams",
         "-of", "json", str(path)], text=True))


def number(value, name, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be finite")
    result = float(value)
    if minimum is not None and result < minimum or maximum is not None and result > maximum:
        raise ValueError(name + " is outside its permitted range")
    return result


def duration(media, kind):
    streams = [s for s in media.get("streams", []) if s.get("codec_type") == kind]
    values = [float(s.get("duration", 0)) for s in streams]
    values.append(float(media.get("format", {}).get("duration", 0)))
    result = max((x for x in values if math.isfinite(x)), default=0)
    if not streams or result <= 0:
        raise ValueError("Input needs measurable " + kind + " content")
    return result


def source_info(value):
    if not isinstance(value, dict):
        raise ValueError("Each audio item requires source provenance")
    result = copy.deepcopy(value)
    for field in ("kind", "description"):
        if not isinstance(result.get(field), str) or not result[field].strip():
            raise ValueError("Audio source requires " + field)
    if result.get("provenance_file"):
        p = inside(result["provenance_file"], exists=True)
        result["provenance_file"] = relative(p)
        result["provenance_sha256"] = sha256(p)
    return result


def audio_item(value, video_seconds, background=False):
    if not isinstance(value, dict):
        raise ValueError("Audio item must be an object")
    path = inside(value["file"], exists=True)
    digest = sha256(path)
    if value.get("sha256") and value["sha256"].lower() != digest:
        raise ValueError("Audio SHA256 mismatch: " + relative(path))
    seconds = duration(probe(path), "audio")
    start = 0.0 if background else number(value["start"], "clip start", 0, video_seconds)
    gain = number(value.get("gain_db", -28 if background else 0), "gain_db",
                  -60 if background else -24, -18 if background else 12)
    if not background and start + seconds > video_seconds + 0.02:
        raise ValueError("Narration extends beyond the real edited video")
    if background and type(value.get("loop", False)) is not bool:
        raise ValueError("background.loop must be a boolean")
    return {"id": str(value.get("id", "background" if background else "")),
            "file": relative(path), "sha256": digest, "duration_seconds": seconds,
            "start_seconds": start, "gain_db": gain,
            "text": str(value.get("text", "")), "source": source_info(value.get("source")),
            **({"loop": value.get("loop", False)} if background else {})}


def stream_hash(path):
    # Hash copied encoded video packets; no rendering, interpolation or image synthesis.
    return subprocess.check_output(
        [str(BIN / "ffmpeg"), "-nostdin", "-v", "error", "-i", str(path),
         "-map", "0:v:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"],
        text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, help="Reviewed silent edit MP4")
    parser.add_argument("--timeline", required=True, help="Narration clips in final edited seconds")
    parser.add_argument("--manifest", help="Original edit manifest; defaults to video.edit-manifest.json")
    parser.add_argument("--output", required=True, help="New voiced MP4; never overwrite the silent edit")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--technical-validation", action="store_true",
                        help="Explicit synthetic codec validation, confined to edit-validation/")
    args = parser.parse_args()
    video = inside(args.video, exists=True)
    timeline_path = inside(args.timeline, exists=True)
    manifest_path = inside(args.manifest or video.with_suffix(".edit-manifest.json"), exists=True)
    output = inside(args.output)
    output_manifest = output.with_suffix(".edit-manifest.json")
    if output.suffix.lower() != ".mp4":
        raise ValueError("Output must be MP4")
    if output in (video, timeline_path, manifest_path):
        raise ValueError("Output cannot replace an input")
    media = probe(video)
    video_streams = [s for s in media["streams"] if s["codec_type"] == "video"]
    if len(video_streams) != 1 or video_streams[0]["codec_name"] != "h264":
        raise ValueError("Expected one H.264 video stream")
    if any(s["codec_type"] == "audio" for s in media["streams"]):
        raise ValueError("Use the original silent edit; this tool will not remove existing audio")
    video_seconds = duration(media, "video")
    original = json.loads(manifest_path.read_text())
    digest = sha256(video)
    if original.get("output", {}).get("sha256") != digest:
        raise ValueError("Original edit manifest must bind this exact video SHA256")
    if args.technical_validation:
        for p in (video, timeline_path, manifest_path, output):
            if not p.is_relative_to(VALIDATION):
                raise ValueError("Synthetic validation files must stay in edit-validation/")
        if original.get("kind") != "SYNTHETIC_CODEC_VALIDATION_NOT_DEMO":
            raise ValueError("Synthetic validation manifest must be explicitly labelled")
    elif not 285 <= video_seconds <= 315:
        raise ValueError("Reviewed demonstration video must already be about five minutes")
    timeline = json.loads(timeline_path.read_text())
    if timeline.get("version") != 1 or not isinstance(timeline.get("clips"), list):
        raise ValueError("Expected narration timeline version 1 with clips[]")
    if not 1 <= len(timeline["clips"]) <= 80:
        raise ValueError("Expected 1-80 narration clips")
    clips = [audio_item(v, video_seconds) for v in timeline["clips"]]
    ids = [c["id"] for c in clips]
    if any(not s.strip() for s in ids) or len(set(ids)) != len(ids):
        raise ValueError("Narration clip IDs must be nonempty and unique")
    if clips != sorted(clips, key=lambda c: c["start_seconds"]):
        raise ValueError("Narration clips must use chronological final-video start times")
    for before, after in zip(clips, clips[1:]):
        if before["start_seconds"] + before["duration_seconds"] > after["start_seconds"] + .02:
            raise ValueError("Narration clips overlap")
    background = audio_item(timeline["background"], video_seconds, True) if timeline.get("background") else None
    companions = [(video.with_suffix(suffix), output.with_suffix(suffix))
                  for suffix in (".zh-CN.srt", ".zh-CN.ass")
                  if video.with_suffix(suffix).is_file()]
    for p in [output, output_manifest, *[target for _, target in companions]]:
        if p.exists():
            raise ValueError("Refusing to overwrite " + relative(p))
    plan = {"kind": "SYNTHETIC_CODEC_VALIDATION_NOT_DEMO" if args.technical_validation else "REVIEWED_DEMO_NARRATION_MIX",
            "input_video": {"path": relative(video), "sha256": digest, "duration_seconds": video_seconds},
            "input_edit_manifest": {"path": relative(manifest_path), "sha256": sha256(manifest_path)},
            "narration_timeline": {"path": relative(timeline_path), "sha256": sha256(timeline_path)},
            "clips": clips, "background": background,
            "mix": {"sample_rate": 48000, "channels": 2, "codec": "aac", "bitrate": "160k",
                    "limiter": .95, "video_and_subtitles": "stream copy; no frame changes",
                    "source_video_has_audio": False}}
    if args.check:
        print(json.dumps({"pass": True, "check_only": True, "plan": plan}, ensure_ascii=False))
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [str(BIN / "ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "warning", "-n", "-i", str(video)]
    filters = [f"anullsrc=r=48000:cl=stereo,atrim=duration={video_seconds:.9f}[silence]"]
    labels = ["[silence]"]
    for index, clip in enumerate(clips, 1):
        command += ["-i", str(inside(clip["file"]))]
        label = f"voice{index}"
        filters.append(f"[{index}:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,"
                       f"volume={clip['gain_db']:.6f}dB,adelay={round(clip['start_seconds']*1000)}:all=1[{label}]")
        labels.append(f"[{label}]")
    if background:
        index = len(clips) + 1
        if background["loop"]:
            command += ["-stream_loop", "-1"]
        command += ["-i", str(inside(background["file"]))]
        filters.append(f"[{index}:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,"
                       f"volume={background['gain_db']:.6f}dB,atrim=duration={video_seconds:.9f}[music]")
        labels.append("[music]")
    filters.append("".join(labels) + f"amix=inputs={len(labels)}:duration=longest:normalize=0,"
                   f"alimiter=limit=.95:latency=1,atrim=duration={video_seconds:.9f}[audio]")
    command += ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "0:s?",
                "-map", "[audio]", "-c:v", "copy", "-c:s", "copy", "-c:a", "aac", "-b:a", "160k",
                "-ar", "48000", "-ac", "2", "-t", f"{video_seconds:.9f}",
                "-map_metadata", "0", "-metadata:s:a:0", "language=zho",
                "-disposition:a:0", "default",
                "-movflags", "+faststart", str(output)]
    subprocess.run(command, check=True)
    result = probe(output)
    streams = result["streams"]
    subtitle_codecs = [s["codec_name"] for s in media["streams"] if s["codec_type"] == "subtitle"]
    if [s["codec_name"] for s in streams if s["codec_type"] == "subtitle"] != subtitle_codecs:
        raise ValueError("Subtitle stream preservation failed")
    actual = duration(result, "video")
    if abs(actual - video_seconds) > .15:
        raise ValueError("Mix changed the video duration")
    video_hash = stream_hash(video)
    if stream_hash(output) != video_hash:
        raise ValueError("Encoded video packet preservation failed")
    audio = [s for s in streams if s["codec_type"] == "audio"]
    if len(audio) != 1 or audio[0]["codec_name"] != "aac":
        raise ValueError("Expected one AAC narration track")
    plan["verification"] = {"input_output_video_packet_sha256": video_hash,
                            "duration_preserved": True, "subtitle_streams_preserved": True}
    final = copy.deepcopy(original)
    final["narration_mix"] = {**plan, "created_at": datetime.now(timezone.utc).isoformat()}
    final["output"] = {"path": relative(output), "sha256": sha256(output), "duration": actual,
                       "streams": [{"type": s["codec_type"], "codec": s["codec_name"]} for s in streams]}
    subtitle_files = []
    for source, target in companions:
        with target.open("xb") as stream:
            stream.write(source.read_bytes())
        subtitle_files.append(relative(target))
    if subtitle_files:
        final["subtitle_files"] = subtitle_files
    with output_manifest.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(final, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"pass": True, "output": final["output"], "manifest": relative(output_manifest)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print("Narration mix failed: " + str(error), file=sys.stderr)
        sys.exit(1)
