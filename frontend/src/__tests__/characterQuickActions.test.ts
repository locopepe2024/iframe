import { describe, expect, it } from "vitest";
import { CHARACTER_QUICK_PRESETS, searchCharacterQuickPresets } from "@/lib/characterQuickActions";

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
