'use client';

import { useEffect, useRef } from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { shortReferenceLabel } from './referenceMedia';

const ReferenceToken = Node.create({
  name: 'referenceToken', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-reference-label]' }],
  renderHTML: ({ node }) => ['span', {
    'data-reference-label': node.attrs.label,
    'data-full-name': node.attrs.label,
    title: node.attrs.label,
    class: 'rounded bg-primary/15 px-1 text-primary',
  }, '@' + shortReferenceLabel(node.attrs.label)],
  renderText: ({ node }) => '@' + node.attrs.label,
});

export function referencePromptDocument(value: string, labels: string[]): JSONContent {
  const names = Array.from(new Set(labels)).filter(Boolean).sort((a, b) => b.length - a.length);
  return { type: 'doc', content: value.split('\n').map((line) => {
    const content: JSONContent[] = [];
    let plain = '';
    const flush = () => { if (plain) content.push({ type: 'text', text: plain }); plain = ''; };
    for (let index = 0; index < line.length;) {
      const label = line[index] === '@' ? names.find((name) => line.startsWith('@' + name, index)) : undefined;
      if (label) { flush(); content.push({ type: 'referenceToken', attrs: { label } }); index += label.length + 1; }
      else { plain += line[index++]; }
    }
    flush();
    return { type: 'paragraph', content };
  }) };
}

export default function ReferencePromptEditor({ value, labels, placeholder, onChange, onSubmit }: {
  value: string; labels: string[]; placeholder: string; onChange: (text: string) => void; onSubmit?: () => void;
}) {
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      ReferenceToken, Placeholder.configure({ placeholder }), CharacterCount.configure({ limit: 2000 })],
    content: referencePromptDocument(value, labels),
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': placeholder, 'aria-multiline': 'true', style: 'outline: none; box-shadow: none;', class: 'min-h-[120px] max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent text-[0.9375rem] leading-[1.65] text-foreground outline-none focus:outline-none focus:ring-0 [&_p]:m-0 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child::before]:text-text-muted [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:pointer-events-none' },
      handleKeyDown: (_view, event) => {
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
    onUpdate: ({ editor }) => callbacks.current.onChange(editor.getText({ blockSeparator: '\n' })),
  });
  useEffect(() => {
    if (!editor || editor.getText({ blockSeparator: '\n' }) === value) return;
    editor.commands.setContent(referencePromptDocument(value, labels), { emitUpdate: false });
    editor.commands.focus('end');
  }, [editor, value, labels]);
  return <EditorContent editor={editor} className="min-w-0 w-full" />;
}
