import { API_URL, authenticatedFetch } from '@/lib/api';

/** Fetch the owned original using authentication, not an expiring preview URL. */
export async function downloadOutput(generationId: string, outputId: string, kind: string) {
  const response = await authenticatedFetch(`${API_URL}/playground/media/${encodeURIComponent(generationId)}/${encodeURIComponent(outputId)}`);
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请重新登录或稍后重试`);
  const blob = await response.blob();
  if (!blob.size || /(?:json|html)/i.test(blob.type)) throw new Error('未获取到媒体文件，请稍后重试');
  const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' } as Record<string, string>)[blob.type] || (kind === 'video' ? 'mp4' : 'png');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${generationId}-${outputId}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
