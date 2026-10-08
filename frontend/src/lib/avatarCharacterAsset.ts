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

export interface AvatarCharacterAssetClient {
  getCharacter(characterId: string, revision?: number): Promise<DigitalAvatarCharacter>;
  updateIdentity(characterId: string, patch: IdentityPatch): Promise<DigitalAvatarCharacter>;
  listReferenceAssets(characterId: string, role?: ReferenceRole): Promise<AvatarReferenceAsset[]>;
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
  const current = new Map(seed.map((character) => [character.character_id, clone(character)]));

  return {
    async getCharacter(characterId, revision) {
      const character = current.get(characterId);
      if (!character) throw new Error(`Avatar character not found: ${characterId}`);
      if (revision !== undefined && revision !== character.identity_revision) {
        throw new AvatarRevisionConflictError(characterId, revision, character.identity_revision);
      }
      return clone(character);
    },

    async updateIdentity(characterId, patch) {
      const character = current.get(characterId);
      if (!character) throw new Error(`Avatar character not found: ${characterId}`);
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
      current.set(characterId, next);
      return clone(next);
    },

    async listReferenceAssets(characterId, role) {
      const character = current.get(characterId);
      if (!character) throw new Error(`Avatar character not found: ${characterId}`);
      return clone(role
        ? character.reference_assets.filter((asset) => asset.role === role)
        : character.reference_assets);
    },
  };
}
