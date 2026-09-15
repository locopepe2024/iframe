import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import FullNameHints from './FullNameHints';
it('shows full names on hover and hides on Escape', () => {
  render(<FullNameHints><span data-full-name="完整参考素材名称">完整参考素...</span></FullNameHints>);
  fireEvent.mouseOver(screen.getByText('完整参考素...'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('完整参考素材名称');
  fireEvent.keyDown(screen.getByText('完整参考素...'), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
