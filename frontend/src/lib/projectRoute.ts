export type ProjectStep = "script" | "art_direction" | "assets" | "storyboard" | "shot_design" | "assembly";

const PROJECT_STEPS = new Set<ProjectStep>([
    "script",
    "art_direction",
    "assets",
    "storyboard",
    "shot_design",
    "assembly",
]);

export function projectRouteHash(projectId: string, step?: string): string {
    const query = step ? `?step=${encodeURIComponent(step)}` : "";
    return `#/project/${encodeURIComponent(projectId)}${query}`;
}

export function parseProjectRouteHash(hash: string): { projectId: string; step: ProjectStep | null } | null {
    const match = hash.match(/^#\/project\/([^/?#]+)(?:\?([^#]*))?(?:#([^#]*))?$/);
    if (!match) return null;

    let projectId: string;
    try {
        projectId = decodeURIComponent(match[1]);
    } catch {
        return null;
    }
    const requestedStep = new URLSearchParams(match[2] || "").get("step") || match[3] || null;
    const step = requestedStep && PROJECT_STEPS.has(requestedStep as ProjectStep)
        ? requestedStep as ProjectStep
        : null;
    return { projectId, step };
}
