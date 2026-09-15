import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OverflowActions from './OverflowActions';

describe('overflow actions', () => {
  it('opens, closes with Escape, and invokes delete without opening the parent card', () => {
    const remove = vi.fn();
    const preview = vi.fn();
    render(<div onClick={preview}><OverflowActions label="More" actions={[{ label: 'Delete', onClick: remove }]} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
  });
});
