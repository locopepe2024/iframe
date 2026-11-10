import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import messages from '../../../../messages/zh.json';
import ScriptDocumentLibrary from './ScriptDocumentLibrary';

const { listScriptDocuments, createScriptDocument, deleteScriptDocument } = vi.hoisted(() => ({
  listScriptDocuments: vi.fn(),
  createScriptDocument: vi.fn(),
  deleteScriptDocument: vi.fn(),
}));

vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { listScriptDocuments, createScriptDocument, deleteScriptDocument } }));
vi.mock('@/components/series/ImportFileDialog', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '#/studio/editor';
});

function show() {
  return render(<NextIntlClientProvider locale="zh" messages={messages}><ScriptDocumentLibrary /></NextIntlClientProvider>);
}

it('opens an existing authoring document directly from the script library', async () => {
  listScriptDocuments.mockResolvedValue([{ id: 'script-a', title: '火影忍者大纲', updated_at: '2026-11-08T10:00:00Z' }]);
  show();
  fireEvent.click(await screen.findByRole('button', { name: /^火影忍者大纲/ }));
  expect(window.location.hash).toBe('#/studio/editor/script-a');
});

it('creates an independent document and prevents duplicate submission while creating', async () => {
  listScriptDocuments.mockResolvedValue([]);
  let resolveCreation!: (document: { id: string }) => void;
  createScriptDocument.mockImplementation(() => new Promise((resolve) => { resolveCreation = resolve; }));
  show();
  fireEvent.click(screen.getByRole('button', { name: '新建剧本' }));
  expect(screen.getByRole('button', { name: '正在创建…' })).toBeDisabled();
  resolveCreation({ id: 'new-script' });
  await waitFor(() => expect(window.location.hash).toBe('#/studio/editor/new-script'));
  expect(createScriptDocument).toHaveBeenCalledOnce();
});


it('opens the actions menu without navigating and cancels deletion safely', async () => {
  listScriptDocuments.mockResolvedValue([{ id: 'script-a', title: '剧本甲', updated_at: '2026-11-08T10:00:00Z' }]);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  show();
  fireEvent.click(await screen.findByRole('button', { name: '“剧本甲”的更多操作' }));
  expect(window.location.hash).toBe('#/studio/editor');
  expect(screen.getByRole('menuitem', { name: '打开' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '删除' })).toHaveFocus();
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('全部分集正文和快照'));
  expect(deleteScriptDocument).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^剧本甲/ })).toBeInTheDocument();
  confirm.mockRestore();
});

it('removes a script only after confirmed successful deletion and prevents duplicate requests', async () => {
  listScriptDocuments.mockResolvedValue([{ id: 'script-a', title: '剧本甲', updated_at: '2026-11-08T10:00:00Z' }]);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  let finish!: () => void;
  deleteScriptDocument.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '“剧本甲”的更多操作' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(screen.getByRole('button', { name: '正在删除“剧本甲”…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^剧本甲/ })).toBeInTheDocument();
  finish();
  await waitFor(() => expect(screen.queryByRole('button', { name: /^剧本甲/ })).not.toBeInTheDocument());
  expect(deleteScriptDocument).toHaveBeenCalledExactlyOnceWith('script-a');
  expect(window.location.hash).toBe('#/studio/editor');
  confirm.mockRestore();
});

it('keeps the script listed when deletion fails and supports Escape dismissal', async () => {
  listScriptDocuments.mockResolvedValue([{ id: 'script-a', title: '剧本甲', updated_at: '2026-11-08T10:00:00Z' }]);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  deleteScriptDocument.mockRejectedValue(new Error('Network unavailable'));
  show();
  const trigger = await screen.findByRole('button', { name: '“剧本甲”的更多操作' });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('删除剧本失败，请重试。');
  expect(screen.getByRole('button', { name: /^剧本甲/ })).toBeInTheDocument();
  expect(trigger).toBeEnabled();
  confirm.mockRestore();
});
