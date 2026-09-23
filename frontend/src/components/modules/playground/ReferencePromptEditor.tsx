'use client';

import { useEffect, useRef } from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { shortReferenceLabel } from './referenceMedia';
import type { Editor } from '@tiptap/core';
import type { AssetLibraryReference } from '@/lib/api';

const EMPTY_LABELS: string[] = [];

export type ReferenceCandidate = {
  label: string;
  reference?: AssetLibraryReference;
  previewUrl?: string;
  sourceLabel?: string;
  variantLabel?: string;
};

export type ReferenceSuggestion = {
  query: string;
  choose: (candidate: string | ReferenceCandidate) => void;
};

function candidateAttrs(candidate: string | ReferenceCandidate): Record<string, string> {
  const normalized = typeof candidate === 'string' ? { label: candidate } : candidate;
  return {
    label: normalized.label,
    ...(normalized.reference ? {
      asset_type: normalized.reference.asset_type,
      asset_id: normalized.reference.asset_id,
      variant_id: normalized.reference.variant_id,
    } : {}),
  };
}

function referenceSuggestion(editor: Editor): ReferenceSuggestion | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc');
  const match = before.match(/(?:^|[\s“”"'（(，。！？、\u3400-\u9fff])@([^@\n]*)$/);
  if (!match) return null;
  const from = selection.from - match[1].length - 1;
  const to = selection.from;
  return { query: match[1], choose: (candidate) => {
    editor.chain().focus().insertContentAt({ from, to }, [
      { type: 'referenceToken', attrs: candidateAttrs(candidate) }, { type: 'text', text: ' ' },
    ]).run();
  } };
}

const ReferenceToken = Node.create({
  name: 'referenceToken', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({
    label: { default: '', parseHTML: (element) => element.getAttribute('data-reference-label') || '' },
    asset_type: { default: '', parseHTML: (element) => element.getAttribute('data-reference-asset-type') || '' },
    asset_id: { default: '', parseHTML: (element) => element.getAttribute('data-reference-asset-id') || '' },
    variant_id: { default: '', parseHTML: (element) => element.getAttribute('data-reference-variant-id') || '' },
  }),
  parseHTML: () => [{ tag: 'span[data-reference-label]' }],
  renderHTML: ({ node }) => ['span', {
    'data-reference-label': node.attrs.label,
    'data-full-name': node.attrs.label,
    ...(node.attrs.asset_type ? { 'data-reference-asset-type': node.attrs.asset_type } : {}),
    ...(node.attrs.asset_id ? { 'data-reference-asset-id': node.attrs.asset_id } : {}),
    ...(node.attrs.variant_id ? { 'data-reference-variant-id': node.attrs.variant_id } : {}),
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

export function referencePromptDocument(
  value: string,
  labelsOrCandidates: string[] | ReferenceCandidate[],
  restoreNames = true,
  allowImplicitMentions = true,
): JSONContent {
  const candidates: ReferenceCandidate[] = labelsOrCandidates.map((candidate) =>
    typeof candidate === 'string' ? { label: candidate } : candidate,
  );
  const names = Array.from(new Set(candidates.map((candidate) => candidate.label))).filter(Boolean).sort((a, b) => b.length - a.length);
  return { type: 'doc', content: value.split('\n').map((line) => {
    const content: JSONContent[] = [];
    let plain = '';
    const flush = () => { if (plain) content.push({ type: 'text', text: plain }); plain = ''; };
    for (let index = 0; index < line.length;) {
      const isMention = line[index] === '@' && (index === 0 || /[\s“”"'（(，。！？、\u3400-\u9fff]/.test(line[index - 1]));
      const label = isMention
        ? (allowImplicitMentions ? names.find((name) => line.startsWith('@' + name, index)) : undefined)
          || (restoreNames ? restoredReferenceName(line.slice(index + 1)) : undefined)
        : undefined;
      if (label) {
        flush();
        const candidate = candidates.find((item) => item.label === label);
        content.push({ type: 'referenceToken', attrs: candidateAttrs(candidate || label) });
        index += label.length + 1;
      }
      else { plain += line[index++]; }
    }
    flush();
    return { type: 'paragraph', content };
  }) };
}

export function referenceSelectionsFromEditor(editor: Editor): AssetLibraryReference[] {
  const references: AssetLibraryReference[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'referenceToken') return;
    const { asset_type, asset_id, variant_id } = node.attrs as Record<string, string>;
    if (!asset_type || !asset_id || !variant_id) return;
    const reference = { asset_type, asset_id, variant_id } as AssetLibraryReference;
    if (!references.some((item) => item.asset_type === reference.asset_type
      && item.asset_id === reference.asset_id && item.variant_id === reference.variant_id)) {
      references.push(reference);
    }
  });
  return references;
}

export default function ReferencePromptEditor({ value, labels = EMPTY_LABELS, candidates, placeholder, onChange, onSubmit, onMentionChange, onReferencesChange, allowImplicitMentions = true, editable = true }: {
  value: string; labels?: string[]; candidates?: ReferenceCandidate[]; placeholder: string; onChange: (text: string) => void; onSubmit?: () => void;
  onMentionChange?: (suggestion: ReferenceSuggestion | null) => void;
  onReferencesChange?: (references: AssetLibraryReference[]) => void;
  allowImplicitMentions?: boolean;
  editable?: boolean;
}) {
  const lastLocalValue = useRef<string | null>(null);
  const currentCandidates = useRef<ReferenceCandidate[]>(candidates ?? labels.map((label) => ({ label })));
  currentCandidates.current = candidates ?? labels.map((label) => ({ label }));
  const callbacks = useRef({ onChange, onSubmit, onMentionChange, onReferencesChange });
  callbacks.current = { onChange, onSubmit, onMentionChange, onReferencesChange };
  const initialCandidates = candidates ?? labels.map((label) => ({ label }));
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      ReferenceToken, Placeholder.configure({ placeholder })],
    content: referencePromptDocument(value, initialCandidates, true, allowImplicitMentions),
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
      callbacks.current.onReferencesChange?.(referenceSelectionsFromEditor(editor));
      callbacks.current.onMentionChange?.(referenceSuggestion(editor));
    },
    onSelectionUpdate: ({ editor }) => callbacks.current.onMentionChange?.(referenceSuggestion(editor)),
    onBlur: ({ editor }) => {
      callbacks.current.onMentionChange?.(null);
      const text = editor.getText({ blockSeparator: '\n' });
      const document = referencePromptDocument(text, currentCandidates.current, true, allowImplicitMentions);
      if (allowImplicitMentions && !editor.state.doc.eq(editor.schema.nodeFromJSON(document))) {
        editor.commands.setContent(document, { emitUpdate: false });
      }
    },
  });
  useEffect(() => {
    if (!editor) return;
    const existingNames: string[] = [];
    editor.state.doc.descendants((node) => { if (node.type.name === 'referenceToken') existingNames.push(node.attrs.label); });
    // Character prompts use explicit selection only. Keeping the current rich
    // document when its plain text is unchanged preserves selected token
    // metadata and avoids upgrading manually typed @names into references.
    if (!allowImplicitMentions && editor.getText({ blockSeparator: '\n' }) === value) return;
    const document = referencePromptDocument(value, [...currentCandidates.current, ...existingNames.map((label) => ({ label }))], lastLocalValue.current !== value, allowImplicitMentions);
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
  }, [editor, value, labels, candidates, allowImplicitMentions]);
  return <EditorContent editor={editor} className="min-w-0 w-full" />;
}
