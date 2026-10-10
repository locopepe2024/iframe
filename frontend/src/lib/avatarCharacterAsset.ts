/** Avatar owns character design. iFrame owns media, candidates and project adoption. */
export interface IdentityDesign {
  face?: string;
  facial_features?: string;
  eye_shape?: string;
  brow_shape?: string;
  nose_shape?: string;
  lip_shape?: string;
  facial_mark?: string;
  skin?: string;
  body?: string;
  age_appearance?: string;
  gender_expression?: string;
  base_hair?: string;
  identity_anchors?: string[];
  visual_notes?: string;
}

export interface CharacterDesign {
  route?: string;
  age_stage?: string;
  identity: IdentityDesign;
  look?: { route?: string; visual_notes?: string };
  unresolved?: string[];
  field_status?: Record<string, string>;
  skill_id?: string;
  skill_revision?: string;
  basis?: Record<string, string>;
  reference_asset_id?: string;
}

export interface DigitalAvatarCharacter {
  character_id: string;
  name: string;
  profile: string;
  design_revision: number;
  character_design: {
    design_draft: CharacterDesign;
    design_revisions: { revision: number; design: CharacterDesign }[];
  };
  review_status: "draft" | "confirmed";
  revision_history?: { design_revision: number; review_status: "draft" | "confirmed" }[];
  /** @deprecated compatibility projection for pre-design clients. */
  identity_revision?: number;
  identity?: IdentityDesign;
}

export interface UpdateAvatarDesignInput {
  expected_revision: number;
  character_design: CharacterDesign;
  confirmed: boolean;
  name?: string;
  profile?: string;
}
