import { API_URL, authenticatedFetch } from "./api";

export interface CompanionVideo { video_id: string; name: string; duration?: number }
const base = `${API_URL}/photo-demo-api/videos`;
async function checked(response: Response) {
  if (!response.ok) throw new Error(response.status === 413 ? "视频不能超过 25 MB。"
    : response.status === 422 ? "请选择有效的 MP4、MOV 或 WebM 视频，时长不超过 5 分钟。"
    : response.status === 409 ? "该次上传的文件已改变，请重新选择文件。"
    : "视频暂不可用，请稍后重试。");
  return response;
}
export const companionMediaApi = {
  upload: async (operation: string, file: File) => (await checked(await authenticatedFetch(`${base}/uploads/${encodeURIComponent(operation)}?${new URLSearchParams({ name: file.name })}`, {method:"POST",body:file,credentials:"include",cache:"no-store"}))).json() as Promise<CompanionVideo>,
  list: async (query = "", after = "") => (await checked(await authenticatedFetch(`${base}?${new URLSearchParams({query,after_id:after})}`, {credentials:"include",cache:"no-store"}))).json() as Promise<{videos: CompanionVideo[];next_after_id:string|null}>,
  media: async (id: string, original = false) => (await checked(await authenticatedFetch(`${base}/${encodeURIComponent(id)}/${original ? "original" : "thumbnail"}`, {credentials:"include",cache:"no-store"}))).blob(),
};
