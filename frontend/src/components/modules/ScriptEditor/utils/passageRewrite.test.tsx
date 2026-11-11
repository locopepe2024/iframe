import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it } from 'vitest';
import { Action } from '../extensions/Action';
import { Dialogue } from '../extensions/Dialogue';
import { SceneHeading } from '../extensions/SceneHeading';
import { captureEditorPassage, capturePreviewPassage, replaceEditorPassage, replacePreviewPassage } from './passageRewrite';

const editors: Editor[] = [];
const action = (text: string) => ({ type: 'action', content: [{ type: 'text', text }] });
function makeEditor(content: object[]) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ paragraph: false, heading: false, bulletList: false, orderedList: false,
      listItem: false, listKeymap: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      Action, Dialogue, SceneHeading,
      Node.create({ name: 'container', group: 'block', content: 'block+', renderHTML: () => ['div', 0] })],
    content: { type: 'doc', content },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));

it('replaces a repeated substring at the captured range, preserving unselected marks and scene metadata', () => {
  const editor = makeEditor([
    { type: 'sceneHeading', attrs: { id: 'scene-1', location: '赌桌' }, content: [{ type: 'text', text: 'INT. 赌桌 - 夜' }] },
    { type: 'action', content: [{ type: 'text', text: '前文', marks: [{ type: 'bold' }] }, { type: 'text', text: '重复。重复。后文' }] },
    action('结尾'),
  ]);
  const before = editor.getJSON();
  const start = editor.state.doc.child(0).nodeSize + 1;
  editor.commands.setTextSelection({ from: start + 5, to: start + 8 });
  const passage = captureEditorPassage(editor)!;
  expect(passage.selectedText).toBe('重复。');
  expect(replaceEditorPassage(editor, passage, [action('修订。')])).toBe(true);
  expect(editor.state.doc.child(1).textContent).toBe('前文重复。修订。后文');
  expect(editor.getJSON().content![0]).toEqual(before.content![0]);
  expect(editor.getJSON().content![1].content![0].marks).toEqual([{ type: 'bold' }]);
  editor.commands.undo();
  expect(editor.getJSON()).toEqual(before);
  editor.commands.redo();
  expect(editor.state.doc.child(1).textContent).toBe('前文重复。修订。后文');
});

it('replaces across paragraphs and keeps both unselected edges', () => {
  const editor = makeEditor([action('左边保留甲'), action('中间原文'), action('乙右边保留'), action('尾声')]);
  const thirdStart = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize + 1;
  editor.commands.setTextSelection({ from: 5, to: thirdStart + 1 });
  const passage = captureEditorPassage(editor)!;
  const before = editor.getJSON();
  expect(replaceEditorPassage(editor, passage, [action('第一行'), action('第二行')])).toBe(true);
  expect(editor.getText({ blockSeparator: '\n' })).toBe('左边保留第一行\n第二行右边保留\n尾声');
  editor.commands.undo();
  expect(editor.getJSON()).toEqual(before);
});

it('preserves nested containers and dialogue for a partial rewrite', () => {
  const editor = makeEditor([{ type: 'container', content: [{ type: 'dialogue', content: [{ type: 'text', text: '别走。留下。' }] }] }]);
  editor.commands.setTextSelection({ from: 2, to: 5 });
  const passage = captureEditorPassage(editor)!;
  expect(replaceEditorPassage(editor, passage, [action('等等。')])).toBe(true);
  expect(editor.getJSON().content![0].type).toBe('container');
  expect(editor.getJSON().content![0].content![0].type).toBe('dialogue');
  expect(editor.state.doc.textContent).toBe('等等。留下。');
});

it('refuses stale ranges and isolates rewriting from preceding manual edits', () => {
  const editor = makeEditor([action('原文')]);
  editor.commands.insertContentAt(3, '。');
  editor.commands.setTextSelection({ from: 1, to: 3 });
  const passage = captureEditorPassage(editor)!;
  expect(replaceEditorPassage(editor, passage, [action('新稿')])).toBe(true);
  editor.commands.undo();
  expect(editor.getText()).toBe('原文。');
  editor.commands.insertContentAt(4, '变化');
  const changed = editor.getJSON();
  expect(replaceEditorPassage(editor, passage, [action('不应采用')])).toBe(false);
  expect(editor.getJSON()).toEqual(changed);
});

it('captures bounded context and handles emoji using the original UTF-16 textarea offsets', () => {
  const source = '前'.repeat(3000) + '👋她抓住手腕。' + '后'.repeat(3000);
  const passage = capturePreviewPassage(source, 3000, 3009)!;
  expect(passage.selectedText).toBe('👋她抓住手腕。后');
  expect(passage.beforeText.length).toBe(1600);
  expect(passage.afterText.length).toBe(1600);
  expect(replacePreviewPassage(source, passage, '修改')).toBe(source.slice(0, 3000) + '修改' + source.slice(3009));
  expect(replacePreviewPassage(source + '变化', passage, '修改')).toBeNull();
  expect(capturePreviewPassage(source, 5, 5)).toBeNull();
});
