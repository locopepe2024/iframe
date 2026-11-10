import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditorStore } from '@/store/editorStore';
import { Action } from '../extensions/Action';
import { Note } from '../extensions/Note';
import { Keymap } from '../extensions/Keymap';
import NotesPanel from '../panels/NotesPanel';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const editors: Editor[] = [];
function makeEditor() {
  const editor = new Editor({
    extensions: [StarterKit.configure({ paragraph: false, heading: false, bulletList: false, orderedList: false,
      listItem: false, listKeymap: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      Action, Note, Keymap],
    content: { type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: '保留全部正文' }] },
      { type: 'action', content: [{ type: 'text', text: '结尾' }] },
    ] },
  });
  document.body.appendChild(editor.view.dom);
  editors.push(editor);
  return editor;
}
const mod = /Mac|iP(hone|ad|od)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
beforeEach(() => useEditorStore.getState().reset());
afterEach(() => editors.splice(0).forEach(editor => { editor.view.dom.remove(); editor.destroy(); }));

it('inserts an editable note after the selected paragraph without opening help or replacing screenplay text', () => {
  const editor = makeEditor();
  editor.commands.setTextSelection({ from: 2, to: 5 });
  const { result } = renderHook(() => useKeyboardShortcuts(editor));
  act(() => { fireEvent.keyDown(editor.view.dom, { key: '/', code: 'Slash', ...mod }); });
  expect(result.current.showShortcutHelp).toBe(false);
  expect(editor.state.doc.child(0).textContent).toBe('保留全部正文');
  expect(editor.state.doc.child(1).type.name).toBe('note');
  expect(editor.state.doc.child(2).textContent).toBe('结尾');
  expect(editor.state.selection.$from.parent.type.name).toBe('note');
  act(() => { editor.commands.insertContent('修改动机'); });
  expect(editor.state.doc.child(1).textContent).toBe('修改动机');
  act(() => { fireEvent.keyDown(editor.view.dom, { key: 'Enter', code: 'Enter' }); });
  expect(editor.state.selection.$from.parent.type.name).toBe('action');
});

it.each(['?', '/'])('opens help with the shifted slash key (%s) without inserting a note', (key) => {
  const editor = makeEditor();
  const original = editor.getJSON();
  const { result } = renderHook(() => useKeyboardShortcuts(editor));
  act(() => { fireEvent.keyDown(editor.view.dom, { key, code: 'Slash', shiftKey: true, ...mod }); });
  expect(result.current.showShortcutHelp).toBe(true);
  expect(editor.getJSON()).toEqual(original);
});

it('does not insert notes from another input or a read-only editor', () => {
  const editor = makeEditor();
  const original = editor.getJSON();
  const { result } = renderHook(() => useKeyboardShortcuts(editor));
  const { getByLabelText } = render(<input aria-label="dialog input" />);
  act(() => { fireEvent.keyDown(getByLabelText('dialog input'), { key: '/', code: 'Slash', ...mod }); });
  expect(result.current.showShortcutHelp).toBe(false);
  expect(editor.getJSON()).toEqual(original);
  editor.setEditable(false);
  act(() => { fireEvent.keyDown(editor.view.dom, { key: '/', code: 'Slash', ...mod }); });
  expect(editor.getJSON()).toEqual(original);
});

it('updates the notes panel immediately on insertion, typing and undo', async () => {
  const editor = makeEditor();
  const panel = within(render(<NotesPanel editor={editor} />).container);
  expect(screen.getByText('panels.notesEmpty')).toBeInTheDocument();
  act(() => { fireEvent.keyDown(editor.view.dom, { key: '/', code: 'Slash', ...mod }); });
  expect(screen.queryByText('panels.notesEmpty')).not.toBeInTheDocument();
  expect(screen.getByText('panels.emptyNote')).toBeInTheDocument();
  act(() => { editor.commands.insertContent('这段需要重写'); });
  expect(panel.getByText('这段需要重写')).toBeInTheDocument();
  act(() => { editor.commands.undo(); });
  await waitFor(() => expect(panel.queryByText('这段需要重写')).not.toBeInTheDocument());
});
