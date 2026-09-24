import { expect, it } from "vitest";

import { createDirectorActionPlan, validateDirectorActionPlan } from "@/components/director3d/action/action-agent";
import { useWorkbenchStore } from "@/components/director3d/state/workbench-store";
import { CHARACTER_A_ID, CHARACTER_B_ID } from "@/components/director3d/data/humanoid";

it("creates a reviewable local plan without mutating the workbench", () => {
  const state = useWorkbenchStore.getState();
  const before = state.dialogueTimeline;
  const result = createDirectorActionPlan(state, { text: "让 A 做鹤形拳", characterId: CHARACTER_A_ID, opponentId: CHARACTER_B_ID, startSeconds: 1, includeContact: true });
  expect(result.ok).toBe(true);
  expect(useWorkbenchStore.getState().dialogueTimeline).toBe(before);
  if (!result.ok) return;
  expect(result.plan.requiresApproval).toBe(true);
  expect(validateDirectorActionPlan(state, result.plan)).toEqual([]);
  const changed = { ...state, dialogueTimeline: { ...state.dialogueTimeline, fps: 30 } };
  expect(validateDirectorActionPlan(changed, result.plan)).toContain("scene_changed");
});

it("rejects unknown, locked, and invalid targets before approval", () => {
  const state = useWorkbenchStore.getState();
  expect(createDirectorActionPlan(state, { text: "不明动作", characterId: CHARACTER_A_ID, startSeconds: 0 }).ok).toBe(false);
  expect(createDirectorActionPlan({ ...state, characters: { ...state.characters, [CHARACTER_A_ID]: { ...state.characters[CHARACTER_A_ID], locked: true } } }, { text: "鹤形拳", characterId: CHARACTER_A_ID, startSeconds: 0 }).ok).toBe(false);
  expect(createDirectorActionPlan(state, { text: "鹤形拳", characterId: CHARACTER_A_ID, opponentId: CHARACTER_A_ID, startSeconds: 0 }).ok).toBe(false);
});
