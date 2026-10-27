"""Pure subtitle sidecar serialization; never executes subtitle text as markup."""
import re
from .models import AssemblyEditPlan


def _timestamp(ms: int) -> str:
    seconds, milliseconds = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def export_srt(plan: AssemblyEditPlan, lane_id: str) -> str:
    lane = next((item for item in plan.lanes if item.id == lane_id and item.kind == "subtitle"), None)
    if lane is None:
        raise ValueError("Subtitle lane not found")
    if lane.muted:
        return ""
    cues = []
    for clip in sorted((item for item in lane.clips if item.enabled),
                       key=lambda item: (item.timeline_start_ms, item.id)):
        # Empty lines delimit SRT cues; collapse them within user text. Escape
        # tags because SRT players otherwise interpret user input as markup.
        text = (clip.text or "").replace("\r\n", "\n").replace("\r", "\n")
        text = "\n".join(line.strip() for line in text.split("\n") if line.strip())
        text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        text = re.sub(r"[\t ]+", " ", text)
        cues.append(f"{len(cues) + 1}\n{_timestamp(clip.timeline_start_ms)} --> "
                    f"{_timestamp(clip.timeline_end_ms)}\n{text}")
    return ("\n\n".join(cues) + "\n\n").replace("\n", "\r\n") if cues else ""


def render_with_subtitles(command, plan):
    """Render one explicitly selected lane using bounded, private temporary SRTs."""
    import subprocess
    import tempfile
    from pathlib import Path

    lane_id = plan.burn_subtitle_lane_id
    if lane_id is None:
        return subprocess.run(command, check=True, capture_output=True, timeout=600)
    lane = next((item for item in plan.lanes if item.id == lane_id), None)
    if lane is None or lane.kind != "subtitle" or lane.muted:
        raise ValueError("Select an enabled subtitle lane before burning captions")
    clips = [clip for clip in lane.clips if clip.enabled]
    if not clips:
        raise ValueError("Selected subtitle lane has no enabled captions")
    if any(any(c in (clip.text or "") for c in "\\{}") for clip in clips):
        raise ValueError("Burn-in captions cannot contain backslashes or braces; edit text or download SRT")
    filters = subprocess.run([command[0], "-hide_banner", "-filters"],
                             check=True, capture_output=True, timeout=20)
    if not re.search(rb"\bsubtitles\s", filters.stdout):
        raise ValueError("FFmpeg subtitles filter (libass) is unavailable")
    # A fixed ASCII temporary path never embeds owner IDs or user text into the
    # filter language. Files are private and removed on every success/failure.
    with tempfile.TemporaryDirectory(prefix="iframe-subtitles-", dir="/tmp") as directory:
        subtitle = Path(directory) / "captions.srt"
        subtitle.write_text(export_srt(plan, lane_id), encoding="utf-8", newline="")
        probe = Path(directory) / "probe.srt"
        all_text = " ".join((clip.text or "") for clip in clips)
        probe_plan = plan.model_copy(deep=True)
        probe_lane = next(item for item in probe_plan.lanes if item.id == lane_id)
        probe_lane.clips = [clips[0].model_copy(update={
            "timeline_start_ms": 0, "timeline_end_ms": 1000, "text": all_text,
        })]
        probe.write_text(export_srt(probe_plan, lane_id), encoding="utf-8", newline="")
        style = "FontSize=24,Outline=2,Shadow=0,Alignment=2,MarginV=24"
        preflight = subprocess.run([
            command[0], "-hide_banner", "-f", "lavfi", "-i", "color=s=1280x720:d=0.1",
            "-vf", f"subtitles=filename={probe}:force_style='{style}'",
            "-frames:v", "1", "-f", "null", "-",
        ], check=True, capture_output=True, timeout=30)
        if re.search(rb"(failed to find any fallback|fontselect: failed)", preflight.stderr, re.I):
            raise ValueError("Subtitle font is missing required glyphs; install a font supporting the selected language")
        rendered = list(command)
        index = rendered.index("-filter_complex") + 1
        rendered[index] += f";[outv]subtitles=filename={subtitle}:force_style='{style}'[captioned]"
        rendered[rendered.index("[outv]", index + 1)] = "[captioned]"
        result = subprocess.run(rendered, check=True, capture_output=True, timeout=600)
        if re.search(rb"(failed to find any fallback|fontselect: failed)", result.stderr, re.I):
            raise ValueError("Subtitle render has missing glyphs; output was not published")
        return result
