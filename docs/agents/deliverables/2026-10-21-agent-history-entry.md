# Agent conversation history entry

The Playground composer exposes a separate 对话历史 action beside generation prompt history.

- Read saved conversations through the existing authenticated `/agent/sessions` and `/agent/sessions/{sid}/messages` APIs.
- Select a conversation and search its complete returned message text locally. Search scope is explicitly the selected conversation.
- Render role, timestamp and full text; leave the active workspace, composer draft and model untouched.
- Use a native modal dialog for focus containment, Escape dismissal and focus restoration. Show loading, empty, error and retry states; ignore stale requests on close or selection change.
- No changes to persistence, memory limits, model context or backend authorization. Access follows the existing API's owner-scoped conversation boundary.

Affected paths: `frontend/src/components/modules/playground/AgentHistory.tsx`, its UI tests, and `AgentComposer.tsx`.

Verification: 9 targeted history/composer UI tests passed; frontend typecheck passed. Browser layout and deployed behavior require a separate approved browser pass.
