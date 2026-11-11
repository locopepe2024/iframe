import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';

export interface PassageSelection {
  selectedText: string;
  beforeText: string;
  afterText: string;
}

export interface EditorPassageSelection extends PassageSelection {
  from: number;
  to: number;
  document: ProseMirrorNode;
}

export interface PreviewPassageSelection extends PassageSelection {
  from: number;
  to: number;
  source: string;
}

export const REWRITE_SELECTION_LIMIT = 12000;
const CONTEXT_LIMIT = 1600;

export function captureEditorPassage(editor: Editor): EditorPassageSelection | null {
  const { doc, selection } = editor.state;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  const { from, to } = selection;
  const selectedText = doc.textBetween(from, to, '\n');
  if (!selectedText.trim()) return null;
  return {
    from, to, document: doc, selectedText,
    beforeText: doc.textBetween(Math.max(0, from - CONTEXT_LIMIT), from, '\n').slice(-CONTEXT_LIMIT),
    afterText: doc.textBetween(to, Math.min(doc.content.size, to + CONTEXT_LIMIT), '\n').slice(0, CONTEXT_LIMIT),
  };
}

export function editorPassageIsCurrent(editor: Editor, passage: EditorPassageSelection): boolean {
  return !editor.isDestroyed && editor.state.doc.eq(passage.document);
}

export function replaceEditorPassage(editor: Editor, passage: EditorPassageSelection, blocks: JSONContent[]): boolean {
  if (!editorPassageIsCurrent(editor, passage) || !blocks.length) return false;
  // An open slice merges the first/last replacement blocks into the surrounding
  // textblocks. A closed block insertion would split a partial sentence.
  const nodes = blocks.map(block => editor.schema.nodeFromJSON(block));
  nodes.forEach(node => node.check());
  if (nodes.some(node => !node.isTextblock)) return false;
  const slice = new Slice(Fragment.fromArray(nodes), 1, 1);
  const transaction = closeHistory(editor.state.tr).replaceRange(passage.from, passage.to, slice);
  editor.view.dispatch(transaction.scrollIntoView());
  // Keep both preceding manual edits and subsequent typing in separate undo steps.
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

export function capturePreviewPassage(source: string, from: number, to: number): PreviewPassageSelection | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > source.length) return null;
  const selectedText = source.slice(from, to);
  if (!selectedText.trim()) return null;
  return {
    source, from, to, selectedText,
    beforeText: source.slice(Math.max(0, from - CONTEXT_LIMIT), from),
    afterText: source.slice(to, to + CONTEXT_LIMIT),
  };
}

export function replacePreviewPassage(source: string, passage: PreviewPassageSelection, replacement: string): string | null {
  if (source !== passage.source) return null;
  return source.slice(0, passage.from) + replacement + source.slice(passage.to);
}
