import { describe, expect, it } from "vitest";

import {
  AvatarRevisionConflictError,
  confirmProjectCharacterBinding,
  createInMemoryAvatarCharacterAssetClient,
  type DigitalAvatarCharacter,
} from "@/lib/avatarCharacterAsset";

const seed: DigitalAvatarCharacter = {
  character_id: "person_123",
  name: "Mira",
  identity_revision: 3,
  identity: { face: "oval", skin: "warm neutral", body: "slim" },
  reference_assets: [
    { id: "face-front", role: "identity", uri: "/avatar/face-front.png" },
    { id: "coat", role: "clothing", uri: "/avatar/coat.png" },
  ],
  review_status: "confirmed",
};

describe("Avatar identity contract", () => {
  it("creates a draft identity in the explicit test adapter", async () => {
    const client = createInMemoryAvatarCharacterAssetClient();
    const created = await client.createCharacter({ name: "Mira", identity: { face: "oval" }, source: "user" });
    expect(created).toMatchObject({ name: "Mira", identity_revision: 1, review_status: "draft" });
    expect((await client.getCharacter(created.character_id)).identity.face).toBe("oval");
  });
  it("reads an immutable revision and filters reference responsibilities", async () => {
    const client = createInMemoryAvatarCharacterAssetClient([seed]);
    const character = await client.getCharacter("person_123", 3);
    expect(character.identity_revision).toBe(3);
    expect(await client.listReferenceAssets("person_123", "identity")).toHaveLength(1);

    character.identity.face = "changed locally";
    expect((await client.getCharacter("person_123", 3)).identity.face).toBe("oval");
  });

  it("increments identity revision and retains the previous snapshot", async () => {
    const client = createInMemoryAvatarCharacterAssetClient([seed]);
    const updated = await client.updateIdentity("person_123", {
      expected_revision: 3,
      identity: { facial_features: "strong brows" },
      source: "user",
    });

    expect(updated.identity_revision).toBe(4);
    expect(updated.review_status).toBe("needs_user_review");
    expect((await client.getCharacter("person_123", 3)).identity).toEqual(seed.identity);
  });

  it("rejects stale writes at the Avatar boundary", async () => {
    const client = createInMemoryAvatarCharacterAssetClient([seed]);
    await client.updateIdentity("person_123", { expected_revision: 3, identity: { body: "athletic" } });

    await expect(
      client.updateIdentity("person_123", { expected_revision: 3, identity: { skin: "cool" } }),
    ).rejects.toMatchObject({
      name: "AvatarRevisionConflictError",
      expectedRevision: 3,
      actualRevision: 4,
    });
  });

  it("confirms only an exact, reviewed Avatar identity and identity-role references", () => {
    const binding = {
      binding_id: "binding_1",
      project_id: "project_1",
      project_character_id: "cast_1",
      avatar_character_id: "person_123",
      identity_revision: 3,
      base_reference_asset_ids: ["face-front"],
      review_status: "draft" as const,
    };
    expect(confirmProjectCharacterBinding(binding, seed).review_status).toBe("confirmed");
    expect(() => confirmProjectCharacterBinding({ ...binding, base_reference_asset_ids: ["coat"] }, seed)).toThrow(/identity/);
    expect(() => confirmProjectCharacterBinding(binding, { ...seed, review_status: "needs_user_review" })).toThrow(/confirmed/);
    expect(() => confirmProjectCharacterBinding(binding, { ...seed, identity_revision: 4 })).toThrow(AvatarRevisionConflictError);
  });
});
