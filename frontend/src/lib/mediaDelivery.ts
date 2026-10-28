import { API_URL, authenticatedFetch } from './api';
import { getAssetUrl } from './utils';

function managedPath(reference: string): string {
  try {
    const parsed = new URL(reference, 'http://localhost');
    if (/^https?:\/\//i.test(reference)) {
      if (!/^https?:\/\//i.test(API_URL) || parsed.origin !== new URL(API_URL).origin) return '';
    }
    const path = parsed.pathname;
    const index = path.indexOf('/playground/media/') >= 0
      ? path.indexOf('/playground/media/') : path.indexOf('/studio/media/');
    return index >= 0 ? path.slice(index) : '';
  } catch {
    return '';
  }
}

export function isManagedMedia(reference: string): boolean {
  const path = managedPath(reference);
  return path.startsWith('/studio/media/') || path.startsWith('/playground/media/');
}

// Signed display URLs rotate while the underlying owned media stays the same.
export function mediaReferenceIdentity(reference: string): string {
  return managedPath(reference) || reference;
}

export async function resolveMediaDelivery(reference: string, preview = 0): Promise<string> {
  const path = managedPath(reference);
  let endpoint: string;
  if (path.startsWith('/playground/media/')) {
    const parts = path.slice('/playground/media/'.length).split('/');
    if (parts.length !== 2 || !parts.every(Boolean)) throw new Error('Invalid media reference');
    endpoint = `${API_URL}/playground/history/${encodeURIComponent(parts[0])}/outputs/${encodeURIComponent(parts[1])}/media-url?thumbnail=${preview ? 1 : 0}`;
  } else if (path.startsWith('/studio/media/')) {
    endpoint = `${API_URL}/studio/media-delivery?${new URLSearchParams({ reference, preview: String(preview) })}`;
  } else {
    return getAssetUrl(reference);
  }
  const response = await authenticatedFetch(endpoint, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Media unavailable (HTTP ${response.status})`);
  const value = await response.json() as { url: string };
  return getAssetUrl(value.url);
}

export async function resolveAssetVariantDelivery(locator: {
  scope: 'global' | 'series' | 'project';
  containerId: string;
  assetType: 'character' | 'scene' | 'prop';
  assetId: string;
  variantId: string;
}): Promise<string> {
  const params = new URLSearchParams({
    scope: locator.scope, container_id: locator.containerId,
    asset_type: locator.assetType, asset_id: locator.assetId, variant_id: locator.variantId,
  });
  const response = await authenticatedFetch(`${API_URL}/asset-index/delivery?${params}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Asset unavailable (HTTP ${response.status})`);
  const value = await response.json() as { url: string };
  return getAssetUrl(value.url);
}

export async function resolveRegisteredMediaDelivery(mediaId: string, preview = 0): Promise<string> {
  const response = await authenticatedFetch(
    `${API_URL}/studio/media-records/${encodeURIComponent(mediaId)}/delivery${preview ? `?preview=${preview}` : ''}`, { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Media unavailable (HTTP ${response.status})`);
  const value = await response.json() as { url: string };
  return getAssetUrl(value.url);
}

export async function resolveVideoTaskDelivery(projectId: string, taskId: string, preview = 0): Promise<string> {
  const response = await authenticatedFetch(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/video_tasks/${encodeURIComponent(taskId)}/delivery${preview ? `?preview=${preview}` : ''}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Video unavailable (HTTP ${response.status})`);
  const value = await response.json() as { url: string };
  return getAssetUrl(value.url);
}

export async function resolveMergedVideoDelivery(projectId: string, preview = 0): Promise<string> {
  const response = await authenticatedFetch(
    `${API_URL}/projects/${encodeURIComponent(projectId)}/merged-video/delivery${preview ? `?preview=${preview}` : ''}`, { cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Video unavailable (HTTP ${response.status})`);
  const value = await response.json() as { url: string };
  return getAssetUrl(value.url);
}

export function resolveVideoDelivery(source: string, mediaId?: string | null, projectId?: string, taskId?: string, mergedProjectId?: string): Promise<string> {
  if (mergedProjectId) return resolveMergedVideoDelivery(mergedProjectId);
  if (mediaId) return resolveRegisteredMediaDelivery(mediaId);
  if (projectId && taskId) return resolveVideoTaskDelivery(projectId, taskId);
  return resolveMediaDelivery(source);
}
