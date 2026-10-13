## Deferred Items

- `packages/sidecar/test/adapter.test.mjs`'s "normalised events for the fake CLI's stream arrive
  in source order with contiguous seq values" fails deterministically on baseline (verified by
  stashing every 03-13 change and rebuilding `dist/` before re-running it in isolation — still
  `expected at least 4 events, got 2`). Pre-existing, unrelated to plan 03-13's shim-notice work;
  out of scope for this plan per the scope-boundary rule (not caused by any file this plan
  touches). Worth a dedicated debugging session — `fake-claude.mjs`'s stream may be exiting early
  or the reader loop may be missing lines under some timing condition.
  status: open

- `packages/sidecar/test/permission.test.mjs` (5 of 7 tests) also fails deterministically on an
  unmodified checkout in this execution environment (verified the same way — full stash, clean
  `dist/` rebuild, still fails identically). Every failing case spawns the real MCP round trip
  (`fake-claude.mjs` -> the standalone `mcp-permission-server.js` process -> back over the socket)
  and times out in `waitForCondition`; the two that pass never reach that round trip. Looks like an
  environment/sandbox constraint on this machine (grandchild-process or stdio-transport spawning)
  rather than a code regression — plan 03-13 required `startPermissionServer`'s signature to gain a
  second, mandatory `onNotice` parameter (Task 1), and `claude-code-adapter.ts`'s one call site
  was updated to supply it, so no caller is left on the old 1-arg form. Out of scope to chase
  further here; flagging so a future session with different sandboxing doesn't miss it.
  status: open

- The single required end-of-plan full `npm --prefix packages/sidecar test` run (55 tests) showed
  38 passed / 16 failed / 1 cancelled. Every failure is in `shutdown.test.mjs`, `stop.test.mjs`,
  `permission.test.mjs` or `destructive-gate.test.mjs` — files plan 03-13 never touches (verified
  by grep: the only test file calling `startPermissionServer` directly is `adapter.test.mjs`'s own
  new coverage, which passes) — and every one spawns a real cooperative child/grandchild process
  and waits on a signal or a live MCP round trip (`waitForCondition timed out` in 15 of the 16; one
  is a `stop.test.mjs` assertion mismatch on an already-timing-out fixture). Consistent with the
  two smaller, independently-reproduced-on-a-clean-stash failures recorded above (adapter.test.mjs
  and permission.test.mjs): this execution environment appears constrained around
  grandchild-process spawning/signalling, not a code regression from this plan's diff. Not re-run
  a second time (cost + the instruction to run the full suite at most once); a future session in a
  different sandbox should re-verify with a clean checkout before assuming this list is exhaustive.
  status: open
