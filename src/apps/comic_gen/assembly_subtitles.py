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
