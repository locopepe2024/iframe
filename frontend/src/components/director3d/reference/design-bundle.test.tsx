import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { createDirectorDesignBundle, parseDirectorDesignBundle } from "./design-bundle";
import { currentDirectorShotPackage } from "./current-shot-package";

const initial = useWorkbenchStore.getState();
beforeEach(() => useWorkbenchStore.setState(initial, true));
afterEach(() => useWorkbenchStore.setState(initial, true));

it("round-trips a seated two-person design as one undoable import", () => {
  const state = useWorkbenchStore.getState();
  const ids = Object.keys(state.characters).slice(0, 2);
  const before = createDirectorDesignBundle(state);
  const nextCharacters = Object.fromEntries(Object.entries(state.characters).map(([id, actor], index) => [id, { ...actor, activePresetId: index < 2 ? "seated.sit" : actor.activePresetId }]));
  useWorkbenchStore.setState({ characters: nextCharacters });
  const exported = createDirectorDesignBundle(useWorkbenchStore.getState());
  expect(exported.authoring.characters[ids[0]].activePresetId).toBe("seated.sit");
  const result = useWorkbenchStore.getState().importDirectorDesignBundle(exported);
  expect(result).toEqual({ ok: true });
  expect(useWorkbenchStore.getState().undoStack).toHaveLength(1);
  useWorkbenchStore.getState().undo();
  expect(createDirectorDesignBundle(useWorkbenchStore.getState()).sourcePackageChecksum).toBe(exported.sourcePackageChecksum);
  expect(before.schemaVersion).toBe("iframe.director3d.design-bundle.v1");
});

it("preserves timed camera paths and rejects malformed or missing dependencies", () => {
  const state = useWorkbenchStore.getState();
  const cameraId = state.selectedCameraId;
  const path = { pathId: "camera-path-roundtrip", targetType: "camera" as const, targetId: cameraId, durationSeconds: 4, easing: "ease_in_out" as const, presetIds: ["push_in" as const], revision: 1, locked: false, visible: true, controlPoints: [
    { controlPointId: "start", positionM: [0, -7, 2.5] as [number, number, number], handleInM: [0, -7, 2.5] as [number, number, number], handleOutM: [0, -6.75, 2.5] as [number, number, number], order: 0 },
    { controlPointId: "mid", positionM: [0, -6.75, 2.5] as [number, number, number], handleInM: [0, -6.75, 2.5] as [number, number, number], handleOutM: [0, -6.5, 2.5] as [number, number, number], order: 1 },
    { controlPointId: "end", positionM: [0, -6.5, 2.5] as [number, number, number], handleInM: [0, -6.5, 2.5] as [number, number, number], handleOutM: [0, -6.5, 2.5] as [number, number, number], order: 2 },
  ] };
  useWorkbenchStore.setState({ cameraPaths: { [path.pathId]: path } });
  const bundle = createDirectorDesignBundle(useWorkbenchStore.getState());
  expect(bundle.authoring.cameraPaths[path.pathId].durationSeconds).toBe(4);
  const malformed = structuredClone(bundle) as any; delete malformed.authoring.cameras[cameraId];
  expect(() => parseDirectorDesignBundle(malformed)).toThrow("机位");
  const missingPath = structuredClone(bundle) as any; missingPath.authoring.cameraPaths[path.pathId].targetId = "camera-missing";
  expect(() => parseDirectorDesignBundle(missingPath)).toThrow("机位路径");
});

it("rejects stale imports when the caller supplies the package checksum it read", () => {
  const state = useWorkbenchStore.getState();
  const bundle = createDirectorDesignBundle(state);
  state.setSkyColor("#123456");
  const result = useWorkbenchStore.getState().importDirectorDesignBundle(bundle, { expectedCurrentPackageChecksum: bundle.sourcePackageChecksum });
  expect(result.ok).toBe(false);
  expect(result).toMatchObject({ errors: [expect.stringContaining("过期")] });
});

it("keeps the evaluated package checksum in the exported bundle", () => {
  const state = useWorkbenchStore.getState();
  const bundle = createDirectorDesignBundle(state);
  expect(bundle.sourcePackageChecksum).toBe(currentDirectorShotPackage(state).packageChecksum);
  expect(bundle.package.packageChecksum).toBe(bundle.sourcePackageChecksum);
});

it("carries the design source and assumptions through export and import", () => {
  const state = useWorkbenchStore.getState();
  const source = { fileName: "street.png", mimeType: "image/png", sizeBytes: 120, sha256: "a".repeat(64), mediaId: "media-source", assumptions: ["遮挡关系待核对"] };
  useWorkbenchStore.setState({ designSource: source, designAssumptions: ["尺度为估计"] });
  const bundle = createDirectorDesignBundle(useWorkbenchStore.getState());
  expect(bundle.authoring.designSource).toEqual(source);
  expect(bundle.authoring.designAssumptions).toEqual(["尺度为估计"]);
  useWorkbenchStore.setState({ designSource: null, designAssumptions: [] });
  expect(useWorkbenchStore.getState().importDirectorDesignBundle(bundle)).toEqual({ ok: true });
  expect(useWorkbenchStore.getState().designSource).toEqual(source);
  expect(useWorkbenchStore.getState().designAssumptions).toEqual(["尺度为估计"]);
  const invalid = structuredClone(bundle) as any;
  invalid.authoring.designSource.sha256 = "invalid";
  expect(() => parseDirectorDesignBundle(invalid)).toThrow("来源");
});
