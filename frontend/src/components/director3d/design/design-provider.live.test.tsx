// @vitest-environment node
import { expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { cameraRuntime, evaluatePathPosition } from "../timeline/timeline-evaluation";
import { compileDesignProposal, designContext, designRevision, parseDesignProposal } from "./design-proposal";

// Explicit opt-in: ordinary CI must never consume model calls or user credentials.
const origin = process.env.IFRAME_DIRECTOR_LIVE_URL;
it.skipIf(!origin)("accepts real-model designs through the actual compiler and atomic store", async () => {
  const url = new URL(origin!);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("IFRAME_DIRECTOR_LIVE_URL must be an HTTPS origin or loopback HTTP origin");
  }
  const token = process.env.IFRAME_DIRECTOR_LIVE_TOKEN?.trim();
  if (!token) throw new Error("Set IFRAME_DIRECTOR_LIVE_TOKEN to an explicitly designated test-owner session token");
  const initial = useWorkbenchStore.getState();
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const snapshot = () => {
    const s = useWorkbenchStore.getState();
    return structuredClone({ characters: s.characters, sceneObjects: s.sceneObjects, cameras: s.cameras });
  };
  const ask = async (name: string, prompt: string) => {
    const s = useWorkbenchStore.getState();
    const before = designRevision(s);
    const started = performance.now();
    const response = await fetch(new URL("/director3d/design-proposals", url), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(150_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, baseRevision: before, context: designContext(s), history }),
    });
    // Never print credentials, request context, or upstream error bodies.
    console.info(JSON.stringify({ case: name, status: response.status, elapsedMs: Math.round(performance.now() - started) }));
    expect(response.status, `${name}: proposal HTTP status`).toBe(200);
    const proposal = parseDesignProposal(await response.json());
    expect(proposal.baseRevision).toBe(before);
    expect(designRevision(useWorkbenchStore.getState())).toBe(before);
    history.push({ role: "user", content: prompt }, { role: "assistant", content: proposal.summary });
    return proposal;
  };
  try {
    if (Object.keys(initial.characters).length < 2) initial.addWhiteModelCharacter();
    const s = useWorkbenchStore.getState();
    const ids = Object.keys(s.characters).slice(0, 2);
    useWorkbenchStore.setState({
      characters: Object.fromEntries(Object.entries(s.characters).map(([id, c]) => [id, {
        ...structuredClone(c), visible: ids.includes(id), locked: false, calibratedPlacement: null,
      }])),
      sceneObjects: {}, actorPaths: {}, cameraPaths: {}, playheadFrame: 1,
      dialogueTimeline: { ...s.dialogueTimeline, tracks: [], activeCameraTrackId: null },
      undoStack: [], redoStack: [],
    });
    const before = snapshot();
    const proposal = await ask("pair-table-35mm", "把现有的两个人物隔桌面对面摆放：沿世界 X 轴，中心在原点，间距 3 米；中间加一个 1.2×0.8×0.75 米的桌子占位。当前机位用 35mm，从世界 -Y 方向、距离中心 6 米同时拍到两人，仰角 5 度。仅静态摆位，不要坐姿。");
    expect(proposal.clarification).toBeNull();
    const preview = compileDesignProposal(useWorkbenchStore.getState(), proposal);
    expect(snapshot()).toEqual(before);
    expect(useWorkbenchStore.getState().undoStack).toHaveLength(0);
    const positions = ids.map((id) => preview.characters[id].transform.position).sort((a, b) => a[0] - b[0]);
    expect(positions[0]).toEqual([-1.5, 0, 0]);
    expect(positions[1]).toEqual([1.5, 0, 0]);
    for (const id of ids) {
      const actor = preview.characters[id];
      const yaw = actor.transform.rotationDeg[2] * Math.PI / 180;
      expect(-Math.sin(yaw)).toBeCloseTo(actor.transform.position[0] < 0 ? 1 : -1);
    }
    const props = Object.values(preview.sceneObjects);
    expect(props).toHaveLength(1);
    expect(props[0].dimensionsM).toEqual([1.2, .8, .75]);
    expect(props[0].transform.position).toEqual([0, 0, 0]);
    const cameraId = useWorkbenchStore.getState().selectedCameraId;
    expect(preview.cameras[cameraId].focalLengthMm).toBe(35);
    expect([...preview.cameras[cameraId].subjectTargetIds].sort()).toEqual([...ids].sort());
    useWorkbenchStore.getState().applyDesignProposal(proposal);
    const applied = snapshot();
    expect(useWorkbenchStore.getState().undoStack).toHaveLength(1);
    useWorkbenchStore.getState().undo();
    expect(snapshot()).toEqual(before);
    useWorkbenchStore.getState().redo();
    expect(snapshot()).toEqual(applied);

    const dolly = await ask("camera-only-half-meter", "只把当前相机朝现有目标拉近半米，人物、桌子、焦距和目标绑定都保持不变。");
    expect(dolly.clarification).toBeNull();
    const dollyPreview = compileDesignProposal(useWorkbenchStore.getState(), dolly);
    expect(dollyPreview.characters).toEqual(applied.characters);
    expect(dollyPreview.sceneObjects).toEqual(applied.sceneObjects);
    const oldCamera = applied.cameras[cameraId], newCamera = dollyPreview.cameras[cameraId];
    expect(newCamera.focalLengthMm).toBe(oldCamera.focalLengthMm);
    expect(newCamera.subjectTargetIds).toEqual(oldCamera.subjectTargetIds);
    expect(newCamera.lookAt).toEqual(oldCamera.lookAt);
    expect(newCamera.follow).toEqual(oldCamera.follow);
    const oldRuntime = cameraRuntime(oldCamera, applied.characters, applied.sceneObjects);
    const distance = (p: number[]) => Math.hypot(...p.map((v, i) => v - oldRuntime.targetM[i]));
    expect(distance(oldRuntime.positionM) - distance(cameraRuntime(newCamera, dollyPreview.characters, dollyPreview.sceneObjects).positionM)).toBeCloseTo(.5);
    useWorkbenchStore.setState({ playheadFrame: 2 });
    const stale = useWorkbenchStore.getState();
    expect(() => stale.applyDesignProposal(dolly)).toThrow("场景已变化");
    expect(useWorkbenchStore.getState()).toBe(stale);
    useWorkbenchStore.setState({ playheadFrame: 1 });
    useWorkbenchStore.getState().applyDesignProposal(dolly);
    const finalScene = snapshot();
    const motion = await ask("timed-camera-motion", "让当前相机在四秒内缓慢推进半米，生成运镜动画；保留人物、道具、焦距和目标绑定。");
    expect(motion.clarification).toBeNull();
    expect(motion.operations).toHaveLength(1);
    expect(motion.operations[0].kind).toBe("camera_motion");
    if (motion.operations[0].kind === "camera_motion") expect(motion.operations[0].distanceM).toBe(.5);
    const motionPreview = compileDesignProposal(useWorkbenchStore.getState(), motion);
    expect(motionPreview.characters).toEqual(finalScene.characters);
    expect(motionPreview.sceneObjects).toEqual(finalScene.sceneObjects);
    expect(motionPreview.cameras[cameraId]).toEqual(finalScene.cameras[cameraId]);
    expect(motionPreview.cameraPaths[`path-${cameraId}-motion`].durationSeconds).toBe(4);
    const path = motionPreview.cameraPaths[`path-${cameraId}-motion`];
    const start = finalScene.cameras[cameraId].transform.position;
    expect(Math.hypot(...evaluatePathPosition(path, 4).map((value, axis) => value - start[axis]))).toBeCloseTo(.5);
    useWorkbenchStore.getState().applyDesignProposal(motion);
    expect(useWorkbenchStore.getState().undoStack).toHaveLength(3);
    console.info("Configured endpoint acceptance passed; provider authenticity, WebGL visuals and media rendering require separate evidence.");
  } finally {
    useWorkbenchStore.setState(initial, true);
  }
}, 480_000);
