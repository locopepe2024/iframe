import { expect, it } from "vitest";
import { diaryDay } from "./DiaryCard";

it.each(["写一下今天的日记吧", "帮我写一篇今天的日记", "请整理今天的回忆日记。"])("resolves a natural diary request at send time: %s",text=>{
 expect(diaryDay(text,"","2026-10-24")).toBe("2026-10-24");
});
it("uses the original dated heading for historical replies",()=>{
 expect(diaryDay("写一下今天的日记吧","**2026年10月23日 · 日记**\n今天喝茶。","2026-10-24")).toBe("2026-10-23");
 expect(diaryDay("写一下今天的日记吧","今天喝茶。")).toBeUndefined();
});
it.each(["不要写今天的日记", "今天的日记在哪里", "日记里写了今天喝茶", "写一下今天的日记吧，再生成图片"])("does not classify other requests as diary composition: %s",text=>{
 expect(diaryDay(text,"","2026-10-24")).toBeUndefined();
});
