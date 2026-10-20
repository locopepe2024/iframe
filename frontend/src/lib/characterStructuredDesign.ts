export const IDENTITY_FIELDS = [
  ['face', '面容补充'], ['face_shape', '脸型'], ['eyebrows', '眉形'], ['eyes', '眼型'],
  ['eye_detail', '眼周细节'], ['nose', '鼻型'], ['lips', '唇形'], ['makeup', '妆容'],
  ['hair', '发型'], ['skin', '肤色肤质补充'], ['skin_tone', '肤色'], ['skin_texture', '肤质'],
  ['height', '身高'], ['build', '体态与比例'], ['recognition_marks', '识别锚点'],
] as const;
export const LOOK_FIELDS = [
  ['clothing', '服装结构与材质'], ['palette', '主色与配色'],
  ['footwear', '鞋履'], ['jewelry', '首饰'], ['decoration', '装饰'],
  ['condition', '新旧状态'], ['accessories', '其他配件'], ['weapon', '武器外观'],
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

export type CharacterSectionEditorMode = 'fields' | 'notes';

export function characterSectionText<T extends string>(features: Partial<Record<T, string>>, keys: readonly T[], legacyNotes: unknown, mode?: CharacterSectionEditorMode): string {
  const values = keys.flatMap((key) => features[key]?.trim() ? [features[key]!.trim()] : []);
  if (mode === 'notes') return typeof legacyNotes === 'string' ? legacyNotes.trim() : '';
  return values.length ? values.join('；') : typeof legacyNotes === 'string' ? legacyNotes.trim() : '';
}

/** A review cue, not a semantic equivalence check. */
export function requirementNeedsReview(requirement: string, projectedSection: string): boolean {
  const normalize = (value: string) => value.replace(/[\s，。；;、,.!！?？]/g, '').toLocaleLowerCase();
  const expected = normalize(requirement.trim());
  return Boolean(expected && !normalize(projectedSection).includes(expected));
}

/** Render authored fields in a stable labelled order; never reverse-parse prose. */
export function characterStructuredText(identity: IdentityFeatures, look: LookFeatures): string {
  return [...IDENTITY_FIELDS, ...LOOK_FIELDS].flatMap(([key, label]) => {
    const value = (identity as Record<string, string>)[key] ?? (look as Record<string, string>)[key];
    return value?.trim() ? [`${label}：${value.trim()}`] : [];
  }).join('\n');
}
