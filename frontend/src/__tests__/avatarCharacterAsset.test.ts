import { describe, expect, it } from "vitest";

import {
  AvatarRevisionConflictError,
  createInMemoryAvatarCharacterAssetClient,
  type DigitalAvatarCharacter,
} from "@/lib/avatarCharacterAsset";

const seed: DigitalAvatarCharacter = {
  character_id: "person_123",
  identity_revision: 3,
  identity: { face: "oval", skin: "warm neutral", body: "slim" },
  reference_assets: [
    { id: "face-front", role: "identity", uri: "/avatar/face-front.png" },
    { id: "coat", role: "clothing", uri: "/avatar/coat.png" },
  ],
  review_status: "confirmed",
};

describe("Avatar identity contract", () => {
  it("reads an immutable revision and filters reference responsibilities", async () => {
    const client = createInMemoryAvatarCharacterAssetClient([seed]);
    const character = await client.getCharacter("person_123", 3);
    expect(character.identity_revision).toBe(3);
    expect(await client.listReferenceAssets("person_123", "identity")).toHaveLength(1);

    character.identity.face = "changed locally";
    expect((await client.getCharacter("person_123", 3)).identity.face).toBe("oval");
  });

  it("increments identity revision without rewriting the previous snapshot", async () => {
    const client = createInMemoryAvatarCharacterAssetClient([seed]);
    const updated = await client.updateIdentity("person_123", {
      expected_revision: 3,
      identity: { facial_features: "strong brows" },
      source: "user",
    });

    expect(updated.identity_revision).toBe(4);
    expect(updated.review_status).toBe("needs_user_review");
    await expect(client.getCharacter("person_123", 3)).rejects.toBeInstanceOf(AvatarRevisionConflictError);
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
});
