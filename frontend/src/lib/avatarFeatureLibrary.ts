export type AvatarFeatureReviewStatus = "verified" | "internal_test_only" | "needs_verification";

export type AvatarFeatureProvenance = {
  sourceRepo?: string;
  sourceCommit?: string;
  license?: string;
  sourcePath?: string;
  reviewStatus: AvatarFeatureReviewStatus;
};

export type AvatarFeatureOption = {
  id: string;
  zh: string;
  en: string;
  provenance?: AvatarFeatureProvenance;
};

const AGENTARA_PORTRAIT_CLONE_PROVENANCE: AvatarFeatureProvenance = {
  sourceRepo: "https://github.com/agentara/skills",
  sourceCommit: "950e1bfb11e1df67b46df19804ed85ada9012c33",
  license: "MIT",
  sourcePath: "skills/aigc/portrait-clone/SKILL.md",
  reviewStatus: "internal_test_only",
};

export const AVATAR_FEATURE_LIBRARY: Record<string, AvatarFeatureOption[]> = {
  face: [
    { id: "oval", zh: "椭圆脸", en: "Oval face" },
    { id: "long-oval", zh: "窄长椭圆脸", en: "Long oval face", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "round", zh: "圆脸", en: "Round face" },
    { id: "square", zh: "方脸", en: "Square face" },
    { id: "heart", zh: "心形脸", en: "Heart-shaped face" },
  ],
  facial_features: [
    { id: "soft-balanced", zh: "柔和均衡的五官比例", en: "Soft, balanced features" },
    { id: "defined", zh: "轮廓清晰的五官", en: "Defined features" },
    { id: "delicate", zh: "精细秀气的五官", en: "Delicate features" },
    { id: "strong", zh: "立体鲜明的五官", en: "Strong, sculpted features" },
  ],
  eye_shape: [
    { id: "almond", zh: "杏眼", en: "Almond-shaped eyes" },
    { id: "narrow-set", zh: "偏窄眼型，保留自然眼睑结构", en: "Narrower eyes with natural lid structure", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "round", zh: "圆眼", en: "Round eyes" },
    { id: "hooded", zh: "内双眼", en: "Hooded eyes" },
  ],
  brow_shape: [
    { id: "straight", zh: "平直眉", en: "Straight brows" },
    { id: "arched", zh: "弧形眉", en: "Arched brows" },
    { id: "thick", zh: "浓密自然眉", en: "Full natural brows" },
  ],
  nose_shape: [
    { id: "straight-bridge", zh: "鼻梁平直", en: "Straight nose bridge" },
    { id: "broad-bridge", zh: "鼻梁较宽", en: "Broad nose bridge" },
    { id: "rounded-tip", zh: "鼻尖圆润", en: "Rounded nose tip" },
  ],
  lip_shape: [
    { id: "thin", zh: "薄唇", en: "Thin lips" },
    { id: "full", zh: "饱满唇形", en: "Full lips" },
    { id: "defined-bow", zh: "唇峰清晰", en: "Defined cupid's bow" },
  ],
  facial_mark: [
    { id: "freckles", zh: "鼻颊少量雀斑", en: "Light freckles across nose and cheeks" },
    { id: "natural-asymmetry", zh: "轻微自然面部不对称", en: "Subtle natural facial asymmetry", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "left-cheek-mole", zh: "左颊小痣", en: "Small mole on left cheek" },
    { id: "right-brow-scar", zh: "右眉浅疤", en: "Faint scar on right brow" },
  ],
  skin: [
    { id: "warm-light", zh: "暖调浅肤色，自然肤质", en: "Warm light skin with natural texture" },
    { id: "neutral-medium", zh: "中等中性肤色，自然肤质", en: "Neutral medium skin with natural texture" },
    { id: "visible-microtexture", zh: "保留可见的自然皮肤纹理", en: "Visible natural skin microtexture", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "warm-deep", zh: "暖调深肤色，自然肤质", en: "Warm deep skin with natural texture" },
  ],
  body: [
    { id: "slim", zh: "偏瘦匀称，肩颈自然", en: "Slim build with natural shoulders" },
    { id: "balanced", zh: "匀称体型，比例协调", en: "Balanced build with even proportions" },
    { id: "athletic", zh: "健壮体型，肩背挺拔", en: "Athletic build with strong posture" },
  ],
  age_appearance: [
    { id: "young-adult", zh: "年轻成年人外观", en: "Young adult appearance" },
    { id: "adult", zh: "成年人外观", en: "Adult appearance" },
    { id: "mature-adult", zh: "成熟成年人外观", en: "Mature adult appearance" },
  ],
  gender_expression: [
    { id: "feminine", zh: "女性化表达", en: "Feminine expression" },
    { id: "masculine", zh: "男性化表达", en: "Masculine expression" },
    { id: "androgynous", zh: "中性表达", en: "Androgynous expression" },
  ],
  base_hair: [
    { id: "short-natural", zh: "短发，自然蓬松轮廓", en: "Short hair with a natural silhouette" },
    { id: "long-natural", zh: "长发，自然垂坠轮廓", en: "Long hair with a natural silhouette" },
    { id: "medium-layered", zh: "中长层次发，发际线清晰", en: "Layered medium hair with a clear hairline" },
  ],
};
