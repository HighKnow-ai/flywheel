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
