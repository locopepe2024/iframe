# Recreation task recovery and cost consent v1

## Scope

This slice closes two user-visible gaps in the recreation workflow:

1. A keyframe request must carry an explicit user cost decision, rather than
   silently setting `accept_cost=true` in the client.
2. Reloading the recreation page must rediscover persisted generation,
   assembly, and keyframe tasks and converge polling when a task reaches a
   terminal state.

## Observed

- The backend already rejects keyframe creation without `accept_cost=true`.
- The frontend currently hard-codes `accept_cost: true` for keyframe requests.
- Generation and assembly task records are durable, but the component keeps
  their IDs only in React state. Keyframe tasks have no project-level list
  endpoint.
- Generation polling clears its interval only on unmount or ID change; it does
  not stop when all tasks are terminal.

## Decisions

- Add a project-scoped keyframe task list endpoint with optional `shot_id`.
- Expose task timestamps needed to select the latest persisted generation or
  assembly after a reload; selection is owner-scoped and project-scoped.
- The client restores the newest generation group and newest assembly for the
  current project. It does not silently submit or retry paid work.
- The keyframe UI requires a checked cost acknowledgement before enabling the
  paid action; the API function accepts the boolean explicitly.
- Polling stops when generation tasks or assembly tasks are all terminal.

## Boundaries and non-goals

- This slice does not add provider motion references or ControlNet fields.
- This slice does not automatically resubmit work after a process crash.
- A persisted task with no known upstream recovery contract remains visible for
  explicit retry or operator diagnosis.

## Success criteria

1. A keyframe request made by the UI sends the checkbox value, and the action
   is disabled until the checkbox is checked.
2. A refreshed project loads the latest persisted generation/assembly state.
3. A project-scoped keyframe task can be rediscovered by shot.
4. Generation and assembly polling intervals are cleared at terminal state.
5. Existing recreation backend tests and frontend typecheck/UI tests pass.

## Verification

- `pytest -q tests/test_recreation.py tests/test_recreation_prompt_contract.py`
- `npm run test -- --run src/components/modules/recreation/ShotReferences.test.tsx`
- `npm run typecheck`
