import type { ShotNode } from "./ShotCard";

export type DirectorFieldProposal = {
    field: "shotSize" | "cameraAngle" | "cameraMovement" | "duration";
    label: string;
    current: string;
    proposed: string | number;
    unavailableReason?: string;
};

export function directorFieldProposals(shot: ShotNode, durationRange?: { min: number; max: number }): DirectorFieldProposal[] {
    const plan = shot.directorShotContext?.shot;
    if (!plan) return [];
    const candidates: DirectorFieldProposal[] = [
        { field: "shotSize", label: "景别", current: shot.shotSize?.trim() || "未设置", proposed: plan.shot_size?.trim() || "" },
        { field: "cameraAngle", label: "机位", current: shot.cameraAngle?.trim() || "未设置", proposed: plan.camera_angle?.trim() || "" },
        { field: "cameraMovement", label: "运镜", current: shot.cameraMovementStructured?.description?.trim() || shot.cameraMovementStructured?.primary?.trim() || "未设置", proposed: plan.camera_movement?.trim() || "" },
        { field: "duration", label: "时长", current: shot.duration ? `${shot.duration} 秒` : "未设置", proposed: plan.duration_seconds ?? 0 },
    ];
    return candidates.filter(({ current, proposed }) => proposed !== "" && proposed !== 0 && current !== proposed && current !== `${proposed} 秒`)
        .map((proposal) => {
            if (proposal.field !== "duration" && shot.promptIsOptimized) {
                return { ...proposal, unavailableReason: "已采用完整优化稿，修改此字段不会进入生成文本" };
            }
            if (proposal.field === "duration" && durationRange &&
                (Number(proposal.proposed) < durationRange.min || Number(proposal.proposed) > durationRange.max)) {
                return { ...proposal, unavailableReason: `超出当前模型 ${durationRange.min}–${durationRange.max} 秒范围` };
            }
            return proposal;
        });
}
