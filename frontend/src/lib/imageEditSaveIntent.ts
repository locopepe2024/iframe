import { createRenderRequestId } from './renderRequestId';

export interface ImageEditSaveIntent { context: string; bytes: Uint8Array; key: string }

// Compare exported bytes for retry identity. SHA-256 integrity remains enforced
// by the server; browser save must also work on HTTP without Web Crypto subtle.
export function imageEditSaveIntent(previous: ImageEditSaveIntent | undefined, bytes: Uint8Array, context: string): ImageEditSaveIntent {
  if (previous?.context === context && previous.bytes.length === bytes.length && previous.bytes.every((value, index) => value === bytes[index])) return previous;
  return { context, bytes, key: createRenderRequestId() };
}
