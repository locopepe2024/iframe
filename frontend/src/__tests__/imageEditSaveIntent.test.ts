import { expect, it, vi } from 'vitest';
import { imageEditSaveIntent } from '../lib/imageEditSaveIntent';

it('saves and retries without subtle or randomUUID on HTTP', () => {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.forEach((_, i) => { bytes[i] = i; }); return bytes; } });
  try {
    const original = imageEditSaveIntent(undefined, new Uint8Array([1, 2]), 'source.png:perspective');
    expect(original.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(imageEditSaveIntent(original, new Uint8Array([1, 2]), 'source.png:perspective')).toBe(original);
    expect(imageEditSaveIntent(original, new Uint8Array([1, 3]), 'source.png:perspective')).not.toBe(original);
    expect(imageEditSaveIntent(original, new Uint8Array([1, 2]), 'other.png:perspective')).not.toBe(original);
  } finally { vi.unstubAllGlobals(); }
});
