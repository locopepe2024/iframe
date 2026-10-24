export type CharacterMoveEntry = {
    move_ref: string;
    character_name: string;
    label: string;
    aliases: string[];
    category: string;
    starting_state: string;
    body_mechanics: string[];
    weapon_trajectory: string;
    target_relation: string;
    contact_result: string;
    recovery_state: string;
    visible_cues: string[];
    forbidden_interpretations: string[];
    variants: string[];
};

/** Curated entries are intentionally small: Shot Design retrieves one move,
 * then expands only that move into the current model prompt. */
export const CHARACTER_MOVE_DICTIONARY: CharacterMoveEntry[] = [
    {
        move_ref: "suyan.sword.disarm_sweep.v1",
        character_name: "苏砚（雪痕客）",
        label: "连贯剑势·拨械",
        aliases: ["拍刃", "抽击", "剑鞭"],
        category: "剑法·拨械",
        starting_state: "中距，右手持剑，剑身位于身体前侧，面向当前匪寇",
        body_mechanics: ["前脚切入", "髋部带动躯干旋转", "肩肘带动剑臂", "手腕短促加速并急停", "剑身中段先行、剑尖因惯性滞后", "剑身弯曲后剑尖反弹回位"],
        weapon_trajectory: "以剑身侧面沿横向路线作拍刃/抽击：手腕发力时剑身中段速度更快，剑尖滞后使剑身弯曲；手腕急停后剑尖因惯性回弹，形成类似抖动长竹竿的弹性拍击，不以锋刃切割",
        target_relation: "只针对持械手或刀剑，不默认攻击身体",
        contact_result: "剑身侧面以弹性和重量形成钝器式拍击，震开刀剑；经当前镜头授权时，兵刃沿受力方向脱手翻飞",
        recovery_state: "保持面向匪寇，剑势进入收势或下一招",
        visible_cues: ["剑身中段先行、剑尖滞后", "剑身弯曲后剑尖反弹", "剑身侧面拍击接触清楚", "匪寇手掌震麻般张开", "刀剑沿受力方向翻飞"],
        forbidden_interpretations: ["不改为锋刃切割或刺击", "不自动增加第二次斩击", "不自动造成身体伤口"],
        variants: ["面对数名匪寇的连续拨械"],
    },
    {
        move_ref: "suyan.sword.edge_line_sweep.v1",
        character_name: "苏砚（雪痕客）",
        label: "刃线横扫·拨械",
        aliases: ["刃线横扫", "横扫", "刃线拨械"],
        category: "剑法·刃线横扫",
        starting_state: "中距，右手持剑，剑刃沿身体前侧展开，面向当前匪寇",
        body_mechanics: ["前脚切入", "髋部带动躯干旋转", "肩肘带动剑臂", "腕部稳定刃线"],
        weapon_trajectory: "剑刃沿明确横向刃线扫过对手持械手或刀剑外侧，轨迹连续清楚",
        target_relation: "针对持械手或刀剑，不默认攻击身体",
        contact_result: "锋刃侧向撞开或切断对方兵刃的控制线；是否造成伤口由当前镜头明确授权",
        recovery_state: "完成横扫后保持面向匪寇，剑尖进入收势或下一招",
        visible_cues: ["刃线方向清楚", "剑刃轨迹连续", "对手持械手被带开", "刀剑沿受力方向偏转或脱手"],
        forbidden_interpretations: ["不改为剑身侧面拍刃", "不自动增加第二次斩击", "不自动造成身体伤口"],
        variants: ["面对数名匪寇的连续刃线横扫"],
    },
];

export function findCharacterMove(moveRef?: string | null): CharacterMoveEntry | null {
    return CHARACTER_MOVE_DICTIONARY.find((entry) => entry.move_ref === moveRef) ?? null;
}

export function describeCharacterMove(move: CharacterMoveEntry, variant?: string | null): string {
    return [
        `招式引用：${move.label}（${move.move_ref}）`,
        `动作词：${move.aliases.join("、")}`,
        variant?.trim() ? `本镜变体：${variant.trim()}` : "",
        `起始：${move.starting_state}`,
        `发力链：${move.body_mechanics.join(" → ")}`,
        `剑路：${move.weapon_trajectory}`,
        `目标关系：${move.target_relation}`,
        `结果：${move.contact_result}`,
        `可见特征：${move.visible_cues.join("；")}`,
        `收势：${move.recovery_state}`,
        `禁止误读：${move.forbidden_interpretations.join("；")}`,
    ].filter(Boolean).join("。") + "。";
}
