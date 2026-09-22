import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import BottomTabBar from './BottomTabBar';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/modules/playground/PlaygroundSessionSubnav', () => ({ default: () => null }));

it('keeps recreation and 3D director visible while secondary destinations stay reachable', () => {
  const onTabChange = vi.fn();
  render(<BottomTabBar activeTab="recreation" onTabChange={onTabChange} />);
  expect(screen.getAllByRole('button')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'recreation' })).toHaveAttribute('aria-current', 'page');
  for (const tab of ['playground', 'recreation', 'director3d']) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    expect(onTabChange).toHaveBeenLastCalledWith(tab);
    expect(window.location.hash).toBe(tab === 'director3d' ? '#/director' : '#/' + tab);
  }
  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'library' }));
  expect(onTabChange).toHaveBeenLastCalledWith('library');
  expect(window.location.hash).toBe('#/library');
});
