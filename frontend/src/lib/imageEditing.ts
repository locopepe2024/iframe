/** Shared vocabulary for reviewed image editing requests.
 *
 * `freeform` is the generic image editor. The scene modes are structured
 * derivations from a saved scene variant; their parameters remain owned by
 * SceneImageTools.
 */
export type ImageEditMode = "freeform" | "scene_lighting" | "scene_camera";

export type ImageEditProjection = {
    source_variant?: string;
    ordered_references: string[];
    edit_mode: ImageEditMode;
    compiled_prompt: string;
    negative_prompt: string;
    model_id?: string;
    aspect_ratio?: string;
    review_fingerprint?: string;
};

export function imageEditModeFromSceneTool(sceneTool?: { kind?: string } | null): ImageEditMode {
    if (sceneTool?.kind === "lighting") return "scene_lighting";
    if (sceneTool?.kind === "camera") return "scene_camera";
    return "freeform";
}
