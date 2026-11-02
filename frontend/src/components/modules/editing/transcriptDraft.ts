export interface TranscriptCue { text: string; start_ms: number; end_ms: number }

export function transcriptDraft(text: string, startMs: number, endMs: number): TranscriptCue[] {
  const sentences = (text.trim().match(/[^。！？.!?]+[。！？.!?]?/g) || [])
    .flatMap(sentence => {
      const chars = Array.from(sentence.trim());
      const parts: string[] = [];
      for (let i = 0; i < chars.length; i += 60) parts.push(chars.slice(i, i + 60).join(''));
      return parts;
    })
    .map(sentence => sentence.trim()).filter(Boolean);
  if (!sentences.length || sentences.length > 256 || endMs - startMs < sentences.length) return [];
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  let elapsed = 0;
  return sentences.map((sentence, index) => {
    const start = startMs + Math.round(elapsed / total * (endMs - startMs));
    elapsed += sentence.length;
    return { text: sentence, start_ms: start, end_ms: index === sentences.length - 1 ? endMs : startMs + Math.round(elapsed / total * (endMs - startMs)) };
  });
}
