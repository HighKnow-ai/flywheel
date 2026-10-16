# DRFT-12 - live account-limit observation

**Captured** 2026-10-16T10:00:21.621Z / **run** `01M520Z9XFE2XSAPFZQQ0994RF` / **claude** 2.1.292 (Claude Code) / **lanes** 4 (`spawns: [2,1,1,2]`)

## Verdict

**Criterion 6 is NOT CLOSED.** The observed tier was `warning`, not `rejected`. Per D-32 only
the `Rejected` tier - the unexercised one, and the one that pauses new dispatch - closes this
criterion; a `warning` observation does not. No replay fixture was generated, because the fixture
exists only for a real rejection, and `packages/core/src/limit_gate.rs`'s module-header sentence
that no hard limit has ever been observed in this project remains true and remains in place.

What this run *does* establish, against a real backend rather than a constructed shape:

- a real session-limit signal was received and normalised (clause a, at the `warning` tier);
- it was backed off from rather than retried blindly (clause b);
- it surfaced in the run's own gate state, not in an `agent_runs.status` write (clause c);
- the measurement is recorded - this file (clause d).

The burn reached **0.15** of the five-hour window with 4 lanes over 25 minutes. Reaching
`Rejected` by this route needs roughly six to seven times that dose. See
`scripts/uat/README.md` section "Item 8b".

## The four D-33 items

| Item | Value |
|---|---|
| Normalised tier | `warning` |
| Wire shape that carried it | `rate_limit` event |
| Window named by the backend | `seven_day` |
| Reported reset instant | `1792411200` |
| Observation instant | 2026-10-16T10:00:14.816Z |
| Gate state before -> after | `open` -> `warning` |
| `dispatch.gate_changed` events | 1 |
| `agent_runs.status` written | no |

## Capture, verbatim

Everything in the block below is the unmodified JSON `uat-15-account-limit.mjs --live` wrote at
this path. No byte of it was hand-edited; the prose sections of this file were added around it,
and the script now emits the verdict itself so a future capture needs no such wrapper.

