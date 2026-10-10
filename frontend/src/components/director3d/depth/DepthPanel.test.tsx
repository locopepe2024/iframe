import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DepthPanel } from './DepthPanel';
import { directorDepthApi } from '@/lib/directorDepth';
import { captureDepthSnapshot } from '../state/depth-snapshot';
vi.mock('@/lib/directorDepth', () => ({ directorDepthApi: { capability: vi.fn(), list: vi.fn(), submit: vi.fn(), get: vi.fn(), blob: vi.fn() } }));
vi.mock('../state/depth-snapshot', () => ({ captureDepthSnapshot: vi.fn() }));
const task = { id: 'a', status: 'completed' as const, frame: 12, cameraLabel: '镜头 A', nearM: .5, farM: 20, error: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(directorDepthApi.capability).mockResolvedValue({available: true, message: ''});
  vi.mocked(directorDepthApi.list).mockResolvedValue([]);
  vi.mocked(directorDepthApi.blob).mockResolvedValue(new Blob(['png']));
  vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn()}));
});
it('submits captured current frame and previews completed result', async () => {
  vi.mocked(directorDepthApi.submit).mockResolvedValue(task);
  render(<DepthPanel />);
  await waitFor(() => expect(screen.getByRole('button', {name:'提交当前帧深度'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button', {name:'提交当前帧深度'}));
  await screen.findByRole('img', {name:'第 12 帧场景深度，近处黑，远处白'});
  expect(captureDepthSnapshot).toHaveBeenCalledWith(.5, 20);
  expect(screen.getByRole('button', {name:'下载米制 EXR'})).toBeEnabled();
});
it('shows runtime unavailable and does not submit', async () => {
  vi.mocked(directorDepthApi.capability).mockResolvedValue({available:false, message:'missing runtime'});
  render(<DepthPanel />);
  await screen.findByText('深度渲染服务暂不可用，请联系管理员。');
  expect(screen.getByRole('button', {name:'提交当前帧深度'})).toBeDisabled();
});
it('recovers a running task and stops polling after completion', async () => {
  vi.mocked(directorDepthApi.list).mockResolvedValue([{...task, status:'running'}]);
  vi.mocked(directorDepthApi.get).mockResolvedValue(task);
  render(<DepthPanel />);
  await screen.findByRole('img', {}, {timeout: 3000});
  expect(directorDepthApi.get).toHaveBeenCalledWith('a');
});
it('keeps failure visible and allows retry', async () => {
  vi.mocked(directorDepthApi.list).mockResolvedValue([{...task, status:'failed', error:'渲染失败'}]);
  render(<DepthPanel />);
  await screen.findByText('渲染失败');
  expect(screen.getByRole('button', {name:'提交当前帧深度'})).toBeEnabled();
});
