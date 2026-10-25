import assert from "node:assert/strict";
import test from "node:test";
import { waitForMediaConnection } from "./rtcConnection";

class Peer extends EventTarget {
  connectionState = "new";
  state(value: string) {
    this.connectionState = value;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
}
const asRtc = (peer: Peer) => peer as unknown as RTCPeerConnection;

test("SDP alone does not complete media connection", async () => {
  const peer = new Peer();
  let connected = false;
  const promise = waitForMediaConnection(asRtc(peer), 1000).then(() => { connected = true; });
  peer.state("connecting");
  await Promise.resolve();
  assert.equal(connected, false);
  peer.state("connected");
  await promise;
  assert.equal(connected, true);
});
test("ICE failure rejects rather than reporting connected", async () => {
  const peer = new Peer();
  const promise = waitForMediaConnection(asRtc(peer));
  peer.state("failed");
  await assert.rejects(promise, /音视频连接失败/);
});
test("unreachable media times out", async () => {
  await assert.rejects(waitForMediaConnection(asRtc(new Peer()), 5), /连接超时/);
});
test("already connected peer resolves", async () => {
  const peer = new Peer();
  peer.state("connected");
  await waitForMediaConnection(asRtc(peer));
});
