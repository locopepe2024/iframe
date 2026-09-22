import type { PlaygroundMode } from './usePlaygroundStore';

/**
 * Freeze the mode/media boundary before a request enters the client queue.
 *
 * Text-to-image is a generation request even when an old draft still carries
 * reference paths. Reference media is meaningful for image-to-image only;
 * silently changing the selected mode at submit time can route a user request
 * to the edit endpoint.
 */
export function normalizePlaygroundSubmission(mode: PlaygroundMode, inputMedia: string[]) {
  return {
    mode,
    inputMedia: mode === 't2i' ? [] : [...inputMedia],
  };
}
