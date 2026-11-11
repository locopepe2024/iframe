import { act, renderHook, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useProductionHandoff } from './useProductionHandoff';

const { createProject, getScriptDocumentProject, error } = vi.hoisted(() => ({
  createProject: vi.fn(), getScriptDocumentProject: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: { createProject, getScriptDocumentProject } }));
vi.mock('@/store/toastStore', () => ({ toast: { error } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

beforeEach(() => {
  vi.resetAllMocks();
  getScriptDocumentProject.mockResolvedValue({ project_id: null });
  createProject.mockResolvedValue({ id: 'production-1' });
  window.location.hash = '#/studio/editor/episode-1';
});

function setup(overrides: Partial<Parameters<typeof useProductionHandoff>[0]> = {}) {
  const editor = { getText: () => '第一集正文', isDestroyed: false } as unknown as Editor;
  const save = vi.fn().mockResolvedValue({ status: 'ok' });
  const options = { editor, scriptDocumentId: 'episode-1', title: '第一集', canEnter: true, save, ...overrides };
  return { ...renderHook(() => useProductionHandoff(options)), save };
}

it('waits for save before creating and opening the selected episode project', async () => {
  createProject.mockResolvedValue({ id: 'production-1', series_id: 'series-1' });
  let finish!: (value: object) => void;
  const save = vi.fn(() => new Promise<object>(resolve => { finish = resolve; }));
  const { result } = setup({ save });
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.enterProduction(); });
  expect(result.current.isEntering).toBe(true);
  expect(createProject).not.toHaveBeenCalled();
  await act(async () => { finish({ status: 'ok' }); await pending; });
  expect(createProject).toHaveBeenCalledExactlyOnceWith('第一集', '第一集正文', true, 'r2v', undefined, 'episode-1');
  expect(window.location.hash).toBe('#/series/series-1/episode/production-1');
});

it('finds and opens the existing episode after a refresh, even with an empty authoring body', async () => {
  getScriptDocumentProject.mockResolvedValue({ project_id: 'existing' });
  createProject.mockResolvedValue({ id: 'existing', series_id: 'repaired-series' });
  const { result, save } = setup({ editor: { getText: () => '' } as unknown as Editor });
  await waitFor(() => expect(result.current.targetProjectId).toBe('existing'));
  await act(async () => { await result.current.enterProduction(); });
  expect(save).toHaveBeenCalledOnce();
  expect(createProject).toHaveBeenCalledExactlyOnceWith('第一集', '', true, 'r2v', undefined, 'episode-1');
  expect(window.location.hash).toBe('#/series/repaired-series/episode/existing');
});

it('returns from a production editor to the same project without creating another', async () => {
  const { result } = setup({ scriptDocumentId: undefined, projectId: 'existing' });
  await act(async () => { await result.current.enterProduction(); });
  expect(getScriptDocumentProject).not.toHaveBeenCalled();
  expect(createProject).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#/project/existing');
});

it('keeps the editor open on save failure and allows retry', async () => {
  const save = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ status: 'ok' });
  const { result } = setup({ save });
  await act(async () => { await result.current.enterProduction(); });
  expect(createProject).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalled();
  expect(window.location.hash).toBe('#/studio/editor/episode-1');
  await act(async () => { await result.current.enterProduction(); });
  expect(createProject).toHaveBeenCalledOnce();
});

it('does not create a duplicate when association lookup fails', async () => {
  getScriptDocumentProject.mockRejectedValue(new Error('network unavailable'));
  const { result } = setup();
  await act(async () => { await result.current.enterProduction(); });
  expect(createProject).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalled();
  expect(result.current.isEntering).toBe(false);
  expect(window.location.hash).toBe('#/studio/editor/episode-1');
});

it('prevents duplicate clicks within the same cycle', async () => {
  const { result, save } = setup();
  await act(async () => { await Promise.all([result.current.enterProduction(), result.current.enterProduction()]); });
  expect(save).toHaveBeenCalledOnce();
  expect(createProject).toHaveBeenCalledOnce();
});

it('does not create for blank or unavailable documents', async () => {
  const { result, save } = setup({ editor: { getText: () => ' \n ' } as unknown as Editor });
  await act(async () => { await result.current.enterProduction(); });
  expect(save).not.toHaveBeenCalled();
  const unavailable = setup({ canEnter: false });
  await act(async () => { await unavailable.result.current.enterProduction(); });
  expect(unavailable.save).not.toHaveBeenCalled();
  expect(createProject).not.toHaveBeenCalled();
});

it('ignores late association responses when switching episodes', async () => {
  createProject.mockResolvedValue({ id: 'production-2' });
  let finishFirst!: (value: { project_id: string }) => void;
  getScriptDocumentProject.mockImplementation((id: string) => id === 'episode-1'
    ? new Promise(resolve => { finishFirst = resolve; })
    : Promise.resolve({ project_id: 'production-2' }));
  const save = vi.fn().mockResolvedValue({ status: 'ok' });
  const { result, rerender } = renderHook(({ documentId }) => useProductionHandoff({
    editor: { getText: () => '正文' } as unknown as Editor,
    scriptDocumentId: documentId, title: documentId, canEnter: true, save,
  }), { initialProps: { documentId: 'episode-1' } });
  rerender({ documentId: 'episode-2' });
  await waitFor(() => expect(result.current.targetProjectId).toBe('production-2'));
  await act(async () => { finishFirst({ project_id: 'production-1' }); });
  expect(result.current.targetProjectId).toBe('production-2');
  await act(async () => { await result.current.enterProduction(); });
  expect(window.location.hash).toBe('#/project/production-2');
  expect(createProject).toHaveBeenCalledExactlyOnceWith('episode-2', '正文', true, 'r2v', undefined, 'episode-2');
});

it('keeps the editor open when repairing an existing project association fails', async () => {
  getScriptDocumentProject.mockResolvedValue({ project_id: 'existing' });
  createProject.mockRejectedValue(new Error('Series association conflict'));
  const { result, save } = setup();
  await act(async () => { await result.current.enterProduction(); });
  expect(save).toHaveBeenCalledOnce();
  expect(createProject).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalled();
  expect(window.location.hash).toBe('#/studio/editor/episode-1');
});
