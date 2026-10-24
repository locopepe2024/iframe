// Only standalone navigation commands execute locally; scene descriptions stay prompts.
export function isOpenAlbumCommand(text: string): boolean {
  const compact = text.replace(/[\s，。！？、,.!?：:]/g, "").replace(/^(?:嗯|呃|额)+/, "");
  return /^(?:请|请你|麻烦|麻烦你)?(?:帮我|给我|我想|我要)?(?:把(?:我的)?相册打开|打开(?:我的)?相册|进入相册|看看相册)(?:一下|吧|好吗)?$/.test(compact);
}
