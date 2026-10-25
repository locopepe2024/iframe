/** SDP exchange is not proof that the media transport connected. */
export function waitForMediaConnection(pc: RTCPeerConnection, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      pc.removeEventListener("connectionstatechange", check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (pc.connectionState === "connected") done();
      else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        done(new Error("角色音视频连接失败。文字服务正常不代表画面已连接，请检查媒体网络或 TURN 中继。"));
      }
    };
    const timer = setTimeout(() => done(new Error(
      "角色音视频连接超时，尚未连接成功。请检查媒体网络或 TURN 中继。")), timeoutMs);
    pc.addEventListener("connectionstatechange", check);
    check();
  });
}

export function watchMediaFailure(pc: RTCPeerConnection, onFailure: () => void,
  disconnectedTimeoutMs = 8000): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = () => {
    if (disposed) return;
    dispose();
    onFailure();
  };
  const check = () => {
    clearTimeout(timer);
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail();
    else if (pc.connectionState === 'disconnected') timer = setTimeout(fail, disconnectedTimeoutMs);
  };
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    pc.removeEventListener('connectionstatechange', check);
  };
  pc.addEventListener('connectionstatechange', check);
  check();
  return dispose;
}
