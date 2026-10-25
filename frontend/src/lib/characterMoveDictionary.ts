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
        label: "抽击·剑鞭拨械",
        aliases: ["抽击", "剑鞭", "Whiplash"],
        category: "剑法·柔韧抽打",
        starting_state: "中距，右手持剑，剑身位于身体前侧，面向当前匪寇",
        body_mechanics: ["击中前保持正常速度或略微加速", "前脚切入", "探身", "手腕和前臂短促爆发，类似甩手腕发力", "剑身中段先行、剑尖因惯性滞后", "击中后受击武器或演员沿受力方向瞬间飞出"],
        weapon_trajectory: "剑身沿波浪、S形或鞭状轨迹高速抽打，剑身出现明显抖动和弯曲回弹，不形成笔直刃线",
        target_relation: "以高速度和韧性抽打对方剑身、刀剑或持械手腕，不默认攻击身体其他部位",
        contact_result: "剑身产生鞭挞式冲击和多段连续接触，受击点连续炸开火花；是否击飞或造成伤口由当前镜头授权",
        recovery_state: "剑身回弹后重新受控，保持面向匪寇并进入下一招",
        visible_cues: ["蛇形残影和波浪状轨迹", "细小空气撕裂或真空带", "多段线性火花", "击中瞬间短促停顿", "受击武器或演员沿受力方向飞出"],
        forbidden_interpretations: ["不改为拍刃的剑身对剑身碰撞", "不改为绕剑变线Coupé", "不自动造成身体伤口"],
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
    {
        move_ref: "suyan.sword.coupe.v1",
        character_name: "苏砚（雪痕客）",
        label: "绕剑变线·Coupé",
        aliases: ["Coupé", "Cutover", "绕剑变线"],
        category: "剑法·变线进攻",
        starting_state: "中距，对方剑尖挡在双方之间，右手持剑，剑尖受对方防线限制",
        body_mechanics: ["收回己方剑尖", "手指和手腕控制小弧线", "从对方剑尖上方或前方绕过", "手臂向前伸展完成刺击"],
        weapon_trajectory: "剑尖主动避开对方剑尖，从上方或前方画小弧线绕到另一侧，再沿新线路向前刺出",
        target_relation: "绕过对方剑尖和防线，攻击暴露空档；不以剑身碰撞为目的",
        contact_result: "主动避开剑身接触并改变进攻路线，最终刺向暴露空档；是否命中由当前镜头授权",
        recovery_state: "刺击后保持剑尖指向目标，进入收势或下一招",
        visible_cues: ["剑尖小弧线清楚", "无拍刃碰撞", "对方剑尖留在原防线或被诱导偏移", "变线后刺击线路明确"],
        forbidden_interpretations: ["不改为拍刃碰撞", "不改为剑鞭弹性抽打", "不自动造成身体伤口"],
        variants: ["假拍刃后顺势抽击", "从对方剑尖上方抽击变线"],
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
