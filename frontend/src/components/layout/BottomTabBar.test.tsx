import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import BottomTabBar from './BottomTabBar';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/modules/playground/PlaygroundSessionSubnav', () => ({ default: () => null }));

it('keeps home, workspace, creation and 3D director visible while secondary destinations stay reachable', () => {
  const onTabChange = vi.fn();
  render(<BottomTabBar activeTab="imageEditor" onTabChange={onTabChange} />);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  expect(screen.getByRole('button', { name: 'imageEditor' })).toHaveAttribute('aria-current', 'page');
  const primaryRoutes = {
    home: '#/',
    workspace: '#/workspace',
    playground: '#/playground',
    imageEditor: '#/image-editor',
    director3d: '#/director',
  };
  for (const [tab, hash] of Object.entries(primaryRoutes)) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    expect(onTabChange).toHaveBeenLastCalledWith(tab);
    expect(window.location.hash).toBe(hash);
  }
  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'library' }));
  expect(onTabChange).toHaveBeenLastCalledWith('library');
  expect(window.location.hash).toBe('#/library');
});
