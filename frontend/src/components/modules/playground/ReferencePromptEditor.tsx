'use client';

import { useEffect, useRef } from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { shortReferenceLabel } from './referenceMedia';
import type { Editor } from '@tiptap/core';

export type ReferenceSuggestion = { query: string; choose: (label: string) => void };

function referenceSuggestion(editor: Editor): ReferenceSuggestion | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc');
  const match = before.match(/(?:^|[\s“”"'（(，。！？、\u3400-\u9fff])@([^@\n]*)$/);
  if (!match) return null;
  const from = selection.from - match[1].length - 1;
  const to = selection.from;
  return { query: match[1], choose: (label) => {
    editor.chain().focus().insertContentAt({ from, to }, [
      { type: 'referenceToken', attrs: { label } }, { type: 'text', text: ' ' },
    ]).run();
  } };
}

const ReferenceToken = Node.create({
  name: 'referenceToken', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ label: { default: '', parseHTML: (element) => element.getAttribute('data-reference-label') || '' } }),
  parseHTML: () => [{ tag: 'span[data-reference-label]' }],
  renderHTML: ({ node }) => ['span', {
    'data-reference-label': node.attrs.label,
    'data-full-name': node.attrs.label,
    class: 'rounded px-1 text-primary',
    style: 'background-color: rgba(52, 216, 196, 0.15);',
  }, '@' + shortReferenceLabel(node.attrs.label)],
  renderText: ({ node }) => '@' + node.attrs.label,
});

function restoredReferenceName(text: string): string | undefined {
  // Old drafts contain plain @names without selected-media metadata. Filename
  // extensions delimit names containing spaces; prose after them stays plain.
  const filename = text.match(/^([^@\n]+?\.(?:png|jpe?g|webp|gif|avif|heic|mp4|mov|webm))(?=$|[\s，。！？、“”"'）)])/i)?.[1];
  if (filename) return filename;
  const untitled = text.match(/^(Untitled (?:image|video))(?=$|[\s，。！？、“”"'）)])/i)?.[1];
  if (untitled) return untitled;
  return text.match(/^([^@\s，。！？、“”"'（）()]+)(?=$|[\s，。！？、“”"'）)])/)?.[1];
}

export function referencePromptDocument(value: string, labels: string[], restoreNames = true): JSONContent {
  const names = Array.from(new Set(labels)).filter(Boolean).sort((a, b) => b.length - a.length);
  return { type: 'doc', content: value.split('\n').map((line) => {
    const content: JSONContent[] = [];
    let plain = '';
    const flush = () => { if (plain) content.push({ type: 'text', text: plain }); plain = ''; };
    for (let index = 0; index < line.length;) {
      const isMention = line[index] === '@' && (index === 0 || /[\s“”"'（(，。！？、\u3400-\u9fff]/.test(line[index - 1]));
      const label = isMention
        ? names.find((name) => line.startsWith('@' + name, index))
          || (restoreNames ? restoredReferenceName(line.slice(index + 1)) : undefined)
        : undefined;
      if (label) { flush(); content.push({ type: 'referenceToken', attrs: { label } }); index += label.length + 1; }
      else { plain += line[index++]; }
    }
    flush();
    return { type: 'paragraph', content };
  }) };
}

export default function ReferencePromptEditor({ value, labels, placeholder, onChange, onSubmit, onMentionChange }: {
  value: string; labels: string[]; placeholder: string; onChange: (text: string) => void; onSubmit?: () => void;
  onMentionChange?: (suggestion: ReferenceSuggestion | null) => void;
}) {
  const lastLocalValue = useRef<string | null>(null);
  const currentLabels = useRef(labels);
  currentLabels.current = labels;
  const callbacks = useRef({ onChange, onSubmit, onMentionChange });
  callbacks.current = { onChange, onSubmit, onMentionChange };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      ReferenceToken, Placeholder.configure({ placeholder })],
    content: referencePromptDocument(value, labels),
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': placeholder, 'aria-multiline': 'true', style: 'outline: none; box-shadow: none;', class: 'min-h-[120px] max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent text-[0.9375rem] leading-[1.65] text-foreground outline-none focus:outline-none focus:ring-0 [&_p]:m-0 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child::before]:text-text-muted [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:pointer-events-none' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') callbacks.current.onMentionChange?.(null);
        if (!event.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          callbacks.current.onSubmit?.(); return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text == null) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText({ blockSeparator: '\n' });
      lastLocalValue.current = text;
      callbacks.current.onChange(text);
      callbacks.current.onMentionChange?.(referenceSuggestion(editor));
    },
    onSelectionUpdate: ({ editor }) => callbacks.current.onMentionChange?.(referenceSuggestion(editor)),
    onBlur: ({ editor }) => {
      callbacks.current.onMentionChange?.(null);
      const text = editor.getText({ blockSeparator: '\n' });
      const document = referencePromptDocument(text, currentLabels.current);
      if (!editor.state.doc.eq(editor.schema.nodeFromJSON(document))) {
        editor.commands.setContent(document, { emitUpdate: false });
      }
    },
  });
  useEffect(() => {
    if (!editor) return;
    const existingNames: string[] = [];
    editor.state.doc.descendants((node) => { if (node.type.name === 'referenceToken') existingNames.push(node.attrs.label); });
    const document = referencePromptDocument(value, [...labels, ...existingNames], lastLocalValue.current !== value);
    // Equal text can still be plain text while reference metadata is loading.
    if (editor.state.doc.eq(editor.schema.nodeFromJSON(document))) return;
    const textChanged = editor.getText({ blockSeparator: '\n' }) !== value;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(document, { emitUpdate: false });
    if (textChanged) editor.commands.focus('end');
    else {
      const end = editor.state.doc.content.size - 1;
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
    }
  }, [editor, value, labels]);
  return <EditorContent editor={editor} className="min-w-0 w-full" />;
}
