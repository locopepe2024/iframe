import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import BottomTabBar from './BottomTabBar';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/modules/playground/PlaygroundSessionSubnav', () => ({ default: () => null }));

it('keeps creation and recreation reachable in the mobile navigation', () => {
  const onTabChange = vi.fn();
  render(<BottomTabBar activeTab="recreation" onTabChange={onTabChange} />);
  expect(screen.getAllByRole('button')).toHaveLength(6);
  expect(screen.getByRole('button', { name: 'recreation' })).toHaveAttribute('aria-current', 'page');
  for (const tab of ['playground', 'recreation']) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    expect(onTabChange).toHaveBeenLastCalledWith(tab);
    expect(window.location.hash).toBe('#/' + tab);
  }
});
