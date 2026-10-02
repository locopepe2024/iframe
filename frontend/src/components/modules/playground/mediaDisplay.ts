/** Normalize generation ratio values into a CSS aspect-ratio value. */
export function getOutputAspectRatio(
  parameters: Record<string, unknown> | undefined,
  fallback = '16 / 9',
): string {
  // `aspect_ratio` is the canonical API field. Keep the two historical spellings
  // readable at the display boundary so old persisted generations do not silently
  // render as the 16:9 fallback after a reload.
  const raw = parameters?.aspect_ratio ?? parameters?.ratio ?? parameters?.aspectRatio;
  if (typeof raw !== 'string') return fallback;
  const match = raw.trim().match(/^(\d+)\s*[:/]\s*(\d+)$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height || width > 100 || height > 100) return fallback;
  return `${width} / ${height}`;
}
