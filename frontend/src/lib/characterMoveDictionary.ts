export type CharacterMoveEntry = {
    move_ref: string;
    character_name: string;
    label: string;
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
        category: "剑法·拨械",
        starting_state: "中距，右手持剑，剑身位于身体前侧，面向当前匪寇",
        body_mechanics: ["前脚切入", "髋部带动躯干旋转", "肩肘带动剑臂", "腕部调整刃线"],
        weapon_trajectory: "以剑身侧面沿横向路线抽击、拍击对手持械手或刀剑，不以锋刃切割",
        target_relation: "只针对持械手或刀剑，不默认攻击身体",
        contact_result: "剑身侧面以弹性和重量形成钝器式拍击，震开刀剑；经当前镜头授权时，兵刃沿受力方向脱手翻飞",
        recovery_state: "保持面向匪寇，剑势进入收势或下一招",
        visible_cues: ["剑身侧面拍击接触清楚", "匪寇手掌震麻般张开", "刀剑沿受力方向翻飞"],
        forbidden_interpretations: ["不改为锋刃切割或刺击", "不自动增加第二次斩击", "不自动造成身体伤口"],
        variants: ["面对数名匪寇的连续拨械"],
    },
];

export function findCharacterMove(moveRef?: string | null): CharacterMoveEntry | null {
    return CHARACTER_MOVE_DICTIONARY.find((entry) => entry.move_ref === moveRef) ?? null;
}

export function describeCharacterMove(move: CharacterMoveEntry, variant?: string | null): string {
    return [
        `招式引用：${move.label}（${move.move_ref}）`,
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
