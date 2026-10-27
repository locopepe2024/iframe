// @vitest-environment node
import { expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { compileDesignProposal, designContext, designRevision, parseDesignProposal } from "./design-proposal";

const origin = process.env.IFRAME_DIRECTOR_LIVE_URL;

it.skipIf(!origin)("accepts a real-model seated pair request while preserving the current camera", async () => {
  const url = new URL(origin!);
  const token = process.env.IFRAME_DIRECTOR_LIVE_TOKEN?.trim();
  if (!token) throw new Error("Set IFRAME_DIRECTOR_LIVE_TOKEN for an explicitly designated test owner");
  const initial = useWorkbenchStore.getState();
  try {
    if (Object.keys(initial.characters).length < 2) initial.addWhiteModelCharacter();
    const state = useWorkbenchStore.getState();
    const actorIds = Object.keys(state.characters).slice(0, 2);
    useWorkbenchStore.setState({
      rigAdmissionStatus: "passed", actorPaths: {}, cameraPaths: {}, playheadFrame: 1,
      sceneObjects: {},
      characters: Object.fromEntries(Object.entries(state.characters).map(([id, actor], index) => [id, {
        ...structuredClone(actor), visible: actorIds.includes(id), locked: false, calibratedPlacement: null,
        proxyAssetId: null, transform: { ...actor.transform, position: [index * 2 - 1, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      }])),
      dialogueTimeline: { ...state.dialogueTimeline, tracks: [], activeCameraTrackId: null }, undoStack: [], redoStack: [],
    });
    const before = useWorkbenchStore.getState();
    const cameraBefore = structuredClone(before.cameras);
    const revision = designRevision(before);
    const response = await fetch(new URL("/director3d/design-proposals", url), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(150_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "两个人坐在椅子上，当前的镜头机位", baseRevision: revision, context: designContext(before), history: [] }),
    });
    expect(response.status).toBe(200);
    const proposal = parseDesignProposal(await response.json());
    expect(proposal.clarification).toBeNull();
    expect(proposal.operations).toHaveLength(2);
    expect(proposal.operations.every((operation) => operation.kind === "seat_actor")).toBe(true);
    expect(new Set(proposal.operations.map((operation) => operation.kind === "seat_actor" ? operation.actorId : "")).size).toBe(2);
    expect(proposal.operations.every((operation) => operation.kind !== "seat_actor" || operation.chairId.startsWith("design-chair-"))).toBe(true);
    const preview = compileDesignProposal(before, proposal);
    expect(preview.cameras).toEqual(cameraBefore);
    expect(Object.keys(preview.sceneObjects)).toHaveLength(12);
    for (const id of actorIds) {
      expect(preview.characters[id].activePresetId).toBe("seated.sit");
      expect(preview.characters[id].poseRootOffsetM[2]).toBeGreaterThan(-.42);
    }
    expect(useWorkbenchStore.getState().characters).toEqual(before.characters);
    before.applyDesignProposal(proposal);
    expect(useWorkbenchStore.getState().undoStack).toHaveLength(1);
  } finally {
    useWorkbenchStore.setState(initial, true);
  }
}, 240_000);
