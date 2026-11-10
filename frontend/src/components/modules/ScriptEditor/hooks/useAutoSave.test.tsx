import { act, renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/store/editorStore';
import { useAutoSave } from './useAutoSave';

const { saveDocument, saveScriptDocument } = vi.hoisted(() => ({ saveDocument: vi.fn(), saveScriptDocument: vi.fn() }));
vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { saveDocument, saveScriptDocument } }));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().reset();
});

it('saves and snapshots an authoring document without a project', async () => {
  const content = { type: 'doc', content: [] };
  const editor = { getJSON: () => content } as unknown as Editor;
  saveScriptDocument.mockResolvedValue({ status: 'ok', snapshot_created: true });
  const { result } = renderHook(() => useAutoSave(editor, null, 'script-a', '原稿'));
  await act(async () => { await result.current.save(true); });
  expect(saveScriptDocument).toHaveBeenCalledWith('script-a', content, '原稿', true);
  expect(saveDocument).not.toHaveBeenCalled();
});

it('keeps edits made during a save marked as unsaved', async () => {
  let content = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '先前内容' }] }] };
  const editor = { getJSON: () => content } as unknown as Editor;
  let finishSave!: (response: object) => void;
  saveScriptDocument.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
  const { result } = renderHook(() => useAutoSave(editor, null, 'script-a', '原稿'));
  let saving!: ReturnType<typeof result.current.save>;
  await act(async () => { saving = result.current.save(); await Promise.resolve(); });
  act(() => {
    content = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: '后续输入' }] }] };
    useEditorStore.getState().setDirty(true);
  });
  await act(async () => { finishSave({ status: 'ok' }); await saving; });
  expect(useEditorStore.getState().isDirty).toBe(true);
});

it('queues a manual snapshot behind an automatic save', async () => {
  const content = { type: 'doc', content: [] };
  const editor = { getJSON: () => content } as unknown as Editor;
  let finishAutoSave!: (response: object) => void;
  saveScriptDocument.mockImplementationOnce(() => new Promise((resolve) => { finishAutoSave = resolve; }));
  saveScriptDocument.mockResolvedValue({ status: 'ok', snapshot_created: true });
  const { result } = renderHook(() => useAutoSave(editor, null, 'script-a', '原稿'));
  let automatic!: ReturnType<typeof result.current.save>;
  let manual!: ReturnType<typeof result.current.save>;
  await act(async () => {
    automatic = result.current.save(false);
    manual = result.current.save(true);
    await Promise.resolve();
  });
  expect(saveScriptDocument).toHaveBeenCalledOnce();
  await act(async () => { finishAutoSave({ status: 'ok' }); await automatic; await manual; });
  expect(saveScriptDocument.mock.calls[1]).toEqual(['script-a', content, '原稿', true]);
});
