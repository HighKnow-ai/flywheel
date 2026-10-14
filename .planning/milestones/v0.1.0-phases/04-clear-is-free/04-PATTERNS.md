# Phase 4: `/clear` Is Free - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 17 (new + modified)
**Analogs found:** 17 / 17 (all are extensions of already-shipped files, per RESEARCH.md's "extend, never replace" thesis — this phase introduces almost no genuinely new-role file)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/db/migrations/0008_session_summaries_and_revisions.sql` | migration | CRUD (schema) | `packages/core/src/db/migrations/0006_recovery_statuses.sql` (CHECK-rebuild) + `0002_board_schema.sql` (net-new table) | exact (two analogs, different halves of the same migration) |
| `packages/core/src/domain/session_summary.rs` (NEW: `create_summary`/`list_summaries`/`synthesize_fallback_summary`) | model/domain | CRUD + event-driven | `packages/core/src/domain/permission_request.rs` (`create_pending_request`) | exact |
| `packages/core/src/domain/acceptance_criterion.rs` (extend: `revise_criterion`) | model/domain | CRUD | same file's `create_criterion`/`toggle_criterion` | exact (in-file sibling) |
| `packages/core/src/domain/agent_run.rs` (extend: `apply_session_closed` fallback-summary check) | model/domain | event-driven | same file's existing `apply_session_closed` | exact (in-file extension) |
| `packages/core/src/git.rs` (extend: `diff_stat_and_names`) | utility | file-I/O (git shell) | same file's `git_status_porcelain` | exact |
| `packages/core/src/compaction.rs` (NEW) | utility/transform | transform (pure fold) | `packages/core/src/context_packet.rs` (pure-query purity contract, no I/O) | role-match (purity pattern, not CRUD) |
| `packages/core/src/drift.rs` (NEW) | utility/transform | transform (derive-at-read-time) | `packages/core/src/query/events.rs` (`activity_trail`/`events_since_cursor`) | exact (derive-at-read-time discipline) |
| `packages/core/src/context_packet.rs` (extend: packet gains summaries/compaction/diff/drift fields; `render_prompt` gains sections) | service/query | request-response | itself (existing `EpicSection`/criteria "omit heading" pattern) | exact (in-file extension) |
| `packages/core/tests/context_packet.rs` (extend determinism test) | test | request-response | itself (existing `determinism_two_calls...` test) | exact |
| `packages/core/tests/session_summary_lifecycle.rs` (NEW) | test | CRUD | `packages/core/tests/criteria.rs` | role-match |
| `packages/core/tests/compaction.rs` (NEW) | test | transform | none in-crate (pure-fold test is novel shape) | no analog — see below |
| `packages/core/tests/drift.rs` (NEW) | test | transform | none in-crate | no analog — see below |
| `packages/core/tests/five_cycle_reconstitution.rs` (NEW) | test | integration/batch | `packages/core/tests/context_packet.rs` (scaffold: `with_scratch_worktree_root`, `common::seeded_git_project`) | role-match |
| `packages/sidecar/src/mcp-permission-server.ts` (extend: second tool `report_summary`, second socket message kind) | controller/route (MCP tool server) | request-response | same file's own `approve_action` tool + notice-payload precedent | exact |
| `packages/sidecar/src/adapter.ts` / `claude-code-adapter.ts` (extend: relay `report_summary` as new `AgentEvent` variant; `AdapterCapabilities.supportsSummaryReporting`) | service/adapter | event-driven | same file's `SessionClosedEvent`/`GitRetryEvent` shape, `AdapterCapabilities` | exact |
| `packages/desktop/src-tauri/src/sidecar.rs` + `commands/agent_run.rs` (extend: reader-loop branch + domain handler call site for the new event) | controller (Tauri command/event dispatch) | event-driven | same files' existing `session_closed` branch / `handle_inbound_session_closed` | exact |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx` (extend: render summaries/compaction boundary/diff/drift) | component | request-response (preview render) | itself (`PacketBody`'s existing epic/criteria section pattern) | exact |
| `packages/desktop/src/session/SessionSurface.tsx` (extend: discard verb, D-66/D-67) | component | event-driven (session control) | itself (existing Stop verb / `StatusStrip`) | exact |
| `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` (extend: "revised" marker, D-79) | component | CRUD | itself (existing `toggleCriterion` mutation + `useQuery`/`invalidateQueries` shape) | exact |
| `packages/desktop/src/item-detail/RunsSection.tsx` (extend: render summaries, likely surface) | component | request-response | itself (existing `RunRow` embedded-list pattern) | exact |

