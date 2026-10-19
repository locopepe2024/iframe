import { describe, expect, it } from "vitest";
import { CHARACTER_QUICK_PRESETS, searchCharacterQuickPresets, platformCharacterTerm, platformCharacterPattern } from "@/lib/characterQuickActions";
import type { PlatformReferenceResource } from "@/lib/api";

describe("character dictionary layers", () => {
  it("keeps existing preset identities and revisions while mapping domains", () => {
    const route = CHARACTER_QUICK_PRESETS.find((item) => item.id === "character.style.historical-costume");
    expect(route).toMatchObject({ revision: "1", semanticDomain: "world.style", entryType: "term", target: "route" });
    expect(CHARACTER_QUICK_PRESETS.every((item) => item.revision === "1" && item.id.startsWith("character."))).toBe(true);
    expect(CHARACTER_QUICK_PRESETS.filter((item) => item.category === "身材体态").every((item) => item.semanticDomain === "character.identity")).toBe(true);
  });

  it("filters by identity, look and style without hiding cross-layer search results", () => {
    expect(searchCharacterQuickPresets("", "character.identity").every((item) => item.semanticDomain === "character.identity")).toBe(true);
    expect(searchCharacterQuickPresets("", "character.look").every((item) => item.category === "服装")).toBe(true);
    expect(searchCharacterQuickPresets("", "world.style").every((item) => item.category === "风格")).toBe(true);
    expect(searchCharacterQuickPresets("交领长衣").some((item) => item.semanticDomain === "character.look")).toBe(true);
  });
});

const term = (id: string, category_path: string, domain: "character.identity" | "character.look", content: string): PlatformReferenceResource => ({
  platform_resource_id: id, revision: 1, kind: "prompt_preset", category_path, title: id,
  status: "active", dictionary: { semantic_domain: domain, entry_type: "term" },
  payload: { prompt_used: "完整模型提示词", structured_prompt: { content } },
  provenance: { license: "MIT", content_sha256: id },
});

describe("published character dictionary", () => {
  it("inserts reviewed editable text into the matching draft field", () => {
    expect(platformCharacterTerm(term("face-1", "character/identity/face", "character.identity", "窄长脸"))).toMatchObject({
      id: "platform.face-1", revision: "1", target: "face", value: "窄长脸", semanticDomain: "character.identity",
    });
    expect(platformCharacterTerm(term("palette", "character/look/palette", "character.look", "红色"))).toBeNull();
    expect(platformCharacterTerm({ ...term("retired", "character/identity/face", "character.identity", "旧脸型"), status: "retired" })).toBeNull();
  });

  it("resolves only active members at their pinned revisions", () => {
    const face = term("face", "character/identity/face", "character.identity", "窄长脸");
    const skin = term("skin", "character/identity/skin", "character.identity", "浅麦色");
    const pattern: PlatformReferenceResource = {
      ...face, platform_resource_id: "pattern", title: "古典面容",
      dictionary: { semantic_domain: "character.identity", entry_type: "pattern", members: [
        { platform_resource_id: "face", revision: 1, role: "face" },
        { platform_resource_id: "skin", revision: 1, role: "skin" },
      ] },
    };
    expect(platformCharacterPattern(pattern, [face, skin, pattern])?.members.map((member) => member.value)).toEqual(["窄长脸", "浅麦色"]);
    expect(platformCharacterPattern(pattern, [face, { ...skin, revision: 2 }, pattern])).toBeNull();
    expect(platformCharacterPattern(pattern, [face, { ...skin, status: "retired" }, pattern])).toBeNull();
  });
});
