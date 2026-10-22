import { describe, expect, it } from "vitest";
import { parseSpokenPhotoDate } from "./spokenDate";

describe("photo date spoken proposals", () => {
  it("retains only the precision the speaker actually supplied", () => {
    expect(parseSpokenPhotoDate("这张照片是1985年拍的")).toEqual({ value: "1985", precision: "year" });
    expect(parseSpokenPhotoDate("一九八五年六月拍的")).toEqual({ value: "1985-06", precision: "month" });
    expect(parseSpokenPhotoDate("一九八五年六月七日拍的")).toEqual({ value: "1985-06-07", precision: "day" });
    expect(parseSpokenPhotoDate("１９８５年６月７号")).toEqual({ value: "1985-06-07", precision: "day" });
    expect(parseSpokenPhotoDate("1985-06")).toEqual({ value: "1985-06", precision: "month" });
  });

  it("rejects uncertain, multiple, incomplete, and invalid dates", () => {
    for (const text of ["大概1985年", "约1985年", "1985年前", "八十年代", "不是1985年", "1985年6月7", "1985年6月7日和1986年", "1985年13月", "1900年2月29日", "1985年6月7日3点"]) {
      expect(parseSpokenPhotoDate(text)).toBeNull();
    }
    expect(parseSpokenPhotoDate("2000年2月29日")).toEqual({ value: "2000-02-29", precision: "day" });
  });
});