## Pattern Assignments

### `packages/core/src/domain/session_summary.rs` (model, CRUD + event-driven)

**Analog:** `packages/core/src/domain/permission_request.rs`

**Imports pattern** (lines 1-25):
```rust
use anyhow::{bail, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::agent_run::{clear_run_blocked, set_run_blocked};
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
```
Adapt: `session_summary.rs` needs `new_id`, `append_event`/`next_sequence`, and a lookup into `agent_runs` for `task_id`/`project_id` — no `agent_run` blocked/unblocked calls needed (that's specific to permission requests).

**Core one-transaction write pattern** (lines 152-242, `create_pending_request`):
```rust
pub fn create_pending_request(
    conn: &mut Connection,
    agent_run_id: &str,
    tool_name: &str,
    input_payload: Option<&str>,
    actor_id: &str,
    destructive_category: Option<&str>,
) -> anyhow::Result<PermissionRequest> {
    let now = Utc::now().to_rfc3339();
    let id = new_id();
    let tx = conn.transaction()?;

    let (task_id, project_id): (String, String) = tx
        .query_row(
            "SELECT task_id, project_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    tx.execute(
        "INSERT INTO permission_requests (...) VALUES (...)",
        params![/* ... */],
    )
    .context("failed to insert permission_requests row")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({ "field": "...", "before": null, "after": id, "label": "..." });
    append_event(&tx, &project_id, "local", sequence, "permission_request", &id,
        Some(&task_id), None, actor_id, "permission_request.raised", &payload, &now)?;

    tx.commit().context("failed to commit create_pending_request transaction")?;
    Ok(PermissionRequest { /* ... */ })
}
```
**Copy this shape exactly** for `create_summary(conn, agent_run_id, changed_files, changed_prose, remains, next_session_must_know, decisions, actor_id) -> SessionSummary`: resolve `task_id`/`project_id` from `agent_runs` inside the tx, INSERT the `session_summaries` row, `next_sequence` + `append_event("session_summary", id, ..., "summary.reported", ...)`, one commit. D-64/D-65's four fields become the row's columns; the `run_id` MUST be resolved from the caller-supplied `agent_run_id` (itself derived at the sidecar/socket layer from connection context per RESEARCH.md Pattern 4 — never trust a client-supplied `task_id`).

**Error-as-typed-value pattern** (lines 47-93, `AlreadyAnsweredError`/`DestructiveAllowAlwaysRejected`):
```rust
#[derive(Debug, Clone, PartialEq)]
pub struct AlreadyAnsweredError { pub request_id: String }
impl std::fmt::Display for AlreadyAnsweredError { /* ... */ }
impl std::error::Error for AlreadyAnsweredError {}
```
Use this shape if `create_summary` needs a named, downcastable error (e.g. "a summary already exists for this agent_run_id" if D-01's exactly-one-summary-per-run rule needs enforcing at the write path rather than only by convention).

**append_event call signature** (verbatim, copy positional order exactly):
```rust
append_event(&tx, &project_id, "local", sequence, "<stream_type>", &id,
    Some(&task_id), None, actor_id, "<event_type>", &payload, &now)?;
```

---

### `packages/core/src/domain/acceptance_criterion.rs` — add `revise_criterion` (model, CRUD)

**Analog:** the same file's own `create_criterion` (lines 88-141) and module header (lines 1-12).

**Pattern to copy:** same one-`tx.transaction()` shape; INSERT a new row with a `revision` column and a `supersedes`/`revision_of` link, then an UPDATE marking the prior row `superseded` — both inside the same transaction, then `next_sequence`+`append_event` with event_type `criterion.revised`. The module's own doc comment ("Phase 4's revisioning is an additive column") is the authority for what column to add — do not invent a different shape.

```rust
// Source: packages/core/src/domain/acceptance_criterion.rs:78-141 (create_criterion) — the exact
// transaction/rank/insert/event/commit shape revise_criterion must follow, substituting an
// UPDATE ... SET superseded = 1 on the old row for the rank-tail lookup.
```

---

### `packages/core/src/domain/agent_run.rs` — extend `apply_session_closed` (model, event-driven)

**Analog:** the function itself, lines 385-458.

**Pattern:** the existing terminal-status branch/backfill logic (lines 429-454) is the template for "check something, and only write if it's missing." Add a summary-presence check (`SELECT 1 FROM session_summaries WHERE agent_run_id = ?1`) in the same spot, and if absent, call the new `synthesize_fallback_summary` inside the SAME transaction `close_agent_run` opens — mirroring how the backfill-figures branch reuses `close_agent_run`'s own transaction boundary rather than opening a second one.

```rust
// Source: packages/core/src/domain/agent_run.rs:429-454 — the exact
// "check existing state; write only the missing piece; never overwrite" shape to copy for the
// summary-presence check before firing D-64's auto_generated fallback.
```

---

### `packages/core/src/git.rs` — add `diff_stat_and_names` (utility, file-I/O)

**Analog:** `git_status_porcelain` (lines 140-143) — the exact "no parsing of its own" convention.

```rust
// Source: packages/core/src/git.rs:140-143 (verbatim)
pub fn git_status_porcelain(worktree_path: &Path) -> anyhow::Result<String> {
    let output = git_at(worktree_path, &["status", "--porcelain"])?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
```
Copy this exact one-line-body shape for `diff_stat_and_names(repo_path: &Path, base_ref: &str) -> anyhow::Result<(String, Vec<String>)>`: call `git_at(repo_path, &["diff", "--stat", &format!("{base_ref}...HEAD")])` for the stat text, and a second `git_at(repo_path, &["diff", "--name-only", &format!("{base_ref}...HEAD")])` for the path list — **never** a second `Command::new("git")` construction site (structurally enforced by `packages/core/tests/supervisor_cwd.rs`). Reuse the existing `git_status_porcelain` unchanged for D-70's uncommitted section rather than re-deriving it.

---

### `packages/core/src/context_packet.rs` — extend packet + `render_prompt` (service/query, request-response)

**Analog:** itself — the "omit the heading rather than emit an empty section" rule already used for `epic`/`criteria` (lines 208-231).

```rust
// Source: packages/core/src/context_packet.rs:219-231 (verbatim) — the exact "if not empty, emit
// heading + rows" shape every new section (summaries, compaction boundary, diff, drift warnings)
// must follow.
if !packet.criteria.is_empty() {
    out.push_str("\n## Acceptance Criteria\n\n");
    for criterion in &packet.criteria {
        out.push_str("- ");
        out.push_str(&criterion.statement);
        if let Some(hint) = &criterion.verification_hint {
            out.push_str(" (Verify: "); out.push_str(hint); out.push(')');
        }
        out.push('\n');
    }
}
```

**Purity contract to preserve** (lines 1-17, module header) — the diff fetch must NOT be added inside `assemble_context_packet` itself; it is composed one layer up by the caller (`agent_run_preview`/`agent_run_start` command handlers), per RESEARCH.md Pitfall 2 and Pattern 2. Add new fields to `ContextPacket` (summaries, compaction boundary, diff-stat, drift warnings) as plain data the caller populates and passes in, or thread them through a second argument to a packet-assembly wrapper — do not call `git_at`/`Command::new` from this file.

**Struct shape to copy** for new sections (`EpicSection` pattern, lines 36-40):
```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpicSection {
    pub title: String,
    pub description: Option<String>,
}
```

---

### `packages/sidecar/src/mcp-permission-server.ts` — add `report_summary` tool (controller/route, request-response)

**Analog:** the file's own `approve_action` tool registration and the `PermissionNoticePayload` fire-and-forget precedent (module doc lines 18-26, tool registration lines 234-295).

**Tool-list registration pattern** (lines 234-249):
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: APPROVE_TOOL_NAME,
      description: "Ask a human on the Flywheel board to allow or deny a gated tool call.",
      inputSchema: {
        type: "object",
        properties: { tool_name: { type: "string" }, input: {} },
        required: ["tool_name"],
      },
    },
    // NEW: { name: REPORT_SUMMARY_TOOL_NAME, description: "...", inputSchema: { changed, remains,
    //        next_session_must_know, decisions } — NEVER a run_id/task_id field (RESEARCH.md
    //        Pattern 4 / ASVS V4: derive from socket context, never accept as an argument) }
  ],
}));
```

**Call-handler branch pattern** (lines 251-291) — copy the `if (request.params.name !== X) throw` dispatch shape, add a second `case`/branch for the new tool name that writes over the SAME per-run socket with a distinct payload `kind` (mirroring `PermissionNoticePayload.kind`, lines 69-79) rather than opening a second socket.

**Naming-constant pattern** (lines 50-61) — declare `REPORT_SUMMARY_TOOL_NAME` / the fully-qualified `mcp__flywheel-permissions__report_summary` exactly once, the same way `PERMISSION_TOOL_NAME` composes from `APPROVE_TOOL_NAME` + `MCP_SERVER_NAME`.

---

### `packages/sidecar/src/adapter.ts` — new `AgentEvent` variant + capability flag

**Analog:** `SessionClosedEvent`/`GitRetryEvent` shape (lines 101-162) and `AdapterCapabilities` (lines 183-187).

```typescript
// Source: packages/sidecar/src/adapter.ts:183-187 (verbatim)
export interface AdapterCapabilities {
  supportsResume: boolean;
  supportsPermissionPrompt: boolean;
  supportsCostReporting: boolean;
}
```
Add `supportsSummaryReporting: boolean` following this exact convention (RESEARCH.md Pattern 3), and a `SummaryReportedEvent extends AgentEventBase` modeled on `GitRetryEvent`'s shape (lines 144-150) — carries `runId` from `AgentEventBase`, plus the four D-65 fields, added to the `AgentEvent` union (lines 168-180).

```typescript
// Source: packages/sidecar/src/adapter.ts:193-198 (verbatim) — the capability-gate rejection shape
export class CapabilityUnsupportedError extends Error {
  constructor(public readonly capability: keyof AdapterCapabilities) {
    super(`capability not supported: ${capability}`);
    this.name = "CapabilityUnsupportedError";
  }
}
```

---

### `packages/desktop/src-tauri/src/sidecar.rs` + `commands/agent_run.rs` — new event branch

**Analog:** the existing `session_closed` reader-loop branch (`sidecar.rs:1119-1132`) and `handle_inbound_session_closed` (`commands/agent_run.rs:548-561`).

```rust
// Source: packages/desktop/src-tauri/src/commands/agent_run.rs:557-561 (shape, paraphrased header)
pub fn handle_inbound_session_closed(app: &AppHandle, event: &serde_json::Value) {
    // ...
    let outcome = match flywheel_core::domain::agent_run::apply_session_closed(&mut conn, event) {
        // ...
    };
}
```
Copy this exact "reader-loop dispatches on `event.get("type")`, delegates the DB-only decision to a `flywheel_core::domain::*` function, keeps Tauri-facing side effects (emits) in the command layer" split for the new `summary_reported` event → `domain::session_summary::create_summary`.

---

### `packages/desktop/src/launch-sheet/LaunchSheet.tsx` — render new packet sections

**Analog:** itself, `PacketBody`'s existing per-section rendering (lines 66-80).

```typescript
// Source: packages/desktop/src/launch-sheet/LaunchSheet.tsx:66-80 (verbatim shape)
function PacketBody({ packet }: { packet: ContextPacketDto }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {packet.epicTitle && (
        <section>
          <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>Epic</div>
          <div className="type-body">{packet.epicTitle}</div>
          {packet.epicDescription && (
            <p className="type-body" style={{ color: "var(--text-muted-rack)", whiteSpace: "pre-wrap" }}>
              {packet.epicDescription}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
```
Add sibling `{packet.summaries.length > 0 && <section>...</section>}`, a compaction-boundary marker section, a diff-so-far section, and a drift-warning section — each gated on presence, matching the "omit rather than emit empty" rule this component and `render_prompt` both already use. `previewContextPacket` (line 24) is the read this sheet issues before Start Work — it must gain the new fields without becoming a mutation (still zero writes, per the file's own header comment).

---

### `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` — add "revised" marker

**Analog:** itself, the existing `toggleCriterion` mutation shape (lines 74-77).

```typescript
// Source: packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx:74-77 (verbatim)
const toggleCriterion = useMutation({
  mutationFn: (criterionId: string) => invokeCommand<CriterionDto>("criterion_toggle", { criterionId }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey }),
});
```
Add a `reviseCriterion` mutation following this identical `useMutation` + `invokeCommand` + `invalidateQueries` shape, calling a new `criterion_revise` Tauri command. Render the "revised" marker (D-79) as an inline quiet badge next to the row, expanding to the prior `statement` on interaction — no new list/section, extending the existing row render.

---

### `packages/desktop/src/item-detail/RunsSection.tsx` — likely summary-rendering surface

**Analog:** itself, the `RunRow` embedded-list pattern (lines 185-341) and the file's own "renders nothing when absent" discipline (lines 362-367).

```typescript
// Source: packages/desktop/src/item-detail/RunsSection.tsx:362-367 (verbatim) — E5 loading/empty
if (runsQuery.isPending) return null;
const runs = runsQuery.data ?? [];
if (runs.length === 0) return null;
```
If summaries render here, follow this exact "absence renders nothing, not a placeholder" convention, and mount a per-run summary excerpt the same way the blocked-run `PermissionRequestCard` mounts under its row (lines 295-299) — a small component under the specific run row it belongs to, not a separate top-level section.

## Shared Patterns

### One-transaction row-write-plus-event (DATA-01)
**Source:** `packages/core/src/domain/acceptance_criterion.rs` module header (lines 1-12) and `packages/core/src/domain/permission_request.rs` module header (lines 1-16).
**Apply to:** `session_summary.rs::create_summary`, `acceptance_criterion.rs::revise_criterion`, `agent_run.rs`'s fallback-summary write inside `apply_session_closed`.
```rust
// One conn.transaction(), the row write, next_sequence + append_event inside it, one commit.
// Never two transactions for one logical mutation; never an event appended outside the row's own tx.
```

### Derive-at-read-time, never store (D-16, D-75)
**Source:** `packages/core/src/query/events.rs` module header (lines 1-16), specifically: "the one-line human sentence `render_description` derived from `payload` at read time — never stored as its own column, always recomputed on read."
**Apply to:** `drift.rs`'s three detectors (D-72) — never write a verdict column; re-derive on every `assemble_context_packet` call, matching `EventRow.description`'s own recomputation.

### The one-and-only `Command::new("git")` site (PROC-02)
**Source:** `packages/core/src/git.rs` module header (lines 1-4), enforced by `packages/core/tests/supervisor_cwd.rs`.
**Apply to:** `diff_stat_and_names` — must live in `git.rs`, called via `git_at`, never a second construction site anywhere touching D-70/D-71.

### Capability-gated adapter methods
**Source:** `packages/sidecar/src/adapter.ts:183-198` (`AdapterCapabilities`, `CapabilityUnsupportedError`).
**Apply to:** `supportsSummaryReporting` — an adapter without it should expect only `auto_generated` fallback summaries, never an error path.

### Omit-the-heading-rather-than-emit-empty
**Source:** `packages/core/src/context_packet.rs:208-231` (`render_prompt`), mirrored client-side in `packages/desktop/src/item-detail/RunsSection.tsx:362-367` and `PacketBody` (LaunchSheet.tsx:66-80).
**Apply to:** every new packet section (summaries, compaction boundary, diff, drift warnings) and every new UI section rendering them.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/core/tests/compaction.rs` | test | transform | No existing test in this crate exercises a pure fold with zero database — closest shape is `git.rs`'s own `#[cfg(test)] mod git_version_tests` (pure-function unit tests, no `Connection` at all); use that module's plain-`#[test]`-function style as the structural template even though its subject differs. |
| `packages/core/tests/drift.rs` | test | transform | Same as above; no existing "three fact-based detectors" test exists yet. Structure it like `packages/core/tests/context_packet.rs`'s fixture setup (`common::seeded_git_project`) but assert on `Vec<DriftWarning>` rather than a single struct. |

## Metadata

**Analog search scope:** `packages/core/src/{domain,query}/*.rs`, `packages/core/src/{context_packet,git,compaction,drift}.rs`, `packages/core/src/db/migrations/*.sql`, `packages/core/tests/*.rs`, `packages/sidecar/src/{adapter,claude-code-adapter,mcp-permission-server,index}.ts`, `packages/desktop/src-tauri/src/{sidecar,commands/agent_run}.rs`, `packages/desktop/src/{launch-sheet/LaunchSheet,session/SessionSurface,item-detail/AcceptanceCriteriaList,item-detail/RunsSection}.tsx`
**Files scanned:** 12 read in full or targeted (context_packet.rs, git.rs, acceptance_criterion.rs [partial], permission_request.rs, agent_run.rs [targeted], query/events.rs, mcp-permission-server.ts, adapter.ts [targeted], migrations 0002/0006, RunsSection.tsx, AcceptanceCriteriaList.tsx [partial], LaunchSheet.tsx [partial])
**Pattern extraction date:** 2026-09-23
