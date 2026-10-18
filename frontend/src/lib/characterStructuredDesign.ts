export const IDENTITY_FIELDS = [
  ['face', '脸型与眉眼'], ['hair', '发型'], ['skin', '肤色与肤质'],
  ['build', '体态与比例'], ['recognition_marks', '识别锚点'],
] as const;
export const LOOK_FIELDS = [
  ['clothing', '服装结构与材质'], ['palette', '主色与配色'],
  ['accessories', '配件'], ['weapon', '武器外观'],
] as const;

export type IdentityFeature = typeof IDENTITY_FIELDS[number][0];
export type LookFeature = typeof LOOK_FIELDS[number][0];
export type IdentityFeatures = Partial<Record<IdentityFeature, string>>;
export type LookFeatures = Partial<Record<LookFeature, string>>;

export function normalizeCharacterFeatures<T extends string>(value: unknown, keys: readonly T[]): Partial<Record<T, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(keys.flatMap((key) =>
    typeof record[key] === 'string' && record[key].trim() ? [[key, record[key].trim()]] : [],
  )) as Partial<Record<T, string>>;
}

export function characterSectionText<T extends string>(features: Partial<Record<T, string>>, keys: readonly T[], legacyNotes: unknown): string {
  const values = keys.flatMap((key) => features[key]?.trim() ? [features[key]!.trim()] : []);
  return values.length ? values.join('；') : typeof legacyNotes === 'string' ? legacyNotes.trim() : '';
}
