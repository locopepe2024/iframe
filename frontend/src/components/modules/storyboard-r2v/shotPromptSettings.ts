import type { ShotNode } from "./ShotCard";

/** Update visible adopted text at edit time. Generation never appends this. */
export function syncPromptSettings(prompt: string, oldStyle: string | null | undefined, oldLight: string | null | undefined, style: string | null | undefined, light: string | null | undefined): string {
    if ((oldStyle || "").trim() === (style || "").trim() && (oldLight || "").trim() === (light || "").trim()) return prompt;
    const visual = /(?:integrated_multimodal_description|detailed_description|综合多模态描述|详细描述)[ \t]*(?:\*\*)?[:：][ \t]*(?:\*\*)?[ \t]*/i.exec(prompt);
    const start = visual ? visual.index + visual[0].length : 0;
    const following = visual ? /(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music|主体定义|详细描述|综合多模态描述|整体声景|非叙事音乐)[ \t]*(?:\*\*)?[:：]/i.exec(prompt.slice(start)) : null;
    const end = following ? start + following.index : prompt.length;
    let body = prompt.slice(start, end).replace(/【当前镜头设定】[^\n]*【\/当前镜头设定】/g, "");
    for (const [previous, current] of [[oldStyle, style], [oldLight, light]]) {
        if (previous?.trim() && previous.trim() !== (current || "").trim()) {
            body = body.split(/(<d>[\s\S]*?<\/d>|"[^"\n]*"|“[^”]*”|「[^」]*」)/gi)
                .map((part, index) => index % 2 ? part : part.split(previous.trim()).join("")).join("");
        }
    }
    const parts = [["风格", style], ["光线", light]]
        .filter(([, value]) => value?.trim())
        .map(([label, value]) => `${label}：${value!.trim().replace(/\s+/g, " ")}`);
    const note = parts.length ? `【当前镜头设定】${parts.join("；")}【/当前镜头设定】 ` : "";
    return (prompt.slice(0, start) + note + body + prompt.slice(end)).trim();
}

export function editShotSettings(shot: ShotNode, field: "stylePromptOverride" | "lightingOverride", value: string | null, inheritedStyle = ""): ShotNode {
    const next = { ...shot, [field]: value };
    if (shot.promptIsOptimized) {
        const plan = shot.directorShotContext?.shot?.lighting;
        const inheritedLight = [plan?.key_source, plan?.color_tone, plan?.contrast, ...(plan?.practical_sources || [])].filter(Boolean).join("；");
        next.prompt = syncPromptSettings(shot.prompt, shot.stylePromptOverride || inheritedStyle, shot.lightingOverride || inheritedLight,
            next.stylePromptOverride || inheritedStyle, next.lightingOverride || inheritedLight);
    }
    return next;
}
