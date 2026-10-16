import { beforeEach, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({ API_URL: '/api-proxy', authenticatedFetch: fetchMock }));
vi.mock('@/lib/utils', () => ({ getAssetUrl: (path: string) => `/api-proxy${path}` }));

import { isManagedMedia, resolveMediaDelivery, resolveMergedVideoDelivery, resolveRegisteredMediaDelivery, resolveVideoDelivery, resolveVideoTaskDelivery } from '@/lib/mediaDelivery';

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: '/playground/media/g/o?expires=999&signature=fresh' }) });
});

it('recognizes managed media behind the development proxy', () => {
  expect(isManagedMedia('/api-proxy/playground/media/g/o?expires=1&signature=old')).toBe(true);
  expect(isManagedMedia('/studio/media/owner/image.png?expires=1&signature=old')).toBe(true);
  expect(isManagedMedia('https://external.example/image.png')).toBe(false);
});

it('resolves an expired Playground cover from generation and output IDs', async () => {
  const url = await resolveMediaDelivery('/api-proxy/playground/media/g/o?expires=1&signature=old', 320);
  expect(fetchMock).toHaveBeenCalledWith('/api-proxy/playground/history/g/outputs/o/media-url?thumbnail=1', { cache: 'no-store' });
  expect(url).toContain('signature=fresh');
});

it('passes an expired Studio reference to the authenticated refresh endpoint', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ url: '/studio/media/owner/image.png?preview=320&expires=999&signature=fresh' }) });
  await resolveMediaDelivery('/studio/media/owner/image.png?expires=1&signature=old', 320);
  const request = fetchMock.mock.calls[0][0] as string;
  expect(request).toContain('/studio/media-delivery?');
  expect(new URL(request, 'http://localhost').searchParams.get('preview')).toBe('320');
});

it('uses stable shot and assembly identities for video playback', async () => {
  await resolveVideoDelivery('https://old.example/take.mp4', null, 'project', 'task');
  expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/projects/project/video_tasks/task/delivery');
  await resolveVideoDelivery('https://old.example/final.mp4', null, undefined, undefined, 'project');
  expect(fetchMock.mock.calls[1][0]).toBe('/api-proxy/projects/project/merged-video/delivery');
});

it('requests WebP posters for shot and assembly identities', async () => {
  await resolveVideoTaskDelivery('project', 'task', 320);
  expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/projects/project/video_tasks/task/delivery?preview=320');
  await resolveMergedVideoDelivery('project', 320);
  expect(fetchMock.mock.calls[1][0]).toBe('/api-proxy/projects/project/merged-video/delivery?preview=320');
});

it('resolves media registry source and WebP cover by ID without reusing a signed URL', async () => {
  await resolveRegisteredMediaDelivery('owner-media', 320);
  expect(fetchMock.mock.calls[0][0]).toBe('/api-proxy/studio/media-records/owner-media/delivery?preview=320');
  await resolveRegisteredMediaDelivery('owner-media');
  expect(fetchMock.mock.calls[1][0]).toBe('/api-proxy/studio/media-records/owner-media/delivery');
});
