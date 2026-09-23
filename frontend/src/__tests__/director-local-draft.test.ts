import { afterEach, expect, it } from "vitest";

import { DIRECTOR_DRAFT_STORAGE_KEY, restoreLocalDirectorDraft, saveLocalDirectorDraft } from "@/components/director3d/state/local-draft";
import { parseLocalAnimationManifest } from "@/components/director3d/state/local-animation-import";
import { CHARACTER_A_ID } from "@/components/director3d/data/humanoid";
import { useWorkbenchStore } from "@/components/director3d/state/workbench-store";

const initialState = useWorkbenchStore.getState();

afterEach(() => useWorkbenchStore.setState(initialState, true));

it("round-trips an explicitly saved browser draft without a network fallback", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const characterId = useWorkbenchStore.getState().selectedCharacterId;
  useWorkbenchStore.getState().renameCharacter(characterId, "草稿人物");
  const savedAt = saveLocalDirectorDraft(storage);
  expect(values.get(DIRECTOR_DRAFT_STORAGE_KEY)).toContain("草稿人物");

  useWorkbenchStore.getState().renameCharacter(characterId, "临时人物");
  expect(restoreLocalDirectorDraft(storage)).toBe(savedAt);
  expect(useWorkbenchStore.getState().characters[characterId].label).toBe("草稿人物");
  expect(useWorkbenchStore.getState().unsavedChanges).toBe(false);
});

it("round-trips applied local animation tracks while discarding transient import preview state", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const parsed = parseLocalAnimationManifest({
    schemaVersion: "iframe.director3d.local-animation.v1",
    manifestId: "draft-animation",
    title: "草稿动作",
    durationSeconds: 2,
    fps: 24,
    tracks: [{ trackId: "pose-a", trackKind: "character_pose", target: { characterId: CHARACTER_A_ID }, propertyKey: "pose.normalized_values", keyframes: [{ timeSeconds: 0, value: { root: [0, 0, 0] }, interpolation: "step" }] }],
  }, { availableCharacterIds: [CHARACTER_A_ID] });
  expect(parsed.ok).toBe(true);
  useWorkbenchStore.getState().setLocalAnimationImportState(parsed.state);
  useWorkbenchStore.getState().applyLocalAnimationManifest();
  const savedAt = saveLocalDirectorDraft(storage);

  useWorkbenchStore.getState().clearLocalAnimationImport();
  expect(restoreLocalDirectorDraft(storage)).toBe(savedAt);
  expect(useWorkbenchStore.getState().dialogueTimeline.tracks.some((track) => track.trackId === "local-animation-draft-animation-pose-a")).toBe(true);
  expect(useWorkbenchStore.getState().localAnimationImport.status).toBe("idle");
});
