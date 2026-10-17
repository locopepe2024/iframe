"""Validated scene image-edit tool instructions and their model prompts."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class SceneLightingParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["lighting"]
    view_mode: Literal["perspective", "front"] = "perspective"
    intelligent: bool = True
    brightness: int = Field(50, ge=0, le=100)
    color: str = Field("#f3f4f6", pattern=r"^#[0-9a-fA-F]{6}$")
    light_side: Literal["left", "top", "right", "front", "bottom", "back"] = "front"
    rim_light: bool = False
    preset: Optional[Literal["nolan_cool_gray", "golden_hour", "mystic_shadow", "cyberpunk", "blue_rim", "expired_film", "cinematic_portrait", "studio_softbox"]] = None
    extra: str = Field("", max_length=2000)


class SceneCameraParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["camera"]
    preset: Literal["custom", "fisheye", "tilted", "front_top_down", "front_bottom_up", "panoramic_top_down", "rear_view"] = "custom"
    yaw: int = Field(0, ge=-180, le=180)
    pitch: int = Field(0, ge=-90, le=90)
    zoom: int = Field(2, ge=0, le=4)
    focus: bool = False
    focus_x: int = Field(50, ge=0, le=100)
    focus_y: int = Field(50, ge=0, le=100)
    focus_radius: int = Field(18, ge=6, le=42)
    prompt_enabled: bool = False
    extra: str = Field("", max_length=2000)


SceneToolParams = SceneLightingParams | SceneCameraParams

LIGHT_SIDES = {"left": "左侧", "top": "顶部", "right": "右侧", "front": "前方", "bottom": "底部", "back": "后方"}
LIGHT_PRESETS = {
    "nolan_cool_gray": "电影级冷灰色调，克制主光和干净阴影，保留主体材质细节。",
    "golden_hour": "低角度暖阳，琥珀金高光，柔和阴影和傍晚余晖层次。",
    "mystic_shadow": "百叶窗切割式局部受光，背景克制，明暗对比鲜明。",
    "cyberpunk": "冷暖霓虹边缘光和环境反射光，主体轮廓清晰。",
    "blue_rim": "蓝色逆光勾勒主体，正面仍可辨识。",
    "expired_film": "轻微偏色、暖黄褪色和高光泛雾，保留清晰结构。",
    "cinematic_portrait": "柔和主光与轻微轮廓光，压住杂光，保留空间层次。",
    "studio_softbox": "柔光箱近距离补光，减弱硬阴影，照明均匀干净。",
}
CAMERA_PRESETS = {"custom": "自定义", "fisheye": "鱼眼视角", "tilted": "倾斜视角", "front_top_down": "正面俯拍", "front_bottom_up": "正面仰拍", "panoramic_top_down": "全景俯拍", "rear_view": "背面视角"}
DISTANCES = ["远景", "中远景", "中景", "近景", "特写"]


def parse_scene_tool(value: object) -> SceneToolParams:
    if not isinstance(value, dict):
        raise ValueError("scene_tool must be an object")
    try:
        if value.get("kind") == "lighting":
            return SceneLightingParams.model_validate(value)
        if value.get("kind") == "camera":
            return SceneCameraParams.model_validate(value)
    except ValidationError as exc:
        raise ValueError(f"invalid scene_tool parameters: {exc}") from exc
    raise ValueError("scene_tool.kind must be lighting or camera")


def scene_tool_prompt(tool: SceneToolParams, has_lighting_reference: bool = False) -> str:
    if isinstance(tool, SceneLightingParams):
        brightness_guide = "受光区域明显，但高光不要过曝。" if tool.brightness >= 75 else "保持自然明暗层次和稳定反差。" if tool.brightness >= 45 else "阴影占比更高，整体照度克制。"
        return "\n".join(filter(None, [
            "任务目标：仅重塑来源场景图片的打光与光影氛围。保持主体、材质、结构、构图、物体位置和镜头语言连续；不要新增物体。",
            f"观察模式：{'正面' if tool.view_mode == 'front' else '透视'}。主光从{LIGHT_SIDES[tool.light_side]}进入，受光方向必须与阴影方向一致。",
            f"主光颜色 {tool.color}，亮度 {tool.brightness}%。{brightness_guide}",
            "增加克制的轮廓光。" if tool.rim_light else "不额外增加明显轮廓光。",
            (LIGHT_PRESETS[tool.preset] if tool.preset else "") if tool.intelligent else "仅根据结构化灯位、光色和亮度重塑光照。",
            tool.extra.strip() if tool.intelligent else "",
            "第二张图片仅供参考灯位、明暗分布、色温及氛围；场景内容必须来自第一张图片。" if has_lighting_reference else "",
            "结果应呈现真实受光面、阴影面与空间层次，不要只做整体滤镜变色。",
        ]))
    return "\n".join(filter(None, [
        "基于来源场景图片重定位相机视角。保持同一场景的主体、材质、结构、物体位置关系和核心风格；不要生成新场景。",
        f"预设视角：{CAMERA_PRESETS[tool.preset]}；水平环绕 {tool.yaw}°；垂直俯仰 {tool.pitch}°；景别 {DISTANCES[tool.zoom]}。",
        f"对焦点：图片坐标 x={tool.focus_x}%、y={tool.focus_y}%，影响半径约 {tool.focus_radius}%；保持该区域清晰稳定。" if tool.focus else "",
        tool.extra.strip() if tool.prompt_enabled else "",
    ]))
