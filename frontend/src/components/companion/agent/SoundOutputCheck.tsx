"use client";

import { useEffect, useRef, useState } from "react";

/** Local output probe: no microphone, provider, speech synthesis or network request. */
export default function SoundOutputCheck({ snapshot, replay, disabled }: {
  snapshot: () => string;
  replay: () => void;
  disabled: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null), url = useRef("");
  const [open, setOpen] = useState(false), [details, setDetails] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  function prepareTone() {
    if (url.current) return url.current;
    const rate = 16000, length = rate, data = new ArrayBuffer(44 + length * 2), view = new DataView(data);
    const word = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    word(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); word(8, "WAVE"); word(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, "data"); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const local = i % (rate / 2), edge = Math.min(1, local / 160, (rate / 2 - local) / 160);
      view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * (i < rate / 2 ? 440 : 660) / rate) * 6500 * edge, true);
    }
    url.current = URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
    return url.current;
  }
  return <div>
    <button type="button" onClick={() => { setOpen(value => !value); setDetails(snapshot()); }}>检查声音</button>
    {open && <section aria-label="声音检查">
      <p>先播放两声测试音，再重播回复，看看哪一步能听到。</p>
      <audio ref={audio} controls aria-label="本地测试音" />
      <button type="button" onClick={() => {
        setError(""); setDetails(snapshot());
        if (audio.current) { audio.current.src = prepareTone(); void audio.current.play().catch(() => setError("测试音未能播放，请查看浏览器的声音权限。")); }
      }}>播放测试音</button>
      <button type="button" disabled={disabled} onClick={() => { setDetails(snapshot()); replay(); }}>重播上一条回复</button>
      <p>{details}</p>
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
