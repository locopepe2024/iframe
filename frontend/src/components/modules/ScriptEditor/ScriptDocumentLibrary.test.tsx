import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import messages from '../../../../messages/zh.json';
import ScriptDocumentLibrary from './ScriptDocumentLibrary';

const { listScriptDocuments, createScriptDocument } = vi.hoisted(() => ({
  listScriptDocuments: vi.fn(),
  createScriptDocument: vi.fn(),
}));

vi.mock('@/lib/scriptEditorApi', () => ({ scriptEditorApi: { listScriptDocuments, createScriptDocument } }));
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
  fireEvent.click(await screen.findByRole('button', { name: /火影忍者大纲/ }));
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
