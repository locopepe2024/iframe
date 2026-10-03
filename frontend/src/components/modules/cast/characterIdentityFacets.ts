export type CharacterIdentityFacet = { id: string; section?: "identity" | "look" | "continuity"; label_zh: string; label_en: string; prompt_zh: string; prompt_en: string };

export const CHARACTER_IDENTITY_FACETS_FALLBACK: CharacterIdentityFacet[] = [
  {
    "id": "realistic-human",
    "section": "identity",
    "label_zh": "真人写实",
    "label_en": "Live-action realism",
    "prompt_zh": "真人写实质感，保留真实皮肤纹理和自然比例",
    "prompt_en": "live-action realism with natural skin texture and proportions"
  },
  {
    "id": "age-stage",
    "section": "identity",
    "label_zh": "年龄感",
    "label_en": "Age stage",
    "prompt_zh": "年龄感清晰，与角色设定一致",
    "prompt_en": "a clear age stage consistent with the character brief"
  },
  {
    "id": "face-shape",
    "section": "identity",
    "label_zh": "脸型五官",
    "label_en": "Face and features",
    "prompt_zh": "脸型、五官比例和左右对称关系稳定",
    "prompt_en": "stable face shape, feature proportions, and facial symmetry"
  },
  {
    "id": "eyes-gaze",
    "section": "identity",
    "label_zh": "眼神",
    "label_en": "Eyes and gaze",
    "prompt_zh": "眼神清晰自然，避免失焦；镜头视线由分镜单独决定",
    "prompt_en": "clear natural eyes without unfocused gaze; shot-specific eye direction stays in the storyboard"
  },
  {
    "id": "smile-expression",
    "section": "identity",
    "label_zh": "常态表情",
    "label_en": "Baseline expression",
    "prompt_zh": "常态表情自然克制，避免把某个瞬时情绪写成永久身份",
    "prompt_en": "a natural restrained baseline expression; do not turn a transient emotion into permanent identity"
  },
  {
    "id": "hairline-style",
    "section": "identity",
    "label_zh": "基础发型",
    "label_en": "Base hairstyle",
    "prompt_zh": "基础发型轮廓、发际线、发色和发量保持一致",
    "prompt_en": "consistent base hairstyle silhouette, hairline, hair color, and hair volume"
  },
  {
    "id": "skin",
    "section": "identity",
    "label_zh": "肤质",
    "label_en": "Skin",
    "prompt_zh": "肤色稳定，保留自然肤质和轻微毛孔细节",
    "prompt_en": "stable skin tone with natural texture and subtle pores"
  },
  {
    "id": "body-proportion",
    "section": "identity",
    "label_zh": "身材比例",
    "label_en": "Body proportions",
    "prompt_zh": "身高感、肩宽、身材比例和基础体态保持稳定",
    "prompt_en": "stable height impression, shoulder width, body proportions, and base posture"
  },
  {
    "id": "identity-anchor",
    "section": "identity",
    "label_zh": "识别锚点",
    "label_en": "Identity anchor",
    "prompt_zh": "保留一至两个稳定识别锚点，跨视角和候选图保持一致",
    "prompt_en": "retain one or two stable identity anchors across views and variants"
  },
  {
    "id": "era-anchor",
    "section": "look",
    "label_zh": "时代锚点",
    "label_en": "Era anchor",
    "prompt_zh": "造型符合故事指定的年份、时代和社会环境",
    "prompt_en": "the look matches the story's specified year, era, and social setting"
  },
  {
    "id": "costume-variant",
    "section": "look",
    "label_zh": "本集服装变体",
    "label_en": "Episode costume variant",
    "prompt_zh": "将服装作为本集造型变体，不改写角色永久身份",
    "prompt_en": "treat the costume as an episode look variant, not a change to permanent identity"
  },
  {
    "id": "makeup-variant",
    "section": "look",
    "label_zh": "妆容变体",
    "label_en": "Makeup variant",
    "prompt_zh": "记录本集妆容、伤势或湿污等可变化状态，并注明生效范围",
    "prompt_en": "record episode makeup, injury, or wetness as a scoped look state"
  },
  {
    "id": "hair-arrangement",
    "section": "look",
    "label_zh": "发型整理变体",
    "label_en": "Hair arrangement variant",
    "prompt_zh": "只改变本集发型整理方式，保留基础发型轮廓和身份锚点",
    "prompt_en": "change only the episode hair arrangement while preserving the base silhouette and identity anchors"
  },
  {
    "id": "look-scope",
    "section": "look",
    "label_zh": "造型生效范围",
    "label_en": "Look scope",
    "prompt_zh": "注明该造型变体在哪些场景或镜头生效，未确认范围保持未决",
    "prompt_en": "state which scenes or shots use this look; leave an unconfirmed scope unresolved"
  },
  {
    "id": "costume-lock",
    "section": "continuity",
    "label_zh": "服装连续性锁",
    "label_en": "Costume continuity lock",
    "prompt_zh": "跨镜保持服装主色、材质和关键结构不漂移，只锁定稳定可见的最小短语",
    "prompt_en": "lock the costume's stable color, material, and key structure across shots using the smallest visible phrase"
  },
  {
    "id": "hair-lock",
    "section": "continuity",
    "label_zh": "发型连续性锁",
    "label_en": "Hair continuity lock",
    "prompt_zh": "跨镜保持发型轮廓和发际线稳定，不锁定瞬时风吹或动作状态",
    "prompt_en": "keep the hairstyle silhouette and hairline stable across shots without locking transient wind or action states"
  },
  {
    "id": "reference-role",
    "section": "continuity",
    "label_zh": "参考图职责",
    "label_en": "Reference role",
    "prompt_zh": "明确身份图、服装图和动作参考各自负责什么，不混用来源",
    "prompt_en": "state whether each identity, costume, or motion reference controls, without mixing their roles"
  },
  {
    "id": "eye-shape",
    "section": "identity",
    "label_zh": "眼型",
    "label_en": "Eye shape",
    "prompt_zh": "眼型清晰稳定，与角色身份一致",
    "prompt_en": "a clear, consistent eye shape aligned with the character identity"
  },
  {
    "id": "eye-color",
    "section": "identity",
    "label_zh": "眼睛颜色",
    "label_en": "Eye color",
    "prompt_zh": "眼睛颜色稳定，不因镜头变化漂移",
    "prompt_en": "stable eye color without shot-to-shot drift"
  },
  {
    "id": "brow-shape",
    "section": "identity",
    "label_zh": "眉形",
    "label_en": "Brow shape",
    "prompt_zh": "眉形和眉毛密度保持稳定",
    "prompt_en": "consistent brow shape and brow density"
  },
  {
    "id": "nose-mouth",
    "section": "identity",
    "label_zh": "鼻唇特征",
    "label_en": "Nose and mouth",
    "prompt_zh": "鼻梁、鼻翼和唇形比例稳定",
    "prompt_en": "stable nose structure and lip proportions"
  },
  {
    "id": "body-build",
    "section": "identity",
    "label_zh": "体型",
    "label_en": "Body build",
    "prompt_zh": "体型偏瘦、匀称或健壮由用户指定并保持一致",
    "prompt_en": "keep the user-selected slim, balanced, or athletic body build consistent"
  },
  {
    "id": "height-presence",
    "section": "identity",
    "label_zh": "身高感",
    "label_en": "Height presence",
    "prompt_zh": "身高感和人物之间的相对高矮保持稳定",
    "prompt_en": "stable height impression and relative height between characters"
  },
  {
    "id": "shoulder-posture",
    "section": "identity",
    "label_zh": "肩颈体态",
    "label_en": "Shoulders and posture",
    "prompt_zh": "肩宽、颈部比例和基础体态保持稳定",
    "prompt_en": "stable shoulder width, neck proportions, and base posture"
  },
  {
    "id": "skin-tone",
    "section": "identity",
    "label_zh": "肤色",
    "label_en": "Skin tone",
    "prompt_zh": "肤色由用户指定并在不同光线下保持合理连续",
    "prompt_en": "keep the user-selected skin tone coherent under different lighting"
  },
  {
    "id": "skin-texture",
    "section": "identity",
    "label_zh": "皮肤纹理",
    "label_en": "Skin texture",
    "prompt_zh": "保留自然皮肤纹理、毛孔和轻微不完美",
    "prompt_en": "retain natural skin texture, pores, and subtle imperfections"
  },
  {
    "id": "facial-mark",
    "section": "identity",
    "label_zh": "面部识别特征",
    "label_en": "Facial identifier",
    "prompt_zh": "保留用户指定的痣、疤痕或其他稳定面部识别特征",
    "prompt_en": "retain user-specified moles, scars, or other stable facial identifiers"
  }
];
