'use client';

import { useEffect, useRef } from 'react';
import { Node, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { shortReferenceLabel } from './referenceMedia';
import type { Editor } from '@tiptap/core';
import type { AssetLibraryReference } from '@/lib/api';
import type { AssetPreviewRef } from '@/components/shared/AssetIndexPreview';

const EMPTY_LABELS: string[] = [];
const EMPTY_REFERENCES: AssetLibraryReference[] = [];

export type ReferenceCandidate = {
  label: string;
  reference?: AssetLibraryReference;
  previewUrl?: string;
  previewRef?: AssetPreviewRef;
  mediaUrl?: string;
  sourceLabel?: string;
  variantLabel?: string;
  isActive?: boolean;
  description?: string;
};

export type ReferenceSuggestion = {
  query: string;
  choose: (candidate: string | ReferenceCandidate) => void;
  replaceWithText: (text: string) => string;
};

export type PromptSlashSuggestion = {
  query: string;
  /** Read-only text outside the replacement range. */
  remainingText?: string;
  /** A Skill's [label] placeholder. The replacement covers just this occurrence. */
  slot?: string;
  contextKey?: string;
  /** Append a template after the complete draft, preserving references and suffix text. */
  appendWithText?: (text: string) => string;
  replaceWithText: (text: string) => string;
};

function appendPromptTemplate(editor: Editor, source: Editor['state']['doc'], text: string, slashRange?: { from: number; to: number }): string {
  if (!editor.state.doc.eq(source) || !text.trim()) return editor.getText({ blockSeparator: '\n' });
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.chain().focus().command(({ tr }) => {
    if (slashRange) tr.delete(slashRange.from, slashRange.to);
    // Keep the document and its reference nodes; only normalize trailing space.
    let end = tr.doc.content.size - 1;
    const lastBlock = tr.doc.lastChild;
    const trailing = lastBlock?.textContent.match(/\s+$/)?.[0].length || 0;
    if (trailing) { tr.delete(end - trailing, end); end -= trailing; }
    const existing = tr.doc.textBetween(0, tr.doc.content.size, '\n', '\ufffc');
    const trimmed = existing.trimEnd();
    const nodes = [];
    if (trimmed && !/[。！？.!?…][”’"')）\]]?$/.test(trimmed)) {
      // Add punctuation to the last nonempty block, even if empty lines follow it.
      let lastContentEnd = 0;
      tr.doc.descendants((node, pos) => { if (node.isText || node.isAtom && node.isInline) lastContentEnd = pos + node.nodeSize; });
      if (lastContentEnd) { tr.insertText('。', lastContentEnd); end = tr.doc.content.size - 1; }
    }
    if (trimmed && !existing.endsWith('\n')) nodes.push(editor.schema.nodes.hardBreak.create());
    nodes.push(editor.schema.text(text.trim()));
    tr.insert(end, nodes);
    return true;
  }).run();
  return editor.getText({ blockSeparator: '\n' });
}

function slashSuggestion(editor: Editor): PromptSlashSuggestion | null {
  const { selection } = editor.state;
  const parentText = selection.$from.parent.textBetween(0, selection.$from.parent.content.size, '\n', '\ufffc');
  const offset = selection.$from.parentOffset;
  const slot = Array.from(parentText.matchAll(/\[([^\[\]\n/@]{1,40})\]/g)).find((match) => {
    const start = match.index!;
    return selection.empty ? offset > start && offset < start + match[0].length
      : selection.$from.sameParent(selection.$to) && offset === start && selection.$to.parentOffset === start + match[0].length;
  });
  if (slot) {
    const from = selection.$from.start() + slot.index!;
    const to = from + slot[0].length;
    return { query: '', slot: slot[1].trim(), contextKey: `slot:${from}:${to}`, replaceWithText: (text) => {
      // Refuse a stale selection if the source template changed while browsing.
      if (to > editor.state.doc.content.size || editor.state.doc.textBetween(from, to) !== slot[0]) return editor.getText({ blockSeparator: '\n' });
      editor.view.dispatch(closeHistory(editor.state.tr));
      editor.chain().focus().insertContentAt({ from, to }, text ? { type: 'text', text } : []).run();
      return editor.getText({ blockSeparator: '\n' });
    } };
  }
  if (!selection.empty) return null;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\ufffc');
  const match = before.match(/(?:^|[\s（(，。！？、\u3400-\u9fff])\/([^/@\n]*)$/);
  if (!match) return null;
  const from = selection.from - match[1].length - 1;
  const to = selection.from;
  const sourceDocument = editor.state.doc;
  return { query: match[1], appendWithText: text => appendPromptTemplate(editor, sourceDocument, text, { from, to }), remainingText: editor.state.doc.textBetween(0, from, "\n") + editor.state.doc.textBetween(to, editor.state.doc.content.size, "\n"), replaceWithText: (text) => {
    editor.view.dispatch(closeHistory(editor.state.tr));
    if (text) {
      editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text }).run();
    } else editor.chain().focus().deleteRange({ from, to }).run();
    return editor.getText({ blockSeparator: '\n' });
  } };
}

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
  }, replaceWithText: (text) => {
    editor.chain().focus().insertContentAt({ from, to }, text).run();
    return editor.getText({ blockSeparator: '\n' });
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

export default function ReferencePromptEditor({ value, labels = EMPTY_LABELS, candidates, placeholder, onChange, onSubmit, onMentionChange, onMentionKeyDown, onSlashChange, onSlashKeyDown, onReferencesChange, allowImplicitMentions = true, editable = true, pruneUnlistedReferences = false, restoreSelectedReferences = EMPTY_REFERENCES, expanded = false, openSlashRequest = 0 }: {
  value: string; labels?: string[]; candidates?: ReferenceCandidate[]; placeholder: string; onChange: (text: string) => void; onSubmit?: () => void;
  onMentionChange?: (suggestion: ReferenceSuggestion | null) => void;
  onMentionKeyDown?: (event: KeyboardEvent) => boolean;
  onSlashChange?: (suggestion: PromptSlashSuggestion | null) => void;
  onSlashKeyDown?: (event: KeyboardEvent) => boolean;
  openSlashRequest?: number;
  onReferencesChange?: (references: AssetLibraryReference[]) => void;
  allowImplicitMentions?: boolean;
  editable?: boolean;
  pruneUnlistedReferences?: boolean;
  expanded?: boolean;
  /** Rebind matching @labels after an external plain-text replacement (for
   * example accepting an AI-polished prompt) without binding new references. */
  restoreSelectedReferences?: AssetLibraryReference[];
}) {
  const lastLocalValue = useRef<string | null>(null);
  const lastSlashRequest = useRef(0);
  const currentCandidates = useRef<ReferenceCandidate[]>(candidates ?? labels.map((label) => ({ label })));
  currentCandidates.current = candidates ?? labels.map((label) => ({ label }));
  const callbacks = useRef({ onChange, onSubmit, onMentionChange, onMentionKeyDown, onSlashChange, onSlashKeyDown, onReferencesChange });
  callbacks.current = { onChange, onSubmit, onMentionChange, onMentionKeyDown, onSlashChange, onSlashKeyDown, onReferencesChange };
  const initialCandidates = candidates ?? labels.map((label) => ({ label }));
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false }),
      ReferenceToken, Placeholder.configure({ placeholder })],
    content: referencePromptDocument(value, initialCandidates, true, allowImplicitMentions),
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': placeholder, 'aria-multiline': 'true', style: 'outline: none; box-shadow: none;', class: `${expanded ? 'min-h-[280px] max-h-[420px]' : 'min-h-[100px] max-h-[160px]'} overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent text-[0.9375rem] leading-[1.65] text-foreground outline-none focus:outline-none focus:ring-0 [&_p]:m-0 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child::before]:text-text-muted [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:pointer-events-none` },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        if (callbacks.current.onSlashKeyDown?.(event)) return true;
        if (callbacks.current.onMentionKeyDown?.(event)) return true;
        if (event.key === 'Escape') { callbacks.current.onMentionChange?.(null); callbacks.current.onSlashChange?.(null); }
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
      callbacks.current.onSlashChange?.(slashSuggestion(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      callbacks.current.onMentionChange?.(referenceSuggestion(editor));
      callbacks.current.onSlashChange?.(slashSuggestion(editor));
    },
    onBlur: ({ editor, event }) => {
      if ((event.relatedTarget as HTMLElement | null)?.closest?.('[data-prompt-discovery]')) return;
      callbacks.current.onMentionChange?.(null);
      callbacks.current.onSlashChange?.(null);
      const text = editor.getText({ blockSeparator: '\n' });
      const document = referencePromptDocument(text, currentCandidates.current, true, allowImplicitMentions);
      if (allowImplicitMentions && !editor.state.doc.eq(editor.schema.nodeFromJSON(document))) {
        editor.commands.setContent(document, { emitUpdate: false });
      }
    },
  });
  useEffect(() => {
    if (!editor || !openSlashRequest || !editable || lastSlashRequest.current === openSlashRequest) return;
    lastSlashRequest.current = openSlashRequest;
    const existing = slashSuggestion(editor);
    if (existing) { callbacks.current.onSlashChange?.(existing); return; }
    // Opening a chooser must not edit the draft or clear its structured fields.
    const { from, to } = editor.state.selection;
    const sourceDocument = editor.state.doc;
    callbacks.current.onSlashChange?.({
      query: '', contextKey: `panel:${openSlashRequest}:${from}:${to}`,
      appendWithText: text => appendPromptTemplate(editor, sourceDocument, text),
      remainingText: sourceDocument.textBetween(0, from, '\n') + sourceDocument.textBetween(to, sourceDocument.content.size, '\n'),
      replaceWithText: (text) => {
        if (!editor.state.doc.eq(sourceDocument)) return editor.getText({ blockSeparator: '\n' });
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.chain().focus().insertContentAt({ from, to }, text ? { type: 'text', text } : []).run();
        return editor.getText({ blockSeparator: '\n' });
      },
    });
  }, [editor, openSlashRequest, editable]);
  useEffect(() => {
    if (!editor) return;
    const existingNames: string[] = [];
    let hasUnlistedReference = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'referenceToken') return;
      existingNames.push(node.attrs.label);
      if (pruneUnlistedReferences && node.attrs.asset_type && node.attrs.asset_id && node.attrs.variant_id) {
        const listed = currentCandidates.current.some((candidate) => {
          const reference = candidate.reference;
          return reference?.asset_type === node.attrs.asset_type
            && reference?.asset_id === node.attrs.asset_id
            && reference?.variant_id === node.attrs.variant_id;
        });
        if (!listed) hasUnlistedReference = true;
      }
    });
    if (hasUnlistedReference) {
      const document = referencePromptDocument(value, currentCandidates.current, false, allowImplicitMentions);
      if (!editor.state.doc.eq(editor.schema.nodeFromJSON(document))) {
        editor.commands.setContent(document, { emitUpdate: false });
        callbacks.current.onReferencesChange?.(referenceSelectionsFromEditor(editor));
      }
      return;
    }
    // Character prompts use explicit selection only. Keeping the current rich
    // document when its plain text is unchanged preserves selected token
    // metadata and avoids upgrading manually typed @names into references.
    if (!allowImplicitMentions && editor.getText({ blockSeparator: '\n' }) === value) return;
    const selectedKeys = new Set(restoreSelectedReferences.map((reference) =>
      `${reference.asset_type}:${reference.asset_id}:${reference.variant_id}`,
    ));
    const selectedCandidates = currentCandidates.current.filter((candidate) => {
      const reference = candidate.reference;
      return reference && selectedKeys.has(`${reference.asset_type}:${reference.asset_id}:${reference.variant_id}`);
    });
    const selectedAliases = selectedCandidates.flatMap((candidate) => {
      const separator = candidate.label.indexOf(' · ');
      if (separator <= 0) return [];
      return [{ ...candidate, label: candidate.label.slice(0, separator) }];
    });
    const document = referencePromptDocument(
      value,
      [...selectedCandidates, ...selectedAliases, ...existingNames.map((label) => ({ label }))],
      lastLocalValue.current !== value,
      selectedCandidates.length > 0 ? true : allowImplicitMentions,
    );
    // Equal text can still be plain text while reference metadata is loading.
    if (editor.state.doc.eq(editor.schema.nodeFromJSON(document))) return;
    const textChanged = editor.getText({ blockSeparator: '\n' }) !== value;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(document, { emitUpdate: false });
    callbacks.current.onReferencesChange?.(referenceSelectionsFromEditor(editor));
    if (textChanged) editor.commands.focus('end');
    else {
      const end = editor.state.doc.content.size - 1;
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
    }
  }, [editor, value, labels, candidates, allowImplicitMentions, pruneUnlistedReferences, restoreSelectedReferences]);
  return <EditorContent editor={editor} className="min-w-0 w-full" />;
}
