/** Return the next stable Character name for one fixed-crowd label. */
export function nextCrowdCharacterName(label: string, existingNames: string[]): string {
  const requested = label.trim() || "固定群演";
  const suffix = requested.match(/^(.*?)(-?)(\d+)$/);
  const base = (suffix?.[1] || requested).trim() || "固定群演";
  const separator = suffix?.[2] || "-";
  if (!existingNames.some((name) => name.trim() === requested)) return requested;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(-?)(\\d+)$`);
  let max = 0;
  for (const name of existingNames) {
    const match = name.trim().match(pattern);
    if (match) max = Math.max(max, Number(match[2]));
  }
  return `${base}${separator}${max + 1}`;
}
