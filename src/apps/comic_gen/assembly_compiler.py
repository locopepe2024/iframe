"""Shared local Assembly compiler; callers own authorization and publication."""
import os
import subprocess
from typing import List


def compile_assembly(plan, source_paths, audio_clips, audio_paths, output_path, ffmpeg_path, ffprobe_path):
    clips = sorted((c for l in plan.lanes if l.kind == "video" and not l.muted for c in l.clips if c.enabled), key=lambda c: (c.timeline_start_ms, c.timeline_end_ms, c.id))
    source_paths = list(source_paths)
    if len(clips) != len(source_paths) or len(audio_clips) != len(audio_paths):
        raise ValueError("Assembly input count does not match timeline")
    filter_steps: List[str] = []
    for index, clip in enumerate(clips):
        timeline_duration = (clip.timeline_end_ms - clip.timeline_start_ms) / 1000
        source_start = clip.source_start_ms / 1000
        source_end_ms = (
            clip.source_end_ms
            if clip.source_end_ms is not None
            else clip.source_start_ms + (clip.timeline_end_ms - clip.timeline_start_ms)
        )
        source_end = source_end_ms / 1000
        source_duration = source_end - source_start
        if source_duration <= 0:
            raise ValueError(
                f"clip {clip.id} has a non-positive source range"
            )
        speed_factor = timeline_duration / source_duration
        filter_steps.append(
            f"[{index}:v]"
            f"trim=start={source_start:.6f}:end={source_end:.6f},"
            f"setpts=(PTS-STARTPTS)*{speed_factor:.9f},"
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2,"
            "setsar=1,fps=24,format=yuv420p"
            f"[v{index}]"
        )

        try:
            probe = subprocess.run(
                [ffprobe_path, "-v", "error", "-select_streams", "a:0",
                 "-show_entries", "stream=index", "-of", "csv=p=0", source_paths[index]],
                check=True, capture_output=True, timeout=20,
            )
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"Assembly source audio probe failed for clip {clip.id}") from exc
        if probe.stdout.strip():
            # Match the source crop and any existing timeline retiming.
            tempo = source_duration / timeline_duration
            tempos = []
            while tempo > 2:
                tempos.append("atempo=2")
                tempo /= 2
            while tempo < 0.5:
                tempos.append("atempo=0.5")
                tempo /= 0.5
            tempos.append(f"atempo={tempo:.9f}")
            filter_steps.append(
                f"[{index}:a:0]atrim=start={source_start:.6f}:end={source_end:.6f},"
                "asetpts=PTS-STARTPTS," + ",".join(tempos) + ","
                "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"volume={clip.gain if clip.gain is not None else 1},"
                f"apad,atrim=duration={timeline_duration:.6f}[a{index}]"
            )
        else:
            filter_steps.append(
                "anullsrc=r=48000:cl=stereo,"
                f"atrim=duration={timeline_duration:.6f}[a{index}]"
            )

    filter_steps.append(
        "".join(f"[v{index}][a{index}]" for index in range(len(clips)))
        + f"concat=n={len(clips)}:v=1:a=1[outv][outa]"
    )
    for offset, (_, clip) in enumerate(audio_clips):
        index = len(source_paths) + offset
        duration = (clip.timeline_end_ms - clip.timeline_start_ms) / 1000
        start = clip.source_start_ms / 1000
        end = (clip.source_end_ms / 1000 if clip.source_end_ms is not None else start + duration)
        if abs(end - start - duration) > 0.001:
            raise ValueError(f"audio clip {clip.id} must use original speed")
        filter_steps.append(
            f"[{index}:a:0]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,"
            "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"volume={clip.gain if clip.gain is not None else 1},"
            f"adelay={clip.timeline_start_ms}|{clip.timeline_start_ms}[mix{offset}]"
        )
    if audio_clips:
        filter_steps.append("[outa]" + "".join(f"[mix{i}]" for i in range(len(audio_clips))) +
            f"amix=inputs={len(audio_clips) + 1}:duration=first:normalize=0,"
            f"alimiter=limit=0.95:latency=1,atrim=duration={plan.target_duration_ms / 1000:.6f}[mixed]")
    source_paths.extend(audio_paths)

    command = [ffmpeg_path, "-y"]
    for source_path in source_paths:
        command.extend(["-i", source_path])
    command.extend([
        "-filter_complex",
        ";".join(filter_steps),
        "-map",
        "[outv]",
        "-map",
        "[mixed]" if audio_clips else "[outa]",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-c:v",
        "libx264",
        "-crf",
        "23",
        "-preset",
        "fast",
        "-movflags",
        "+faststart",
        output_path,
    ])

    try:
        from .assembly_subtitles import render_with_subtitles
        render_with_subtitles(command, plan)
    except ValueError as exc:
        if os.path.isfile(output_path):
            os.remove(output_path)
        raise ValueError(str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Assembly FFmpeg render timed out") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if exc.stderr else ""
        raise RuntimeError(
            stderr[-1000:] or "Assembly rendering failed"
        ) from exc

    if not os.path.isfile(output_path):
        raise RuntimeError("Assembly render completed without an output file")
