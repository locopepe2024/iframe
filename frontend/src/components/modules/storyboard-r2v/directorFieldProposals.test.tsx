import { expect, it } from "vitest";

import { directorFieldProposals } from "./directorFieldProposals";
import type { ShotNode } from "./ShotCard";

it("offers only differing shot fields from the confirmed director plan", () => {
    const shot: ShotNode = {
        id: "frame-1", prompt: "保留本镜动作", tabMode: "t2i_i2v",
        shotSize: "中景", cameraAngle: "平视", duration: 6,
        directorShotContext: {
            shot: { shot_size: "近景", camera_angle: "平视", camera_movement: "缓慢推进", duration_seconds: 8,
                performance_action: "前镜动作不应写入", dialogue: [{ speaker: "甲", line: "前镜对白" }] },
        },
    };

    expect(directorFieldProposals(shot)).toEqual([
        { field: "shotSize", label: "景别", current: "中景", proposed: "近景" },
        { field: "cameraMovement", label: "运镜", current: "未设置", proposed: "缓慢推进" },
        { field: "duration", label: "时长", current: "6 秒", proposed: 8 },
    ]);
});

it("does not infer proposals when the confirmed plan has no shot fields", () => {
    expect(directorFieldProposals({ id: "frame-1", prompt: "镜头", tabMode: "t2i_i2v" })).toEqual([]);
});

it("marks an out-of-range plan duration as unavailable", () => {
    const shot: ShotNode = { id: "frame-1", prompt: "镜头", tabMode: "t2i_i2v",
        directorShotContext: { shot: { duration_seconds: 30 } } };
    expect(directorFieldProposals(shot, { min: 3, max: 15 })).toEqual([
        { field: "duration", label: "时长", current: "未设置", proposed: 30,
            unavailableReason: "超出当前模型 3–15 秒范围" },
    ]);
});

it("does not offer an ineffective camera edit after a full prompt was adopted", () => {
    const shot: ShotNode = { id: "frame-1", prompt: "已优化", promptIsOptimized: true, tabMode: "t2i_i2v",
        directorShotContext: { shot: { camera_angle: "低角度", duration_seconds: 8 } } };
    expect(directorFieldProposals(shot, { min: 3, max: 15 })).toEqual([
        { field: "cameraAngle", label: "机位", current: "未设置", proposed: "低角度",
            unavailableReason: "已采用完整优化稿，修改此字段不会进入生成文本" },
        { field: "duration", label: "时长", current: "未设置", proposed: 8 },
    ]);
});
