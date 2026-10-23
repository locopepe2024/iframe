"""Normalize the existing preset/custom movement editor into one stored shape."""

from .models import CameraMovementData


PRESETS = {
    "固定镜头": ("static", "normal"),
    "缓慢推进": ("push_in", "slow"),
    "跟随平移": ("follow", "normal"),
    "环绕旋转": ("orbit", "normal"),
    "快速拉远": ("pull_out", "fast"),
    "缓慢上升": ("crane_up", "slow"),
}


def movement_from_editor(description: str) -> CameraMovementData:
    primary, speed = PRESETS.get(description, ("custom", "normal"))
    return CameraMovementData(primary=primary, speed=speed, description=description)