```json
{
  "capturedAt": "2026-10-16T10:00:21.621Z",
  "startedAt": "2026-10-16T09:33:59.358Z",
  "claudeVersion": "2.1.292 (Claude Code)",
  "runId": "01M520Z9XFE2XSAPFZQQ0994RF",
  "sessions": 4,
  "spawns": [
    2,
    1,
    1,
    2
  ],
  "firstEventRaw": "{\"type\":\"system\",\"subtype\":\"init\",\"cwd\":\"/private/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-uat-15-live-uMJjV3/worktrees/LIM/LIM-1\",\"session_id\":\"2c33a206-e2c8-412c-9ff5-0b3550724617\",\"tools\":[\"Task\",\"AskUserQuestion\",\"Bash\",\"CronCreate\",\"CronDelete\",\"CronList\",\"DesignSync\",\"Edit\",\"EnterPlanMode\",\"EnterWorktree\",\"ExitPlanMode\",\"ExitWorktree\",\"ListAgents\",\"Monitor\",\"NotebookEdit\",\"PushNotification\",\"Read\",\"RemoteTrigger\",\"ReportFindings\",\"ScheduleWakeup\",\"SendMessage\",\"Skill\",\"TaskStop\",\"ToolSearch\",\"WebFetch\",\"WebSearch\",\"Workflow\",\"Write\",\"mcp__claude_ai_Claude_Docs__batch\",\"mcp__claude_ai_Claude_Docs__create\",\"mcp__claude_ai_Claude_Docs__delete\",\"mcp__claude_ai_Claude_Docs__export\",\"mcp__claude_ai_Claude_Docs__guide\",\"mcp__claude_ai_Claude_Docs__query\",\"mcp__claude_ai_Claude_Docs__read\",\"mcp__claude_ai_Claude_Docs__update\",\"mcp__flywheel-permissions__amend_proposal\",\"mcp__flywheel-permissions__board_search\",\"mcp__flywheel-permissions__delete_proposal\",\"mcp__flywheel-permissions__epic_get\",\"mcp__flywheel-permissions__proposal_list\",\"mcp__flywheel-permissions__propose_assumption\",\"mcp__flywheel-permissions__propose_criterion\",\"mcp__flywheel-permissions__propose_epic\",\"mcp__flywheel-permissions__propose_item\",\"mcp__flywheel-permissions__propose_task\",\"mcp__flywheel-permissions__report_summary\",\"mcp__flywheel-permissions__submit_plan\",\"mcp__flywheel-permissions__task_list\"],\"mcp_servers\":[{\"name\":\"flywheel-permissions\",\"status\":\"connected\",\"source\":\"dynamic\"},{\"name\":\"claude.ai Claude Docs\",\"status\":\"connected\",\"source\":\"claudeai\"}],\"model\":\"claude-opus-5-5\",\"permissionMode\":\"bypassPermissions\",\"slash_commands\":[\"deep-research\",\"design\",\"design-sync\",\"dataviz\",\"update-config\",\"verify\",\"debug\",\"code-review\",\"simplify\",\"batch\",\"fewer-permission-prompts\",\"doctor\",\"loop\",\"anthropic-skills:docs\",\"anthropic-skills:google-workspace\",\"anthropic-skills:computer-use\",\"anthropic-skills:chrome-browser\",\"anthropic-skills:built-in-browser\",\"anthropic-skills:deep-research\",\"anthropic-skills:import-memory\",\"anthropic-skills:morning\",\"anthropic-skills:skill-creator\",\"anthropic-skills:xlsx\",\"anthropic-skills:pptx\",\"anthropic-skills:pdf\",\"anthropic-skills:docx\",\"schedule\",\"claude-api\",\"workflow-authoring\",\"run\",\"run-skill-generator\",\"plugin-authoring\",\"advisor\",\"agents\",\"auto-mode-setup\",\"autocompact\",\"clear\",\"color\",\"compact\",\"config\",\"output-style\",\"context\",\"effort\",\"fast\",\"focus\",\"heapdump\",\"init\",\"mcp\",\"import\",\"model\",\"__remote-workflow\",\"workflow-launch-exec\",\"reload-plugins\",\"reload-skills\",\"rename\",\"ultrareview\",\"security-review\",\"usage-credits\",\"extra-usage\",\"usage\",\"insights\",\"recap\",\"skill-doctor\",\"goal\",\"design-consent\",\"design-revoke\",\"list-agents\",\"team-onboarding\"],\"terminal_slash_commands\":[\"doctor\",\"color\",\"focus\",\"reload-plugins\"],\"apiKeySource\":\"none\",\"claude_code_version\":\"2.1.292\",\"output_style\":\"default\",\"agents\":[\"claude\",\"Explore\",\"general-purpose\",\"Plan\",\"statusline-setup\"],\"skills\":[\"deep-research\",\"design\",\"design-sync\",\"dataviz\",\"update-config\",\"verify\",\"debug\",\"code-review\",\"simplify\",\"batch\",\"fewer-permission-prompts\",\"doctor\",\"loop\",\"anthropic-skills:google-workspace\",\"anthropic-skills:morning\",\"anthropic-skills:skill-creator\",\"anthropic-skills:xlsx\",\"anthropic-skills:pptx\",\"anthropic-skills:pdf\",\"anthropic-skills:docx\",\"schedule\",\"claude-api\",\"workflow-authoring\",\"run\",\"run-skill-generator\",\"plugin-authoring\",\"anthropic-skills:built-in-browser\",\"anthropic-skills:chrome-browser\",\"anthropic-skills:computer-use\",\"anthropic-skills:deep-research\",\"anthropic-skills:docs\",\"anthropic-skills:import-memory\"],\"plugins\":[{\"name\":\"cc-plugin-agents-md\",\"path\":\"builtin\",\"source\":\"cc-plugin-agents-md@builtin\"},{\"name\":\"cc-plugin-telemetry\",\"path\":\"builtin\",\"source\":\"cc-plugin-telemetry@builtin\"},{\"name\":\"cc-plugin-plugin-authoring\",\"path\":\"builtin\",\"source\":\"cc-plugin-plugin-authoring@builtin\"}],\"capabilities\":[\"interrupt_receipt_v1\",\"interrupt_cancel_queued_v1\",\"interrupt_send_now_v1\",\"msg_lifecycle_v1\",\"sdk_mcp_tools_list_changed\",\"sdk_mcp_manifests\",\"mcp_read_resource_v1\",\"mcp_tool_ui_meta_v1\",\"ui_surface_v1\"],\"analytics_disabled\":false,\"product_feedback_disabled\":false,\"uuid\":\"14c667d9-0e01-424c-9fa8-cdcc808df804\",\"memory_paths\":{\"auto\":\"/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-uat-15-live-uMJjV3/claude-config/projects/-private-var-folders-3x-b6p583x9491-v7qmnf087j580000gn-T-flywheel-uat-uat-15-live-uMJjV3-repo/memory/\"},\"messaging_socket_path\":\"/tmp/cc-socks/82734.sock\",\"fast_mode_state\":\"off\",\"fast_mode_disabled_reason\":\"sdk_opt_in_required\",\"per_turn_effort_active\":true,\"view_mode\":\"default\"}",
  "rawLines": [
    "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed_warning\",\"resetsAt\":1792411200,\"rateLimitType\":\"seven_day\",\"utilization\":0.75,\"isUsingOverage\":false,\"unifiedWindows\":{\"five_hour\":{\"utilization\":0.15,\"resetsAt\":1792157400},\"seven_day\":{\"utilization\":0.75,\"resetsAt\":1792411200}}},\"uuid\":\"a6ffca3d-646f-4c9c-8888-2f80ff32dbce\",\"session_id\":\"2c33a206-e2c8-412c-9ff5-0b3550724617\"}"
  ],
  "aroundTheRejection": [],
  "observedTiers": [
    {
      "at": "2026-10-16T10:00:14.816Z",
      "runId": "01M520Z9XFE2XSAPFZQQ0994RF",
      "type": "rate_limit",
      "tier": "warning",
      "window": "seven_day",
      "resetsAt": 1792411200
    }
  ],
  "gateTransition": {
    "after": {
      "resets_at": 1792411200,
      "state": "warning",
      "window": "seven_day"
    },
    "before": {
      "state": "open"
    },
    "changed": true,
    "gateEvents": 1,
    "mayAdvance": false,
    "maySpawn": true,
    "message": "Approaching the usage limit (seven_day): the running wave will finish and the next will not start on its own.",
    "signal": {
      "resetsAt": 1792411200,
      "tier": "warning",
      "window": "seven_day"
    },
    "statusesAfter": [
      {
        "id": "01M520Z9XFE2XSAPFZQQ0994RF",
        "status": "running"
      }
    ],
    "statusesBefore": [
      {
        "id": "01M520Z9XFE2XSAPFZQQ0994RF",
        "status": "running"
      }
    ]
  }
}
```
