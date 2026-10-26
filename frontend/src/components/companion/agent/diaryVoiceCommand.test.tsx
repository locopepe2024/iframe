import { expect, it } from "vitest";
import { diaryVoiceCommand } from "./diaryVoiceCommand";

it.each(["停止", "请停止记录", "暂停听写一下。", "就先说到这里，停止。", "请帮我暂停记录吧"])("stops only a complete command: %s", text => {
  expect(diaryVoiceCommand(text)).toBe("stop");
});
it.each(["保存", "保存这篇日记。", "请帮我保存日记", "停止并保存", "停止保存", "请保存这篇吧"])("requests save for a complete command: %s", text => {
  expect(diaryVoiceCommand(text)).toBe("save");
});
it.each([
  "我说停止记录的时候才停", "不要保存日记", "先不要停止记录", "如果我说保存日记，就保存",
  "今天学习了怎么保存日记", "她对我说停止", "“保存日记”", "他说：保存日记", "保存日记是什么意思？",
  "今天我们要把语音图片和视频设计开发完成", "今天先写到这里，明天继续", "停止记录这几个字很重要",
  "今天去散步，停止", "帮我保存这张照片", "保存日记并删除照片",
])("keeps negation, quoted speech, conditions and narration as content: %s", text => {
  expect(diaryVoiceCommand(text)).toBe("content");
});
