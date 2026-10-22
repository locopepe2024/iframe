export type DateSuggestion = { value: string; precision: "year" | "month" | "day" };

const chineseDigits: Record<string, string> = {
  "零": "0", "〇": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
  "六": "6", "七": "7", "八": "8", "九": "9",
};

function numericPart(raw: string): number | null {
  if (/^[0-9]+$/.test(raw)) return Number(raw);
  if (raw in chineseDigits) return Number(chineseDigits[raw]);
  const tens = /^([一二三])?十([一二三四五六七八九])?$/.exec(raw);
  return tens ? (tens[1] ? Number(chineseDigits[tens[1]]) : 1) * 10
    + (tens[2] ? Number(chineseDigits[tens[2]]) : 0) : null;
}

function makeSuggestion(yearText: string, monthText?: string, dayText?: string): DateSuggestion | null {
  const year = /^[0-9]{4}$/.test(yearText) ? Number(yearText)
    : Number(yearText.split("").map(char => chineseDigits[char]).join(""));
  const month = monthText ? numericPart(monthText) : null;
  const day = dayText ? numericPart(dayText) : null;
  if (year < 1 || (month !== null && (month < 1 || month > 12))) return null;
  if (day !== null) {
    if (month === null || day < 1) return null;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const lastDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (day > lastDay) return null;
  }
  const value = String(year).padStart(4, "0")
    + (month === null ? "" : "-" + String(month).padStart(2, "0"))
    + (day === null ? "" : "-" + String(day).padStart(2, "0"));
  return { value, precision: day !== null ? "day" : month !== null ? "month" : "year" };
}

// A transcript is only a proposal. Ambiguous or incomplete wording must be edited by the user.
export function parseSpokenPhotoDate(transcript: string): DateSuggestion | null {
  const text = transcript.trim().replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[\s，。！？、,!?]/g, "");
  if (!text || /大概|可能|好像|记不清|不确定|应该|左右|前后|以前|以后|之前|之后|年代|不是|不对|猜|约|估计|差不多|不记得|忘了/.test(text)) return null;

  const typed = /^([0-9]{4}|[零〇一二三四五六七八九]{4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?$/.exec(text);
  if (typed) return makeSuggestion(typed[1], typed[2], typed[3]);

  const spoken = /([0-9]{4}|[零〇一二三四五六七八九]{4})年(?:([0-9]{1,2}|[一二三四五六七八九十]{1,3})月(?:([0-9]{1,2}|[一二三四五六七八九十]{1,3})[日号])?)?/g;
  const matches = Array.from(text.matchAll(spoken));
  if (matches.length !== 1) return null;
  const match = matches[0];
  const remainder = text.slice(0, match.index) + text.slice(match.index! + match[0].length);
  if (/[0-9零〇一二三四五六七八九十年月日号前后-]/.test(remainder)) return null;
  return makeSuggestion(match[1], match[2], match[3]);
}
