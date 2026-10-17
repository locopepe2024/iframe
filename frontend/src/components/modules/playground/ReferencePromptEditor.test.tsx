import { describe, expect, it } from "vitest";
import { referencePromptDocument } from "./ReferencePromptEditor";

describe("reference prompt restoration", () => {
  it("rebinds a selected scene reference after plain-text prompt replacement", () => {
    const reference = { asset_type: "scene", asset_id: "long-street", variant_id: "v1" } as const;
    const document = referencePromptDocument(
      "长街中段的粮铺。光影和远景和@青溪镇青石板长街保持一致",
      [{
        label: "青溪镇青石板长街 · 未命名素材 1",
        reference,
      }, {
        label: "青溪镇青石板长街",
        reference,
      }],
      true,
      true,
    );
    const token = document.content?.[0]?.content?.find((item: any) => item.type === "referenceToken") as any;
    expect(token?.attrs).toMatchObject(reference);
  });
});
