"""Apply the bounded upstream WebUI overlay; argv[1] is upstream repo root."""
from pathlib import Path
import shutil
import sys

tools = Path(__file__).parent
root = Path(sys.argv[1])
lib = root / 'apps/web/src/lib'
shutil.copy2(tools / 'rtcConnection.ts', lib / 'rtcConnection.ts')
web = lib / 'webrtc.ts'
text = web.read_text()
if 'await waitForMediaConnection(pc)' not in text:
    text = 'import { waitForMediaConnection } from "./rtcConnection";\n' + text
    before = '  await pc.setRemoteDescription(new RTCSessionDescription(answer));\n  ensurePlayback();'
    after = '''  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  try {
    await waitForMediaConnection(pc);
  } catch (error) {
    pc.close();
    cleanup();
    throw error;
  }
  ensurePlayback();'''
    assert before in text
    web.write_text(text.replace(before, after, 1))
app = root / 'apps/web/src/App.tsx'
text = app.read_text()
before = '''      const msg = detail
        ? `启动会话失败：${detail}`
        : "启动会话失败，请稍后重试或查看后端日志。";'''
after = '''      const msg = detail
        ? `启动会话失败：${detail}`
        : error instanceof Error ? error.message
        : "启动会话失败，请稍后重试或查看后端日志。";'''
if before in text:
    app.write_text(text.replace(before, after, 1))
else:
    assert after in text
text = app.read_text()
if 'watchMediaFailure(playback.pc' not in text:
    text = 'import { watchMediaFailure } from "./lib/rtcConnection";\n' + text
    text = text.replace('  const pcRef = useRef<RTCPeerConnection | null>(null);',
        '  const pcRef = useRef<RTCPeerConnection | null>(null);\n'
        '  const disposeMediaWatchRef = useRef<(() => void) | null>(null);', 1)
    needle = '  const closePeerConnection = useCallback(() => {'
    assert needle in text
    text = text.replace(needle, needle + '\n    disposeMediaWatchRef.current?.();\n'
        '    disposeMediaWatchRef.current = null;', 1)
    needle = '      pcRef.current = playback.pc;'
    assert needle in text
    text = text.replace(needle, needle + '''
      disposeMediaWatchRef.current = watchMediaFailure(playback.pc, () => {
        if (pcRef.current !== playback.pc) return;
        resetLiveState();
        setConnection("error");
        notify("音视频连接已断开，已停止本次会话。请重新开始。", "error");
        void releaseSession(created.session_id);
      });''', 1)
    app.write_text(text)
print('WebUI media connection readiness overlay applied')
