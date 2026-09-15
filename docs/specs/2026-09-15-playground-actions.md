# Playground actions and reference presentation

User-requested scope: card footer overflow deletion; five-character session labels with delete/rename menus; remove duplicated sidebar history/templates links; one upload/library panel; green compact reference tokens with full-name hover; no prompt focus border; green dashed rounded reference add button.

Implement on feature/lumenx-multi-user-v1, which owns named references and current composer. Keep full prompt reference labels in state/API; only display is shortened. Use existing Tiptap dependencies for atomic inline reference tokens. Preserve plain text paste and IME input.

Session deletion removes the owner-scoped session and its generation history records, not library media files. Reject deletion while a generation is pending/processing. UI switches away from an active deleted session and creates a blank session if needed. Rename uses existing PATCH. Menus close on outside click/Escape and show failures.

Validation: session storage deletion/reload and busy protection tests; frontend typecheck and targeted component tests. Browser MCP not used without scoped user permission.
