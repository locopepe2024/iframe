import { describe, expect, it } from "vitest";
import { parsePanoramaScenePackage } from "@/components/director3d/state/panorama-scene-package";
import { useWorkbenchStore } from "@/components/director3d/state/workbench-store";

const valid = {
  schema: "director-panorama-scene-package.v1",
  panoramaInputId: "/playground/input-media/pano.png",
  panoramaChecksum: "a".repeat(64),
  coordinateSystem: "blender_x_right_y_depth_z_up",
  horizonYNormalized: 0.5,
  depth: { inputId: "/playground/input-media/depth.exr", checksum: "b".repeat(64), nearM: 0.5, farM: 80, quality: "draft" },
  semanticAnchors: [{ anchorId: "door", kind: "entrance", positionM: [2, 6, 0], confidence: 0.8 }],
  ground: { heightM: 0, quality: "draft" },
  blockingCodes: [],
  reviewStatus: "depth_draft",
  estimatorVersion: "depth-estimator.v1",
};

describe("panorama scene package", () => {
  it("accepts a checksum-bound draft package", () => {
    const result = parsePanoramaScenePackage(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.package.depth?.farM).toBe(80);
  });

  it("rejects mismatched coordinate systems and invalid depth ranges", () => {
    const result = parsePanoramaScenePackage({ ...valid, coordinateSystem: "image_x_right_y_down_z_depth", depth: { ...valid.depth, nearM: 8, farM: 2 } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["coordinateSystem 不受支持。", "depth 契约无效，必须声明已校验输入、范围和质量状态，或明确为 null。"]));
  });

  it("rejects a foreign panorama path and incomplete anchor", () => {
    const result = parsePanoramaScenePackage({ ...valid, panoramaInputId: "https://example.test/pano.png", semanticAnchors: [{ anchorId: "door", kind: "entrance", positionM: [2, 6], confidence: 2 }] });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(["panoramaInputId 必须是 owner-scoped Playground 图片路径。", "semanticAnchors[0] 无效。"]));
  });

  it("keeps an unverified manual layout out of production-ready", () => {
    const result = parsePanoramaScenePackage({ ...valid, depth: null, reviewStatus: "production_ready" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("未提供深度输入的人工草稿不能标记 production_ready。");
  });

  it("binds an admitted panorama and depth checksum in the director store", () => {
    const initial = useWorkbenchStore.getState();
    const entry = (inputId: string, checksum: string, usage: "panorama" | "calibration_depth") => ({
      inputId, checksum, admissionChecksum: usage === "panorama" ? checksum : null, label: inputId,
      mediaKind: "image" as const, usage, mimeType: "image/png", width: 400, height: 200,
      durationSeconds: null, projection: usage === "panorama" ? "equirectangular" as const : "calibration_layer" as const,
      workflowState: "verified", environmentAllowed: usage === "panorama", blockingCodes: [], depthSampleGrid: null,
    });
    useWorkbenchStore.getState().setEnvironmentInputCatalog({ status: "ready", message: "", entries: [entry(valid.panoramaInputId, valid.panoramaChecksum, "panorama"), entry(valid.depth.inputId, valid.depth.checksum, "calibration_depth")] });
    useWorkbenchStore.getState().assignPanoramaInput(valid.panoramaInputId);
    expect(useWorkbenchStore.getState().applyPanoramaScenePackage(valid)).toEqual({ ok: true });
    expect(useWorkbenchStore.getState().panoramaScenePackage?.panoramaChecksum).toBe(valid.panoramaChecksum);
    useWorkbenchStore.setState(initial, true);
  });

  it("rejects a stale panorama checksum without replacing the active package", () => {
    const initial = useWorkbenchStore.getState();
    useWorkbenchStore.getState().setEnvironmentInputCatalog({ status: "ready", message: "", entries: [{
      inputId: valid.panoramaInputId, checksum: "c".repeat(64), admissionChecksum: "c".repeat(64), label: "stale",
      mediaKind: "image", usage: "panorama", mimeType: "image/png", width: 400, height: 200, durationSeconds: null,
      projection: "equirectangular", workflowState: "verified", environmentAllowed: true, blockingCodes: [], depthSampleGrid: null,
    }] });
    const result = useWorkbenchStore.getState().applyPanoramaScenePackage(valid);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toContain("全景 checksum 与场景包不匹配，拒绝应用深度包。");
    expect(useWorkbenchStore.getState().panoramaScenePackage).toBeNull();
    useWorkbenchStore.setState(initial, true);
  });

  it("creates a manual layout and invalidates it when the panorama is removed", () => {
    const initial = useWorkbenchStore.getState();
    useWorkbenchStore.getState().setEnvironmentInputCatalog({ status: "ready", message: "", entries: [{
      inputId: valid.panoramaInputId, checksum: valid.panoramaChecksum, admissionChecksum: valid.panoramaChecksum, label: "room",
      mediaKind: "image", usage: "panorama", mimeType: "image/png", width: 400, height: 200, durationSeconds: null,
      projection: "equirectangular", workflowState: "verified", environmentAllowed: true, blockingCodes: [], depthSampleGrid: null,
    }] });
    useWorkbenchStore.getState().assignPanoramaInput(valid.panoramaInputId);
    expect(useWorkbenchStore.getState().createManualPanoramaLayout()).toBe(true);
    expect(useWorkbenchStore.getState().panoramaScenePackage?.depth).toBeNull();
    expect(useWorkbenchStore.getState().addPanoramaAnchor("entrance", [2, 3, 0])).toBe(true);
    expect(useWorkbenchStore.getState().panoramaScenePackage?.semanticAnchors).toHaveLength(1);
    useWorkbenchStore.getState().toggleGroundLocked();
    useWorkbenchStore.getState().setGroundHeightM(1.25);
    expect(useWorkbenchStore.getState().panoramaScenePackage?.ground.heightM).toBe(1.25);
    useWorkbenchStore.getState().undo();
    expect(useWorkbenchStore.getState().panoramaScenePackage?.ground.heightM).toBe(0);
    useWorkbenchStore.getState().assignPanoramaInput(null);
    expect(useWorkbenchStore.getState().panoramaScenePackage).toBeNull();
    useWorkbenchStore.setState(initial, true);
  });

  it("rejects import until its panorama is selected and clears a stale catalog binding", () => {
    const initial = useWorkbenchStore.getState();
    const entry = { inputId: valid.panoramaInputId, checksum: valid.panoramaChecksum, admissionChecksum: valid.panoramaChecksum, label: "room",
      mediaKind: "image" as const, usage: "panorama" as const, mimeType: "image/png", width: 400, height: 200, durationSeconds: null,
      projection: "equirectangular" as const, workflowState: "verified", environmentAllowed: true, blockingCodes: [], depthSampleGrid: null };
    useWorkbenchStore.getState().setEnvironmentInputCatalog({ status: "ready", message: "", entries: [entry] });
    useWorkbenchStore.getState().assignPanoramaInput(null);
    const unselected = useWorkbenchStore.getState().applyPanoramaScenePackage({ ...valid, depth: null });
    expect(unselected).toMatchObject({ ok: false, errors: expect.arrayContaining(["请先选中场景包对应的全景素材。"]) });
    useWorkbenchStore.getState().assignPanoramaInput(entry.inputId);
    expect(useWorkbenchStore.getState().createManualPanoramaLayout()).toBe(true);
    useWorkbenchStore.getState().setEnvironmentInputCatalog({ status: "ready", message: "", entries: [{ ...entry, checksum: "c".repeat(64), admissionChecksum: "c".repeat(64) }] });
    expect(useWorkbenchStore.getState().panoramaScenePackage).toBeNull();
    useWorkbenchStore.setState(initial, true);
  });
});
