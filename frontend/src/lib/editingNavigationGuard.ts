type EditingNavigationGuard = {
  isDirty: () => boolean;
  isBusy: () => boolean;
  onLeaveRequest: (targetHash: string) => void;
};

let activeGuard: EditingNavigationGuard | null = null;
let allowedTarget: string | null = null;

const isEditingRoute = (hash: string) => /^#\/editing(?:\?|$)/.test(hash);

export function shouldGuardEditingRouteChange(previousHash: string, targetHash: string) {
  return isEditingRoute(previousHash) && !isEditingRoute(targetHash) && requestEditingNavigation(targetHash);
}

export function registerEditingNavigationGuard(guard: EditingNavigationGuard) {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** Return true when the app router must restore its current hash and wait. */
export function requestEditingNavigation(targetHash: string) {
  if (allowedTarget === targetHash) {
    allowedTarget = null;
    return false;
  }
  if (!activeGuard || (!activeGuard.isDirty() && !activeGuard.isBusy())) return false;
  activeGuard.onLeaveRequest(targetHash);
  return true;
}

export function continueEditingNavigation(targetHash: string) {
  allowedTarget = targetHash;
  window.location.hash = targetHash;
}
