import type { PlaygroundMode } from './usePlaygroundStore';
import { selectMentionedReferences } from './referenceMedia';

/**
 * Freeze the mode/media boundary before a request enters the client queue.
 *
 * Text-to-image is a generation request even when an old draft still carries
 * reference paths. Reference media is meaningful for image-to-image only;
 * silently changing the selected mode at submit time can route a user request
 * to the edit endpoint.
 */
export function normalizePlaygroundSubmission(mode: PlaygroundMode, inputMedia: string[], prompt: string, names: Record<string, string> = {}) {
  const selected = selectMentionedReferences(prompt, inputMedia, names, []);
  return {
    mode,
    inputMedia: mode === 't2i' ? [] : selected.inputMedia,
    prompt: mode === 't2i' ? prompt : selected.prompt,
  };
}
