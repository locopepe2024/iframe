import { afterEach, expect, it } from "vitest";

import { DIRECTOR_DRAFT_STORAGE_KEY, restoreLocalDirectorDraft, saveLocalDirectorDraft } from "@/components/director3d/state/local-draft";
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
