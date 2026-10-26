export type DiaryVoiceCommand = "stop" | "save" | "content";

/** A bounded command vocabulary, only for the active diary dictation workspace. */
export function diaryVoiceCommand(text: string): DiaryVoiceCommand {
  const command = text.trim().replace(/[\s，。！？、,.!?]/g, "");
  const polite = "(?:请|请你|帮我|请帮我)?";
  if (new RegExp(`^${polite}(?:保存(?:这篇日记|这篇|日记)?|停止(?:并)?保存(?:日记)?)(?:吧|一下)?$`).test(command)) return "save";
  if (new RegExp(`^${polite}(?:停止(?:记录|听写)?|暂停(?:记录|听写)?)(?:吧|一下)?$`).test(command)) return "stop";
  if (/^(?:就)?先?说到这里(?:停止|停止记录|暂停|暂停记录)$/.test(command)) return "stop";
  return "content";
}
