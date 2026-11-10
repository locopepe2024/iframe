'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, TreePine, Film, Plus } from 'lucide-react';
import type { Editor } from '@tiptap/react';

export interface OutlineViewProps {
  editor: Editor | null;
}

interface OutlineSection {
  id: string;
  title: string;
  pos: number;
  scenes: OutlineScene[];
}

interface OutlineScene {
  id: string;
  title: string;
  number: number | null;
  pos: number;
}

export default function OutlineView({ editor }: OutlineViewProps) {
  const t = useTranslations('scriptEditor');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [docRevision, setDocRevision] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setDocRevision((revision) => revision + 1);
    editor.on('update', refresh);
    return () => { editor.off('update', refresh); };
  }, [editor]);

  const outline = useMemo(() => {
    if (!editor) return { sections: [] as OutlineSection[], flatScenes: [] as OutlineScene[] };

    const sections: OutlineSection[] = [];
    const flatScenes: OutlineScene[] = [];
    let currentSection: OutlineSection | null = null;
    let sceneIndex = 0;

    const doc = editor.state.doc;
    doc.descendants((node, pos) => {
      if (node.type.name === 'section') {
        currentSection = {
          id: `section-${pos}`,
          title: node.attrs.title || t('sidebar.actLabel', { number: sections.length + 1 }),
          pos,
          scenes: [],
        };
        sections.push(currentSection);
        return true; // traverse children
      }
      if (node.type.name === 'sceneHeading') {
        sceneIndex++;
        const scene: OutlineScene = {
          id: `scene-${pos}`,
          title: node.textContent || t('sidebar.sceneLabel', { number: sceneIndex }),
          number: sceneIndex,
          pos,
        };
        if (currentSection) {
          currentSection.scenes.push(scene);
        } else {
          flatScenes.push(scene);
        }
        return false;
      }
      return true;
    });

    return { sections, flatScenes };
  }, [editor, editor?.state.doc, docRevision]);

  const handleAddScene = useCallback(() => {
    if (!editor) return;
    const position = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(position, {
      type: 'sceneHeading',
      attrs: { id: crypto.randomUUID() },
      content: [],
    }).run();
    editor.commands.setTextSelection(position + 1);
    editor.commands.focus();
  }, [editor]);

  const handleJump = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.commands.setTextSelection(pos + 1);
      editor.commands.scrollIntoView();
    },
    [editor]
  );

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const hasSections = outline.sections.length > 0;
  const hasAny = hasSections || outline.flatScenes.length > 0;

  if (!hasAny) {
    return (
      <div className="p-2">
        <button type="button" disabled={!editor} onClick={handleAddScene}
          className="flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-xs text-text-secondary transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50">
          <Plus size={14} aria-hidden="true" />{t('sidebar.addScene')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-2">
      <button type="button" disabled={!editor} onClick={handleAddScene}
        className="mb-1 flex min-h-10 w-full items-center gap-2 rounded px-2 text-left text-xs text-text-secondary transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50">
        <Plus size={14} aria-hidden="true" />{t('sidebar.addScene')}
      </button>
      {/* Flat scenes (no section) */}
      {outline.flatScenes.map((scene) => (
        <button
          key={scene.id}
          type="button"
          onClick={() => handleJump(scene.pos)}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-left rounded hover:bg-white/5 transition-colors"
        >
          <Film size={12} className="shrink-0 text-zinc-400" />
          <span className="text-sm text-foreground truncate">
            {scene.number != null && (
              <span className="text-xs font-mono text-text-muted mr-1">#{scene.number}</span>
            )}
            {scene.title}
          </span>
        </button>
      ))}

      {/* Sections with nested scenes */}
      {outline.sections.map((section) => (
        <div key={section.id} className="mb-1">
          <button
            type="button"
            onClick={() => toggleSection(section.id)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left rounded hover:bg-white/5 transition-colors"
          >
            <motion.div
              animate={{ rotate: collapsed[section.id] ? 0 : 90 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight size={12} className="text-text-muted" />
            </motion.div>
            <TreePine size={12} className="shrink-0 text-indigo-400" />
            <span className="text-sm font-medium text-foreground truncate">
              {section.title}
            </span>
            <span className="ml-auto text-[10px] text-text-muted">
              {section.scenes.length}
            </span>
          </button>

          <AnimatePresence>
            {!collapsed[section.id] && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="ml-4 border-l border-white/5 pl-2">
                  {section.scenes.map((scene) => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => handleJump(scene.pos)}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left rounded hover:bg-white/5 transition-colors"
                    >
                      <Film size={10} className="shrink-0 text-zinc-500" />
                      <span className="text-xs text-text-secondary truncate">
                        {scene.number != null && (
                          <span className="font-mono text-text-muted mr-1">#{scene.number}</span>
                        )}
                        {scene.title}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
