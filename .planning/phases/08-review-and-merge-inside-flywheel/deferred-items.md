# Phase 08 deferred items

Out-of-scope discoveries logged by executors. Not fixed by the plan that found them.

## Found during 08-14

- **`packages/core/tests/credentials.rs` `resolve_credential_falls_back_to_the_global_default_without_a_project_override`
  fails on this machine.** Panics at `credentials.rs:373`: "api_key mode with no key stored must error,
  not silently resolve local" — the resolver returned `ApiKey` with `ANTHROPIC_API_KEY`, so a key is
  already present in the developer's real keychain. Environmental (the test assumes an empty keychain),
  unrelated to the forge draft hash. The 19 other tests in that binary pass. The test also takes ~140s.
- **`tsc --noEmit` reports 3 pre-existing `RegExp`-where-`string | number`-expected errors**, not the 2 the
  plan states: `item-detail/__tests__/forge-section.test.tsx` (1) and
  `settings/__tests__/settings-surface.test.tsx` (2). Unchanged by 08-14.
- **Follow-up (named in 08-14-PLAN.md): apply the same `draftChanged` guard to `forge_open_request`**
  (the Phase 7 task request, `item-detail/ForgeSection.tsx`). `RequestDraft::content_hash` and
  `RequestDraftDto.contentHash` already serve it; the change is a signature parameter and a comparison.
