import { expect, it } from "vitest";
import { isOpenAlbumCommand } from "./localCommands";

it.each(["把相册打开", "请帮我打开相册。", "嗯，打开我的相册", "看看相册吧"])("recognizes standalone album command: %s", text => {
  expect(isOpenAlbumCommand(text)).toBe(true);
});
it.each(["生成一张打开相册的插画", "把相册打开的老人坐在窗边", "不要打开相册", "打开相册然后生成视频", "相册"])("keeps non-navigation input: %s", text => {
  expect(isOpenAlbumCommand(text)).toBe(false);
});
