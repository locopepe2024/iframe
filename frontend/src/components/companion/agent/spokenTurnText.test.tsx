import { describe, expect, it } from "vitest";
import { spokenAnnouncementKey, spokenTurnMeta } from "./spokenTurnText";

describe("spokenTurnMeta", () => {
  it("uses task identity and revision for announcement de-duplication", () => {
    const first = spokenTurnMeta({
      kind: "photo_task", task_id: "photos-1", revision: 3,
      status: "waiting_input", step: "select_photo", photos: [],
      spoken_text: "请选一张照片。",
    });
    const same = spokenTurnMeta({
      kind: "photo_task", task_id: "photos-1", revision: 3,
      status: "waiting_input", step: "select_photo", photos: [],
      spoken_text: "请选一张照片。",
    });
    const next = spokenTurnMeta({
      kind: "photo_task", task_id: "photos-1", revision: 4,
      status: "completed", step: "closed", photos: [],
      spoken_text: "已完成。",
    });
    expect(first?.announcementKey).toBe(same?.announcementKey);
    expect(next?.announcementKey).not.toBe(first?.announcementKey);
  });

  it("does not assign a task key to ordinary chat", () => {
    expect(spokenTurnMeta({ kind: "text", text: "我在听。" })).toEqual({
      text: "我在听。", reason: "chat",
    });
  });

  it("can hydrate the announcement ledger from a persisted task result", () => {
    expect(spokenAnnouncementKey({
      kind: "photo_task", task_id: "photos-2", revision: 1,
      status: "waiting_input", step: "select_photo", photos: [], spoken_text: "请选一张。",
    })).toBe("photo_task:photos-2:1:waiting_input:select_photo");
  });
});
