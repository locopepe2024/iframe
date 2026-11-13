import { afterEach, expect, it, vi } from 'vitest';
import { continueEditingNavigation, registerEditingNavigationGuard, shouldGuardEditingRouteChange } from '@/lib/editingNavigationGuard';

afterEach(() => {
  window.location.hash = '';
});

it('keeps internal editing tabs navigable while protecting an exit from the module', () => {
  const onLeaveRequest = vi.fn();
  const unregister = registerEditingNavigationGuard({ isDirty: () => true, isBusy: () => false, onLeaveRequest });
  expect(shouldGuardEditingRouteChange('#/editing', '#/editing?tab=materials')).toBe(false);
  expect(shouldGuardEditingRouteChange('#/editing?tab=materials', '#/library')).toBe(true);
  expect(onLeaveRequest).toHaveBeenCalledOnce();
  expect(onLeaveRequest).toHaveBeenCalledWith('#/library');
  unregister();
});

it('allows a confirmed target exactly once and leaves other targets guarded', () => {
  const onLeaveRequest = vi.fn();
  const unregister = registerEditingNavigationGuard({ isDirty: () => true, isBusy: () => false, onLeaveRequest });
  continueEditingNavigation('#/library');
  expect(shouldGuardEditingRouteChange('#/editing', '#/library')).toBe(false);
  expect(shouldGuardEditingRouteChange('#/editing', '#/settings')).toBe(true);
  expect(onLeaveRequest).toHaveBeenCalledOnce();
  unregister();
});

it('guards a clean route while an operation is still in flight', () => {
  const onLeaveRequest = vi.fn();
  const unregister = registerEditingNavigationGuard({ isDirty: () => false, isBusy: () => true, onLeaveRequest });
  expect(shouldGuardEditingRouteChange('#/editing', '#/director')).toBe(true);
  expect(onLeaveRequest).toHaveBeenCalledWith('#/director');
  unregister();
});
