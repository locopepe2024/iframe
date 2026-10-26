"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { companionApi } from "@/lib/companionApi";
import styles from "./chat.module.css";

const openTalkingUrl = process.env.NEXT_PUBLIC_OPENTALKING_URL || "/opentalking-mock/";
const handshakeEnabled = process.env.NEXT_PUBLIC_OPENTALKING_CONTEXT_HANDSHAKE === "1";

export default function OpenTalkingPanel({ onClose }: { onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [context, setContext] = useState<{ sessionId: string; token: string } | null>(null);
  const [status, setStatus] = useState(handshakeEnabled ? "正在准备语音会话…" : "");
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!handshakeEnabled) return;
    const sessionId = `sess_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let alive = true;
    void companionApi.opentalkingBind(sessionId).then(result => {
      if (alive) { setContext({ sessionId, token: result.context_token }); setStatus(""); }
    }).catch(() => { if (alive) setStatus("语音会话未连接，可先使用文字聊天。"); });
    return () => { alive = false; };
  }, []);
  function sendContext() {
    if (!context || !frame.current?.contentWindow) return;
    const target = new URL(openTalkingUrl, window.location.href).origin;
    frame.current.contentWindow.postMessage({ type: "iframe-companion-context", session_id: context.sessionId,
      context_token: context.token, gateway_url: `${window.location.origin}/companion-agent-api/companion-runtime/opentalking` }, target);
  }
  async function close() {
    if (closing) return;
    setClosing(true);
    if (context) await companionApi.opentalkingRelease(context.token).catch(() => undefined);
    onClose();
  }
  return <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) void close();
  }}>
    <section className={styles.openTalkingSheet} role="dialog" aria-modal="true" aria-labelledby="opentalking-title">
      <header className={styles.openTalkingHeader}>
        <div>
          <h2 id="opentalking-title">语音聊天</h2>
          <p>可以说话，也可以随时停下来。</p>
        </div>
        <button type="button" className={styles.albumIcon} aria-label="关闭语音聊天" disabled={closing} onClick={() => void close()}>
          <X size={24} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.openTalkingFrame}>
        <iframe ref={frame} onLoad={sendContext} title="OpenTalking 角色语音聊天" src={openTalkingUrl}
          allow="microphone; autoplay; camera" referrerPolicy="no-referrer" />
      </div>
      <p className={styles.voiceStatus}>{status || "返回后仍可继续文字聊天、查看相册和日记。"}</p>
    </section>
  </div>;
}
