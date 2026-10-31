import { describe, expect, it } from "vitest";
import { nextCrowdCharacterName } from "./crowdNaming";

describe("nextCrowdCharacterName", () => {
  it("preserves the first requested name and increments numbered names", () => {
    expect(nextCrowdCharacterName("流民匪寇-1", [])).toBe("流民匪寇-1");
    expect(nextCrowdCharacterName("流民匪寇-1", ["流民匪寇-1"])).toBe("流民匪寇-2");
    expect(nextCrowdCharacterName("流民匪寇-1", ["流民匪寇-1", "流民匪寇-3"])).toBe("流民匪寇-4");
  });

  it("starts numbered names for an unnumbered label after its base exists", () => {
    expect(nextCrowdCharacterName("青溪镇市井百姓", [])).toBe("青溪镇市井百姓");
    expect(nextCrowdCharacterName("青溪镇市井百姓", ["青溪镇市井百姓"])).toBe("青溪镇市井百姓-1");
  });
});
