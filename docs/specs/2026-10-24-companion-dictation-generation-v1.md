# Companion dictation to generation

Realtime conversation is paused by user direction. All composer modes use the existing browser speech-recognition hook, with explicit consent and final text retained for editing. Recognition never sends chat or starts paid generation automatically. Chat/image/video drafts remain independent. Image/video send opens existing reference/parameter/review cards; paid submission still requires model selection and explicit confirmation. Preserve existing realtime implementation but remove it from the composer entry. Browser dictation depends on browser service availability; unsupported/permission errors retain manual text input. No provider ASR or fallback introduced. Reference-media generation transport remains outside this slice.

Verification: composer consent/dictation/stop/cleanup tests; integrated image/video cases starting from mocked browser recognition through actual AgentChat cards and generation submission/result; no calls before explicit confirmation; existing chat/generation/voice regressions; isolated static build and demo artifact verification. No personal photos or paid generation needed for automated verification.

## Validation

33 UI tests pass across actual AgentChat, composer, generation guide/submit, channel settings and shared dictation. Two new integration cases drive mocked SpeechRecognition through image and video modes, editable text, send, parameters, model selection, explicit paid consent, completed result blob, and cleanup. Neither text chat nor generation is invoked by recognition alone. No paid image/video generation or real browser microphone was exercised by these automated tests; device/browser dictation and live channel generation remain user validation.

Isolated static export passes. Separate TypeScript check reports only the two pre-existing ReferenceCandidate.description errors in CharacterWorkbench.tsx:404 and1275. Frontend deployed to the existing Companion test site chunks-first; backend unchanged. Public HTML and the composer-containing chunk match local artifact bytes. HTML SHA25620d4142c0245be4c4e0ae263a1d0fbe69334ac2b875502c432c69870522b545e; chunk2088.24404daca9b203c0.js SHA2567b420c562f37adf22459527fed65290d302445f5a0ee71cb2636c3195f5ba5f1. No push or merge.

## Submitted prompt cleanup

User observed the previous media instruction remaining in the composer and being appended to by subsequent dictation. Code fact: media submit copied the prompt to GenerationDraft without clearing that mode's text draft. Clear only the submitted mode after validation and guide creation; keep the prompt in the guide. Edit/cancel restores the guide prompt to the composer. Rejected inputs stay unchanged; other mode drafts remain independent. Image/video integration tests first failed on the stale input, then passed with clear/edit/cancel assertions.27 composer/chat/integration tests pass. No backend or recognition-provider changes.

Cleanup follow-up static export passed; separate typecheck still reports only the two known CharacterWorkbench errors. Deployed frontend chunks-first. Public HTML and changed chunk2088.28769d5ace268743.js match local bytes; HTML SHA25640a98a607cac76d022c0233315e379723088dfa2504992db7dcbfae709bd09a8.

## Bare creation request clarification

“生成一张图片” expresses intent without scene content. A complete, anchored match for common bare creation requests must ask for the subject/action/environment before opening parameter cards. Clear the consumed command from the composer, preserve mode and selected attachments, and accept the next dictated or typed description. Do not strip creation words from substantive prompts or infer unspecified scenes. This is a bounded local guard for explicit empty-content commands, not general semantic intent recognition. Two integration regressions first reproduced the bad guide creation for image/video, then verify clarification and subsequent dictation. No auto-generation and no changes to model adapters.

Clarification follow-up:38 related tests pass. Static export passes; separate TypeScript check reports only the existing two CharacterWorkbench errors. Frontend deployed chunks-first; public HTML and changed chunk2088.ccad6d5090d5025a.js match built bytes. HTML SHA256e9fc4643d42404c1bee205d6445778d38158d0c50b5488ee48e87dbcbabcf418. Existing already-submitted jobs are not canceled by this frontend correction.

## Modification-intent clarification correction

User phrase “嗯我要优化一张图片” bypassed the creation-only guard. This was a coverage gap, not evidence of stale deployment. Extend complete-request matching to hesitation prefixes and intent-only editing/own-photo requests. Ask for concrete changes, retain selected attachment IDs, clear the consumed command, and accept the next instruction. Preserve prompts containing actual edits (e.g. change background to park, brighten photo). An integration test first reproduced the reported phrase with a selected album photo, then verifies clarification and photo retention. The guard remains bounded phrase recognition, not a semantic model; general intent ambiguity remains outside this local correction. Reference-media submission is still explicitly unavailable in GenerationSubmit; this change does not enable or imply a working image-edit adapter.

Modification follow-up:41 related tests pass. Static export passes; separate typecheck reports only the two known CharacterWorkbench errors. Deployed frontend chunks-first; public HTML and changed chunk2088.888cc0fe13534d1f.js match local bytes. HTML SHA25673735f751ea21235c592faa2a9e78592b8c5a3dd0685e8e894f31e3e62890576.

## 相册导航指令边界（2026-10-24）

复现：图片模式输入“把相册打开”被当作生成描述，进入参考图引导；聊天模式未授权时还会先弹出文字发送授权。

修复：仅完整匹配独立相册导航命令，在三种输入模式统一执行本地打开相册；消费并清空命令，保留模式、已有创作引导和附件。选中照片仍加入当前模式的待发送区。该本地动作不发送聊天文字、不调用生成，也不需要外发文字授权。复合指令与场景描述不走该规则；这不是完整语义路由。

验证：先新增三模式集成测试，修复前均失败；补充独立导航与描述/否定/复合指令边界测试。部署与检查结果见本节后续记录。

检查结果：相关集成/组件测试 49 项及命令边界测试 9 项通过，共 58 项；静态构建成功。构建后类型检查仅报既有 CharacterWorkbench.tsx:404/1275 的 ReferenceCandidate.description 两处错误。测试站已更新，公网 HTML 及 9613.810ea93da1ba96c9.js 与本地构建逐字节一致；尚未进行真实浏览器交互回归。仅提交本次变更，不推送/合并。
