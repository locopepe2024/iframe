import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import OutlineView from './OutlineView';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    key === 'sidebar.actLabel' ? `Act ${values?.number}` : key === 'sidebar.sceneLabel' ? `Scene ${values?.number}` : key,
}));

it('adds a scene heading from the outline and focuses its title', () => {
  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt }));
  const editor = {
    state: { doc: { content: { size: 42 }, descendants: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
    chain: () => ({ focus }),
    commands: { setTextSelection: vi.fn(), focus: vi.fn() },
  } as unknown as Editor;

  render(<OutlineView editor={editor} />);
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.addScene' }));

  expect(insertContentAt).toHaveBeenCalledWith(42, expect.objectContaining({
    type: 'sceneHeading',
    attrs: expect.objectContaining({ id: expect.any(String) }),
    content: [],
  }));
  expect(run).toHaveBeenCalledOnce();
  expect(editor.commands.setTextSelection).toHaveBeenCalledWith(43);
  expect(editor.commands.focus).toHaveBeenCalledOnce();
});
