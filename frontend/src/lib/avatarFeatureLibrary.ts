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

const IFRAME_TEST_TERM: AvatarFeatureProvenance = {
  sourceRepo: "iFrame 平台测试词条",
  license: "MIT",
  sourcePath: "frontend/src/lib/avatarFeatureLibrary.ts",
  reviewStatus: "internal_test_only",
};

export const AVATAR_FEATURE_LIBRARY: Record<string, AvatarFeatureOption[]> = {
  face: [
    { id: "oval", zh: "椭圆脸", en: "Oval face" },
    { id: "long-oval", zh: "窄长椭圆脸", en: "Long oval face", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "round", zh: "圆脸", en: "Round face" },
    { id: "square", zh: "方脸", en: "Square face" },
    { id: "heart", zh: "心形脸", en: "Heart-shaped face" },
    { id: "soft-jaw", zh: "下颌线柔和，脸颊保留自然饱满度", en: "Soft jawline and naturally full cheeks", provenance: IFRAME_TEST_TERM },
    { id: "angular-jaw", zh: "下颌轮廓较分明，颧骨结构清晰", en: "Defined jawline and cheekbones", provenance: IFRAME_TEST_TERM },
    { id: "wide-cheekbones", zh: "颧骨略宽，面中部轮廓鲜明", en: "Slightly broad cheekbones", provenance: IFRAME_TEST_TERM },
    { id: "narrow-chin", zh: "面颊向较窄的下巴自然收束", en: "Cheeks taper naturally to a narrow chin", provenance: IFRAME_TEST_TERM },
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
    { id: "deep-set", zh: "眼窝略深，眼睑结构清楚", en: "Slightly deep-set eyes", provenance: IFRAME_TEST_TERM },
    { id: "wide-set", zh: "眼距略宽，五官比例自然", en: "Slightly wide-set eyes", provenance: IFRAME_TEST_TERM },
    { id: "upturned", zh: "眼尾轻微上扬，不过度拉长", en: "Slightly upturned outer corners", provenance: IFRAME_TEST_TERM },
    { id: "downturned", zh: "眼尾轻微下垂，保留自然眼睑", en: "Slightly downturned outer corners", provenance: IFRAME_TEST_TERM },
  ],
  brow_shape: [
    { id: "straight", zh: "平直眉", en: "Straight brows" },
    { id: "arched", zh: "弧形眉", en: "Arched brows" },
    { id: "thick", zh: "浓密自然眉", en: "Full natural brows" },
    { id: "soft-arched", zh: "眉峰柔和，眉尾自然收细", en: "Soft brow arch", provenance: IFRAME_TEST_TERM },
    { id: "low-straight", zh: "眉形较平，眉眼距离略近", en: "Low straight brows", provenance: IFRAME_TEST_TERM },
    { id: "sparse", zh: "眉毛略稀疏，保留自然毛流", en: "Sparse natural brows", provenance: IFRAME_TEST_TERM },
  ],
  nose_shape: [
    { id: "straight-bridge", zh: "鼻梁平直", en: "Straight nose bridge" },
    { id: "broad-bridge", zh: "鼻梁较宽", en: "Broad nose bridge" },
    { id: "rounded-tip", zh: "鼻尖圆润", en: "Rounded nose tip" },
    { id: "narrow-bridge", zh: "鼻梁较窄，鼻翼自然", en: "Narrow nose bridge", provenance: IFRAME_TEST_TERM },
    { id: "soft-bridge", zh: "鼻梁起伏柔和，鼻尖不过度锐利", en: "Soft nose bridge", provenance: IFRAME_TEST_TERM },
  ],
  lip_shape: [
    { id: "thin", zh: "薄唇", en: "Thin lips" },
    { id: "full", zh: "饱满唇形", en: "Full lips" },
    { id: "defined-bow", zh: "唇峰清晰", en: "Defined cupid's bow" },
    { id: "soft-corners", zh: "嘴角线条柔和，唇形自然", en: "Soft mouth corners", provenance: IFRAME_TEST_TERM },
    { id: "asymmetric-smile", zh: "嘴角有轻微自然不对称", en: "Slight asymmetry at mouth corners", provenance: IFRAME_TEST_TERM },
  ],
  facial_mark: [
    { id: "freckles", zh: "鼻颊少量雀斑", en: "Light freckles across nose and cheeks" },
    { id: "natural-asymmetry", zh: "轻微自然面部不对称", en: "Subtle natural facial asymmetry", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "left-cheek-mole", zh: "左颊小痣", en: "Small mole on left cheek" },
    { id: "right-brow-scar", zh: "右眉浅疤", en: "Faint scar on right brow" },
    { id: "smile-lines", zh: "嘴角有细微笑纹", en: "Subtle smile lines", provenance: IFRAME_TEST_TERM },
    { id: "under-eye", zh: "眼下有轻微自然阴影", en: "Subtle under-eye shadows", provenance: IFRAME_TEST_TERM },
    { id: "forehead-lines", zh: "额头有淡淡表情纹", en: "Faint forehead expression lines", provenance: IFRAME_TEST_TERM },
  ],
  skin: [
    { id: "warm-light", zh: "暖调浅肤色，自然肤质", en: "Warm light skin with natural texture" },
    { id: "neutral-medium", zh: "中等中性肤色，自然肤质", en: "Neutral medium skin with natural texture" },
    { id: "visible-microtexture", zh: "保留可见的自然皮肤纹理", en: "Visible natural skin microtexture", provenance: AGENTARA_PORTRAIT_CLONE_PROVENANCE },
    { id: "warm-deep", zh: "暖调深肤色，自然肤质", en: "Warm deep skin with natural texture" },
    { id: "cool-light", zh: "冷调浅肤色，保留自然明暗变化", en: "Cool light skin tone", provenance: IFRAME_TEST_TERM },
    { id: "warm-medium", zh: "中等暖调肤色，肤色分布自然", en: "Warm medium skin tone", provenance: IFRAME_TEST_TERM },
    { id: "cool-deep", zh: "冷调深肤色，受光处保留层次", en: "Cool deep skin tone", provenance: IFRAME_TEST_TERM },
    { id: "pores", zh: "面颊和鼻翼保留细微毛孔纹理", en: "Subtle pores on cheeks and nose", provenance: IFRAME_TEST_TERM },
    { id: "sun-weathered", zh: "肤色有轻微日晒痕迹，不作整体脏污", en: "Mild sun exposure marks", provenance: IFRAME_TEST_TERM },
    { id: "natural-blush", zh: "面颊有轻微自然血色", en: "Subtle natural cheek color", provenance: IFRAME_TEST_TERM },
  ],
  body: [
    { id: "slim", zh: "偏瘦匀称，肩颈自然", en: "Slim build with natural shoulders" },
    { id: "balanced", zh: "匀称体型，比例协调", en: "Balanced build with even proportions" },
    { id: "athletic", zh: "健壮体型，肩背挺拔", en: "Athletic build with strong posture" },
    { id: "compact", zh: "体型结实紧凑，四肢比例自然", en: "Compact sturdy build", provenance: IFRAME_TEST_TERM },
    { id: "broad-shoulders", zh: "肩部较宽，腰部轮廓自然", en: "Broad shoulders with natural waist", provenance: IFRAME_TEST_TERM },
    { id: "narrow-shoulders", zh: "肩部较窄，身形轻盈", en: "Narrow shoulders and light build", provenance: IFRAME_TEST_TERM },
    { id: "rounded-posture", zh: "站姿略松弛，肩颈不过度挺直", en: "Relaxed posture", provenance: IFRAME_TEST_TERM },
    { id: "upright-posture", zh: "站姿挺直，重心稳定", en: "Upright stable posture", provenance: IFRAME_TEST_TERM },
    { id: "long-limbs", zh: "四肢比例略修长，关节结构自然", en: "Slightly long limbs", provenance: IFRAME_TEST_TERM },
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
    { id: "close-cropped", zh: "贴头短发，发际线自然", en: "Close-cropped hair", provenance: IFRAME_TEST_TERM },
    { id: "shoulder-length", zh: "齐肩发，发尾有自然层次", en: "Shoulder-length layered hair", provenance: IFRAME_TEST_TERM },
    { id: "low-tie", zh: "长发低束，额前保留少量碎发", en: "Long hair tied low", provenance: IFRAME_TEST_TERM },
    { id: "loose-waves", zh: "自然微卷，卷度不均匀", en: "Loose natural waves", provenance: IFRAME_TEST_TERM },
    { id: "tight-curls", zh: "细密卷发，发量与轮廓稳定", en: "Tight curls with stable silhouette", provenance: IFRAME_TEST_TERM },
    { id: "receding-hairline", zh: "发际线略后移，轮廓自然", en: "Slightly receding hairline", provenance: IFRAME_TEST_TERM },
    { id: "gray-streaks", zh: "发间有少量灰白发丝", en: "Subtle gray streaks", provenance: IFRAME_TEST_TERM },
  ],
  clothing_silhouette: [
    { id: "simple-silhouette", zh: "简洁、易辨认的服装廓形", en: "Simple recognizable clothing silhouette", provenance: IFRAME_TEST_TERM },
    { id: "fitted-cut", zh: "利落合身的剪裁，活动时轮廓稳定", en: "Fitted clean cut", provenance: IFRAME_TEST_TERM },
    { id: "loose-cut", zh: "宽松版型，布料随动作自然垂坠", en: "Loose draping cut", provenance: IFRAME_TEST_TERM },
    { id: "layered-controlled", zh: "服装层次清晰，配饰数量克制", en: "Controlled layered clothing", provenance: IFRAME_TEST_TERM },
    { id: "workwear", zh: "实用工作服轮廓，活动范围清楚", en: "Practical workwear silhouette", provenance: IFRAME_TEST_TERM },
    { id: "formal-tailored", zh: "挺括的正式服装剪裁，接缝清晰", en: "Structured formal tailoring", provenance: IFRAME_TEST_TERM },
  ],
  clothing_material: [
    { id: "matte-cotton", zh: "哑光棉布质感，保留细小褶皱", en: "Matte cotton with small folds", provenance: IFRAME_TEST_TERM },
    { id: "linen", zh: "亚麻纹理清晰，布面有自然起伏", en: "Visible linen weave", provenance: IFRAME_TEST_TERM },
    { id: "wool", zh: "厚实毛织物质感，边缘轮廓柔和", en: "Dense wool texture", provenance: IFRAME_TEST_TERM },
    { id: "leather-accents", zh: "少量皮革结构件，磨损控制在边缘", en: "Limited leather accents", provenance: IFRAME_TEST_TERM },
    { id: "natural-folds", zh: "布料有自然褶皱，避免过度装饰", en: "Natural folds without over-decoration", provenance: IFRAME_TEST_TERM },
    { id: "subtle-wear", zh: "衣物有轻微使用痕迹，不改变原有版型", en: "Subtle wear without changing cut", provenance: IFRAME_TEST_TERM },
  ],
};
