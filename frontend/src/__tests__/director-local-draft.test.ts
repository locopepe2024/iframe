import { afterEach, expect, it } from "vitest";

import { DIRECTOR_DRAFT_STORAGE_KEY, restoreLocalDirectorDraft, saveLocalDirectorDraft } from "@/components/director3d/state/local-draft";
import { parseLocalAnimationManifest } from "@/components/director3d/state/local-animation-import";
import { parseFrameManifest } from "@/components/director3d/state/frame-manifest-import";
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

it("round-trips the read-only frame manifest identity and local revision", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const parsed = parseFrameManifest({
    schema_version: "recreation.frame-manifest.v1",
    manifest_id: "reviewed-reference",
    source_media_id: "source-video",
    source_checksum: "a".repeat(64),
    analysis_id: "analysis-1",
    time_base: "1/24",
    source_start_pts: 0,
    source_end_pts: 48,
    duration_seconds: 2,
    review_state: "reviewed",
    frames: [{ frame_id: "frame-1", source_pts: 12, source_seconds: 0.5, evidence_media_id: "evidence-1", evidence_media_path: "/evidence-1.jpg", width: 640, height: 360, extraction_method: "manual" }],
  }, { fileName: "reviewed-reference.json" });
  expect(parsed.ok).toBe(true);
  useWorkbenchStore.getState().setFrameManifestImportState(parsed.state);
  expect(useWorkbenchStore.getState().frameManifestImport.revision).toBe(1);
  const savedAt = saveLocalDirectorDraft(storage);

  useWorkbenchStore.getState().clearFrameManifestImport();
  expect(restoreLocalDirectorDraft(storage)).toBe(savedAt);
  const restored = useWorkbenchStore.getState().frameManifestImport;
  expect(restored.status).toBe("ready");
  expect(restored.manifest?.source_checksum).toBe("a".repeat(64));
  expect(restored.revision).toBe(1);
});
