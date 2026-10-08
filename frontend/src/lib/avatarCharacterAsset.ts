/**
 * Avatar identity contract used by iFrame.
 *
 * This module deliberately contains no HTTP paths. Avatar owns the durable
 * identity asset and its revisions; iFrame only consumes the contract.
 */

export type ReviewStatus = "draft" | "needs_user_review" | "confirmed" | "stale";

export type ReferenceRole =
  | "identity"
  | "clothing"
  | "action"
  | "scene";

export interface IdentityDesign {
  /** Stable visual facts. Empty fields mean unspecified, not inferred. */
  face?: string;
  facial_features?: string;
  skin?: string;
  body?: string;
  age_appearance?: string;
  gender_expression?: string;
  base_hair?: string;
  identity_anchors?: string[];
}

export interface AvatarReferenceAsset {
  id: string;
  role: ReferenceRole;
  uri: string;
  label?: string;
  created_at?: string;
}

export interface DigitalAvatarCharacter {
  character_id: string;
  name: string;
  identity_revision: number;
  identity: IdentityDesign;
  reference_assets: AvatarReferenceAsset[];
  review_status: ReviewStatus;
  updated_at?: string;
}

export interface IdentityPatch {
  identity: Partial<IdentityDesign>;
  expected_revision: number;
  source?: "user" | "migration" | "avatar";
}

export interface CreateAvatarCharacterInput {
  name: string;
  identity: IdentityDesign;
  source: "user";
}

export interface AvatarCharacterAssetClient {
  createCharacter(input: CreateAvatarCharacterInput): Promise<DigitalAvatarCharacter>;
  getCharacter(characterId: string, revision?: number): Promise<DigitalAvatarCharacter>;
  updateIdentity(characterId: string, patch: IdentityPatch): Promise<DigitalAvatarCharacter>;
  listReferenceAssets(characterId: string, role?: ReferenceRole): Promise<AvatarReferenceAsset[]>;
}

/** iFrame-owned adoption record. It points at Avatar; it owns no media. */
export interface ProjectCharacterBinding {
  binding_id: string;
  project_id: string;
  project_character_id: string;
  avatar_character_id: string;
  identity_revision: number;
  base_reference_asset_ids: string[];
  review_status: "draft" | "confirmed" | "stale";
}

export function confirmProjectCharacterBinding(
  binding: ProjectCharacterBinding,
  identity: DigitalAvatarCharacter,
): ProjectCharacterBinding {
  if (binding.avatar_character_id !== identity.character_id
      || binding.identity_revision !== identity.identity_revision) {
    throw new AvatarRevisionConflictError(
      binding.avatar_character_id,
      binding.identity_revision,
      identity.identity_revision,
    );
  }
  if (identity.review_status !== "confirmed") {
    throw new Error("Avatar identity must be confirmed before project adoption");
  }
  const allowed = new Set(identity.reference_assets
    .filter((asset) => asset.role === "identity")
    .map((asset) => asset.id));
  if (binding.base_reference_asset_ids.some((id) => !allowed.has(id))) {
    throw new Error("Project base references must belong to the confirmed Avatar identity");
  }
  return { ...binding, base_reference_asset_ids: [...binding.base_reference_asset_ids], review_status: "confirmed" };
}

export class AvatarRevisionConflictError extends Error {
  readonly characterId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(characterId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Avatar identity revision conflict for ${characterId}: expected ${expectedRevision}, actual ${actualRevision}`,
    );
    this.name = "AvatarRevisionConflictError";
    this.characterId = characterId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Explicit test/development adapter. Never use as a production fallback. */
export function createInMemoryAvatarCharacterAssetClient(
  seed: DigitalAvatarCharacter[] = [],
): AvatarCharacterAssetClient {
  const history = new Map(seed.map((character) => [
    character.character_id,
    new Map([[character.identity_revision, clone(character)]]),
  ]));

  function latest(characterId: string): DigitalAvatarCharacter {
    const revisions = history.get(characterId);
    if (!revisions) throw new Error(`Avatar character not found: ${characterId}`);
    return revisions.get(Math.max(...Array.from(revisions.keys())))!;
  }

  return {
    async createCharacter(input) {
      const character: DigitalAvatarCharacter = {
        character_id: `test_${crypto.randomUUID()}`,
        name: input.name.trim(),
        identity_revision: 1,
        identity: clone(input.identity),
        reference_assets: [],
        review_status: "draft",
      };
      history.set(character.character_id, new Map([[1, clone(character)]]));
      return clone(character);
    },
    async getCharacter(characterId, revision) {
      const character = revision === undefined
        ? latest(characterId)
        : history.get(characterId)?.get(revision);
      if (!character) throw new Error(`Avatar identity revision not found: ${characterId}@${revision}`);
      return clone(character);
    },

    async updateIdentity(characterId, patch) {
      const character = latest(characterId);
      if (patch.expected_revision !== character.identity_revision) {
        throw new AvatarRevisionConflictError(
          characterId,
          patch.expected_revision,
          character.identity_revision,
        );
      }
      const next: DigitalAvatarCharacter = {
        ...character,
        identity_revision: character.identity_revision + 1,
        identity: { ...character.identity, ...patch.identity },
        review_status: "needs_user_review",
      };
      history.get(characterId)!.set(next.identity_revision, clone(next));
      return clone(next);
    },

    async listReferenceAssets(characterId, role) {
      const character = latest(characterId);
      return clone(role
        ? character.reference_assets.filter((asset) => asset.role === role)
        : character.reference_assets);
    },
  };
}
