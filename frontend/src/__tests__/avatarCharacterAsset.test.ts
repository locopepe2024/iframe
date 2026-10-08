import { describe, expect, it } from "vitest";
import type { CharacterDesign, DigitalAvatarCharacter } from "@/lib/avatarCharacterAsset";

describe("Avatar character design contract", () => {
  it("keeps identity, look and basis in the design spec without media lifecycle fields", () => {
    const design: CharacterDesign = {
      route: "realistic-modern", age_stage: "young-adult",
      identity: { face: "oval", visual_notes: "Oval face and narrow eyes" },
      look: { visual_notes: "Black coat" }, basis: { face: "user_specified" }, unresolved: [],
    };
    const character: DigitalAvatarCharacter = {
      character_id: "avatar_1", name: "Mira", profile: "", design_revision: 2,
      character_design: { design_draft: design, design_revisions: [{ revision: 2, design }] },
      review_status: "confirmed",
    };
    expect(character.character_design.design_revisions[0].design.basis?.face).toBe("user_specified");
    expect(character).not.toHaveProperty("reference_assets");
  });
});
