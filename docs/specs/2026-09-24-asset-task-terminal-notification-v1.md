# Asset Task Terminal Notification v1

## Status

Implemented in the 0.1.4 patch release.

## Observed

- Code fact: `ConsistencyVault` and `CastWorkbenchModal` poll task status from async `setInterval` callbacks. A slow request can remain in flight when the next interval tick starts.
- Code fact: terminal failure handlers clear the interval and notify the user, but clearing an interval does not cancel requests that have already started.
- Direct implication: overlapping requests can each process the same failed status and enqueue repeated alerts or error toasts. Dismissing one notification may expose another identical notification.
- Code fact: backend asset failures may already start with `生成失败：`; the frontend also adds a localized failure title.
- Local runtime reproduction: a deferred failed task response with three overlapping status reads produced three error toasts before the fix.

## Contract

1. At most one status request for a task may be in flight at a time.
2. Once a task reports `completed` or `failed`, its terminal handler runs once. Further timer ticks must not repeat project updates or notifications.
3. A transient read error releases the single-flight guard so a later poll can retry. Existing caller-specific network-error behavior remains in place.
4. Preserve the provider failure detail, but remove the backend's leading `生成失败：` wrapper before adding a localized UI title.
5. A task failure presents one dismissible notification; dismissing it leaves no duplicate notification queued for the same terminal response.

## Boundaries

- This changes frontend polling coordination and error presentation only.
- It does not retry or resubmit a provider generation, alter content-safety decisions, or change persisted task state.
- It does not cancel an active backend task when the user dismisses an error notification.

## Acceptance criteria

- Simultaneous poll ticks share one status request while it is pending.
- A failed status is handled once even when several timer ticks occurred during the request.
- A transient network error does not permanently lock polling.
- Repeated backend failure wrappers do not produce duplicate localized prefixes.
- Existing completed-task merge and generating-marker cleanup behavior remains covered.

## Affected paths

- `frontend/src/lib/assetTaskPolling.ts`
- `frontend/src/components/modules/ConsistencyVault.tsx`
- `frontend/src/components/modules/cast/CastWorkbenchModal.tsx`
- polling and Cast workbench tests
