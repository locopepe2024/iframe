# Playground actions and reference presentation

User-requested scope: card footer overflow deletion; five-character session labels with delete/rename menus; remove duplicated sidebar history/templates links; one upload/library panel; green compact reference tokens with full-name hover; no prompt focus border; green dashed rounded reference add button.

Implement on feature/lumenx-multi-user-v1, which owns named references and current composer. Keep full prompt reference labels in state/API; only display is shortened. Use existing Tiptap dependencies for atomic inline reference tokens. Preserve plain text paste and IME input.

Session deletion removes the owner-scoped session and its generation history records, not library media files. Reject deletion while a generation is pending/processing. UI switches away from an active deleted session and creates a blank session if needed. Rename uses existing PATCH. Menus close on outside click/Escape and show failures.

Validation: session storage deletion/reload and busy protection tests; frontend typecheck and targeted component tests. Browser MCP not used without scoped user permission.

## Deployment follow-up
User runtime report: image requests return HTTP 400 when both resolution and size are submitted. Provider code in uniart-1.1/service/imageroute/contract.go and relay/helper/openai_image_request_test.go explicitly accepts resolution + aspect_ratio and rejects resolution + concrete size. Send semantic tiers as resolution; preserve pixel size only when supplied as pixels. Reference edit requests use /images/edits and image references instead of silently dropping refs. Unit fixtures validate outbound contracts; live model completion remains a separate verification level.

Replace native-only titles with explicit portal tooltips for session names and reference names. Set prompt outline style explicitly to none (Tailwind outline-none compiles to a transparent solid outline).

User preference after live review: retain only the smaller native title tooltip; remove the custom bordered tooltip to prevent duplicate full-name hints. Explicit prompt outline removal remains.

## Refresh regression correction
- Native title attributes did not establish visible hover behavior. Use one compact 11px borderless full-name tooltip for sessions, thumbnails and prompt tokens; remove native titles from these targets to avoid duplicates.
- Reconcile the editor document structure when reference metadata arrives even if plain prompt text is unchanged. Preserve full text and avoid focusing on metadata-only reconciliation.
- Runtime inspection found the token background computed as transparent despite its opacity utility class. Give reference tokens an explicit translucent green background.
- Regression checks cover delayed name hydration and visible tooltip content; production checks must inspect computed background and hover visibility after reload.

## Plain-text reference restoration
- Restore @filename references (including spaces and narrow no-break spaces), Untitled image/video, and whitespace-delimited @names even when selected-media metadata is absent. Prefer known media names, retain full text in serialization, and leave following prose untouched.
- While typing unknown references, keep plain text editable; restore compact tokens on blur. Existing tokens remain compact during subsequent edits. Email addresses are excluded by mention-boundary checks.
- Regression examples: @Screenshot 2026-09-14 at 4.45.24 PM.png 在跳舞; @设计一个女孩和一只小狗在玩耍 @Untitled image 在一起玩耍.
