import type { OrientationGizmoState, ViewMode, ViewportNavigation, ViewportNavigationByView } from "../types";

export const DEFAULT_VIEWPORT_NAVIGATION: ViewportNavigationByView = {
  director: { positionM: [3, -4.2, 2.2], targetM: [0, 0, 0.9], up: [0, 0, 1], zoom: 1 },
  top: { positionM: [0, 0, 5.2], targetM: [0, 0, 0], up: [0, 1, 0], zoom: 1 },
  camera: { positionM: [0, -4.5, 1.2], targetM: [0, 0, 1.1], up: [0, 0, 1], zoom: 1 },
};

export const DEFAULT_ORIENTATION_GIZMO: OrientationGizmoState = { visible: true, corner: "top-right" };

function bounded(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function vector(value: unknown, fallback: [number, number, number], minimum: number, maximum: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((item, index) => bounded(item, fallback[index], minimum, maximum)) as [number, number, number];
}

export function sanitizeViewportNavigation(value: unknown, fallback: ViewportNavigation): ViewportNavigation {
  const candidate = value && typeof value === "object" ? value as Partial<ViewportNavigation> : {};
  const up = vector(candidate.up, fallback.up, -1, 1);
  const upLength = Math.hypot(...up);
  return {
    positionM: vector(candidate.positionM, fallback.positionM, -100, 100),
    targetM: vector(candidate.targetM, fallback.targetM, -100, 100),
    up: upLength > 0.001 ? up.map((component) => component / upLength) as [number, number, number] : [...fallback.up],
    zoom: bounded(candidate.zoom, fallback.zoom, 0.1, 10),
  };
}

export function sanitizeViewportNavigationByView(value: unknown): ViewportNavigationByView {
  const candidate = value && typeof value === "object" ? value as Partial<Record<ViewMode, unknown>> : {};
  return {
    director: sanitizeViewportNavigation(candidate.director, DEFAULT_VIEWPORT_NAVIGATION.director),
    top: sanitizeViewportNavigation(candidate.top, DEFAULT_VIEWPORT_NAVIGATION.top),
    camera: sanitizeViewportNavigation(candidate.camera, DEFAULT_VIEWPORT_NAVIGATION.camera),
  };
}

export function navigationEqual(left: ViewportNavigation, right: ViewportNavigation, epsilon = 0.0001): boolean {
  return left.positionM.every((value, index) => Math.abs(value - right.positionM[index]) <= epsilon)
    && left.targetM.every((value, index) => Math.abs(value - right.targetM[index]) <= epsilon)
    && left.up.every((value, index) => Math.abs(value - right.up[index]) <= epsilon)
    && Math.abs(left.zoom - right.zoom) <= epsilon;
}
