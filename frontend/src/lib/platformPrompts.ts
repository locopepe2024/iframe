import type { PlatformReferenceResource } from "@/lib/api";

export type PromptResource = PlatformReferenceResource & { payload: { prompt_used: string; media_file?: string | null } };

export function editablePlatformPrompt(resource: PromptResource): string {
  return resource.payload.structured_prompt?.content?.trim() || resource.payload.prompt_used.trim();
}

export function isUsablePlatformPrompt(resource: PlatformReferenceResource, categoryPrefix: string): resource is PromptResource {
  return resource.status === "active" && resource.category_path?.startsWith(categoryPrefix) === true
    && (!resource.dictionary || resource.dictionary.entry_type === "case")
    && (resource.kind === "prompt_preset" || resource.kind === "image")
    && typeof resource.payload?.prompt_used === "string" && resource.payload.prompt_used.trim().length > 0;
}

