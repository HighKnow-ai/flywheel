/**
 * The shim's two pure classification modes, `--classify-command` and `--classify-invocation`
 * (`packages/shim/src/main.rs`), driven against the compiled `flywheel-shim` binary. Both modes are
 * side-effect-free: they print a verdict and never execute the command they classify.
 *
 * These tests used to share a file with the "prove interception" hook's tests. That hook was
 * deleted (ADR 0001). The shim and its classifier are reshaped into a deny-list in a later
 * Milestone, so until then these tests pin the shim's current behaviour unchanged.
 *
 * Skips visibly when the shim binary has not been built (`cargo build --workspace`).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the compiled `flywheel-shim` binary under the workspace's `target/{debug,release}/`.
 * `undefined` — never a throw — when neither exists. */
function resolveShimBinaryForTest() {
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  const binName = process.platform === "win32" ? "flywheel-shim.exe" : "flywheel-shim";
  for (const profile of ["debug", "release"]) {
    const candidate = path.join(workspaceRoot, "target", profile, binName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const SHIM_BIN = resolveShimBinaryForTest();
const SHIM_SKIP_REASON = SHIM_BIN
  ? undefined
  : "the compiled flywheel-shim binary was not found under target/{debug,release} — run `cargo build --workspace` first";

if (SHIM_SKIP_REASON) {
  console.log(`[shim-classify.test.mjs] SKIPPED (shim-binary tests): ${SHIM_SKIP_REASON}`);
}

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-shim-classify-"));
}

// --- classify-command mode: pure, side-effect-free, no live network call needed ---

test(
  "the shim's --classify-command mode prints a category and performs no execution",
  { skip: SHIM_SKIP_REASON },
  () => {
    const dir = scratchDir();
    const victim = path.join(dir, "victim.txt");
    fs.writeFileSync(victim, "still here");

    const result = spawnSync(SHIM_BIN, ["--classify-command", `rm -rf ${victim}`], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "recursive-delete");
    // The observable side effect: classify-command never executes anything, so the file it just
    // classified as a recursive-delete target must still be exactly where it was.
    assert.ok(fs.existsSync(victim), "classify-command mode must never execute the command it classifies");

    const safeResult = spawnSync(SHIM_BIN, ["--classify-command", "git status"], { encoding: "utf8" });
    assert.equal(safeResult.status, 0);
    assert.equal(safeResult.stdout.trim(), "safe");
  },
);

// --- classify-invocation mode (plan 03-19 Task 1): same classifier, plus interception facts ---

test(
  "the shim's --classify-invocation mode reports program and bare-name status for a destructive verdict",
  { skip: SHIM_SKIP_REASON },
  () => {
    const runInvocation = (text) => {
      const result = spawnSync(SHIM_BIN, ["--classify-invocation", text], { encoding: "utf8" });
      return { status: result.status, parsed: JSON.parse(result.stdout.trim()) };
    };

    // Bare name — the class the shim's own PATH-shadowed directory could intercept.
    const bareName = runInvocation("git push origin --delete x");
    assert.equal(bareName.status, 0);
    assert.deepEqual(bareName.parsed, { category: "branch-deletion", program: "git", invokedBareName: true });

    // Absolute path — never resolves through a PATH-shadowed directory, so it cannot be intercepted.
    const absolutePath = runInvocation("/usr/bin/git push --force");
    assert.equal(absolutePath.status, 0);
    assert.deepEqual(absolutePath.parsed, { category: "force-push", program: "git", invokedBareName: false });

    // A safe command carries no program/invokedBareName fields — it now carries the two D-61 text
    // facts instead (plan 03-24).
    const safe = runInvocation("git status");
    assert.equal(safe.status, 0);
    assert.deepEqual(safe.parsed, { category: "safe", textCanShadowPathResolution: false, namesGatedProgram: true });
  },
);

test(
  "the shim's --classify-invocation mode fails closed on a missing argument",
  { skip: SHIM_SKIP_REASON },
  () => {
    const result = spawnSync(SHIM_BIN, ["--classify-invocation"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { category: "uncategorized", invokedBareName: false });
  },
);

test(
  "--classify-command's output is unchanged by the --classify-invocation mode's addition",
  { skip: SHIM_SKIP_REASON },
  () => {
    const result = spawnSync(SHIM_BIN, ["--classify-command", "git push origin --delete x"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "branch-deletion");
  },
);

// --- --classify-invocation shadow detection (quick task 260920-duy, CR-01): the classifier, not the
// hook, refuses to call a shadowable invocation bare-name. Table A below is the structural proof
// that this detection shipped in Rust: the hook is not in this call path at all. ---

test(
  "the shim's --classify-invocation mode reports invokedBareName:false for every text that can divert name resolution away from PATH",
  { skip: SHIM_SKIP_REASON },
  () => {
    const runInvocation = (text) => {
      const result = spawnSync(SHIM_BIN, ["--classify-invocation", text], { encoding: "utf8" });
      return JSON.parse(result.stdout.trim());
    };
    const FORCE_SHADOWED = { category: "force-push", program: "git", invokedBareName: false };

    // Control: an ordinary bare invocation must STILL be deferrable, or the fix has simply
    // destroyed the ask that 03-19 delivered rather than narrowing it.
    assert.deepEqual(runInvocation("git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });
    assert.deepEqual(runInvocation("git push origin --delete x"), {
      category: "branch-deletion",
      program: "git",
      invokedBareName: true,
    });

    // The measured bypasses (CR-01).
    assert.deepEqual(runInvocation('git() { /usr/bin/git "$@"; }; git push --force'), FORCE_SHADOWED);
    assert.deepEqual(runInvocation('function git { /usr/bin/git "$@"; }; git push --force'), FORCE_SHADOWED);
    // The space-before-parens spelling classifies on its FIRST segment instead (measured: `git ()`
    // tokenizes as program `git` with subcommand `()`, which classify_git already calls
    // uncategorized). Still destructive, still a deny — assert what it actually is, not what
    // symmetry suggests.
    assert.deepEqual(runInvocation('git () { /usr/bin/git "$@"; }; git push --force'), {
      category: "uncategorized",
      program: "git",
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation("alias git=/usr/bin/git; git push --force"), FORCE_SHADOWED);
    assert.deepEqual(runInvocation("hash -p /usr/bin/git git; git push --force"), FORCE_SHADOWED);
    assert.deepEqual(runInvocation("PATH=/usr/bin git push --force"), FORCE_SHADOWED);
    assert.deepEqual(runInvocation('rm() { /bin/rm "$@"; }; rm -rf /tmp/x'), {
      category: "recursive-delete",
      program: "rm",
      invokedBareName: false,
    });

    // Not triggers: these still reach a real PATH search, so the shim still catches them.
    // (Both measured true today — they must stay true, or the detection has over-triggered.)
    assert.deepEqual(runInvocation("(cd sub && git push --force )"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });
    assert.equal(runInvocation("echo $(git rev-parse HEAD) && git push --force").invokedBareName, true);
    assert.deepEqual(runInvocation("git status"), {
      category: "safe",
      textCanShadowPathResolution: false,
      namesGatedProgram: true,
    });
    assert.deepEqual(runInvocation("GIT_AUTHOR_NAME=x git status"), {
      category: "safe",
      textCanShadowPathResolution: false,
      namesGatedProgram: true,
    });
  },
);

// --- --classify-invocation `command`/`builtin` unwrap (03-REVIEW.md new CR-01, round 2): the
// CR-01 fix above narrowed `invokedBareName` correctly but never taught
// `resolve_segment_program_index` to see through a `command`/`builtin` prefix, so the segment's
// program token resolved to the wrapper word itself (never `git`/`rm`), which `classify()` has no
// opinion on and reports `Safe` — a silent, zero-verification bypass, not merely an
// under-verified defer. Reproduced directly against the compiled binary before this fix:
// `--classify-invocation "command git push --force"` returned `{"category":"safe"}`. ---

test(
  "the shim's --classify-invocation mode unwraps a leading command/builtin prefix instead of misclassifying the wrapper word as the program",
  { skip: SHIM_SKIP_REASON },
  () => {
    const runInvocation = (text) => {
      const result = spawnSync(SHIM_BIN, ["--classify-invocation", text], { encoding: "utf8" });
      return JSON.parse(result.stdout.trim());
    };

    // `command <prog>` still performs a real PATH search (only functions/aliases are bypassed),
    // so this is exactly where the shim sits — invokedBareName stays true.
    assert.deepEqual(runInvocation("command git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });

    // `command -p <prog>` forces bash to search a hardcoded default PATH that can never contain
    // this shim's per-run shadow directory — an unconditional, environment-independent bypass.
    assert.deepEqual(runInvocation("command -p git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });

    // `builtin <prog>` never performs a PATH search at all when <prog> is not itself a shell
    // builtin (git is not), so the shim can never be reached — the category must still be
    // reported (never "safe"), with invokedBareName forced false.
    assert.deepEqual(runInvocation("builtin git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });

    // Combinations: `command`/`env` nest in either order and still resolve to the real program,
    // reaching a genuine PATH search (invokedBareName stays true) as long as nothing else in the
    // text can divert resolution.
    assert.deepEqual(runInvocation("command env git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });
    assert.deepEqual(runInvocation("env command git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });

    // Ambiguous/ill-formed combination: `command PATH=/tmp git …` is not how bash actually applies
    // a temporary PATH override to `command`'s own target (measured: real bash tries to exec a
    // literal program named "PATH=/tmp" and fails), but the pre-existing global `PATH=` substring
    // trigger already fails this closed regardless of position — asserted here so a future change
    // to that trigger cannot silently widen this gap back open.
    assert.deepEqual(runInvocation("command PATH=/tmp git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });

    // A function-shadow present ANYWHERE in the text still forces the conservative reading even
    // though `command` itself would correctly bypass that specific shadow for its own target —
    // over-triggering (deny-instead-of-ask) is the accepted cost, per this file's own documented
    // philosophy, not a regression.
    assert.deepEqual(
      runInvocation('git() { /usr/bin/git "$@"; }; command git push --force'),
      { category: "force-push", program: "git", invokedBareName: false },
    );

    // A `command`-wrapped safe command is still safe — the unwrap must not turn every `command`
    // invocation destructive by construction.
    assert.deepEqual(runInvocation("command git status"), {
      category: "safe",
      textCanShadowPathResolution: false,
      namesGatedProgram: true,
    });

    // `command -v`/`command -V` are QUERY forms — they print/describe where `git` would resolve
    // and never execute it, unlike every other shape above. Grouping them with `-p` (as an earlier
    // pass here did, on the reasoning that neither takes a separate argument) conflated
    // tokenization with the execute-vs-report security property and made a harmless lookup
    // destructive. `scripts/uat/uat-05-concurrent-commits.mjs` and `scripts/uat/README.md` both
    // rely on `command -v git` resolving to the shim directory as PROOF of shim installation
    // (03-VERIFICATION.md Success Criterion 4) — that harness has nobody to answer a permission
    // request, so this must stay `safe` or the harness breaks. `namesGatedProgram` is still `true`
    // (plan 03-24) — the raw-text scan is text-based, not execution-aware, and the hook only
    // denies a safe verdict when BOTH text facts hold, so a mention with no shadow construct still
    // defers.
    assert.deepEqual(runInvocation("command -v git"), {
      category: "safe",
      textCanShadowPathResolution: false,
      namesGatedProgram: true,
    });
    assert.deepEqual(runInvocation("command -V git"), {
      category: "safe",
      textCanShadowPathResolution: false,
      namesGatedProgram: true,
    });

    // `command -p` is unaffected: it still forces execution under a hardcoded default PATH.
    assert.deepEqual(runInvocation("command -p git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });
  },
);

// --- --classify-invocation `env` flag audit (coordinator review, round 4): the round-2 `env`
// unwrap only ever skipped NAME=VALUE assignments, never env's OWN flags, so `env -i git push
// --force` (clears PATH entirely — the shim's shadow directory can never be reached, exactly the
// `command -p` double-failure class) and `env -S "…"` (embeds an entire, separately-parsed
// argument list, including possible `PATH=` overrides, inside one opaque string this tokenizer
// cannot safely re-parse) both silently classified as `{"category":"safe"}` before this fix. ---

test(
  "the shim's --classify-invocation mode handles env's own flags — -i/-u PATH force invokedBareName:false, -S and unknown flags fail closed, -u <other> is unaffected",
  { skip: SHIM_SKIP_REASON },
  () => {
    const runInvocation = (text) => {
      const result = spawnSync(SHIM_BIN, ["--classify-invocation", text], { encoding: "utf8" });
      return JSON.parse(result.stdout.trim());
    };

    // `env -i` clears the ENTIRE environment (including PATH) before the target runs — the shim's
    // shadow directory can never be on whatever PATH (if any) the target ends up seeing. Still
    // classified on the real program (never "safe"), with invokedBareName forced false.
    assert.deepEqual(runInvocation("env -i git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });

    // `env -u PATH` unsets PATH specifically — the same effective bypass as `-i`.
    assert.deepEqual(runInvocation("env -u PATH git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation("env --unset=PATH git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });

    // `env -u <anything else>` leaves PATH untouched — the shim is reached exactly as a plain
    // `env git …` would be. This is the case that must NOT regress to a blanket "any -u is unsafe"
    // over-trigger: the whole point of distinguishing the NAME is that most -u usage is harmless.
    assert.deepEqual(runInvocation("env -u FOO git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });

    // Multiple -u flags: PATH anywhere in the run triggers, regardless of position, and a run with
    // no PATH among them does not.
    assert.deepEqual(runInvocation("env -u FOO -u PATH git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation("env -u PATH -u FOO git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation("env -u FOO -u BAR git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });

    // `env -S`/`--split-string` embeds an entire, separately-parsed argument list (including
    // possible PATH= overrides) inside one opaque string — this tokenizer cannot safely re-parse
    // it a second time, so the whole invocation fails closed to Uncategorized/un-interceptable
    // rather than being treated as either "safe" or a confidently-identified "git" invocation.
    assert.deepEqual(runInvocation('env -S "git push --force"'), {
      category: "uncategorized",
      program: null,
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation('env --split-string="git push --force"'), {
      category: "uncategorized",
      program: null,
      invokedBareName: false,
    });

    // Any other/unrecognised env flag (BSD's -P altpath, -C altwd, -0, -v; a hypothetical future
    // addition to either implementation) fails closed the same way — never silently "safe" merely
    // because this file has not enumerated that exact flag (the CR-01 -> command/builtin -> env
    // pattern this round explicitly closes the door on).
    assert.deepEqual(runInvocation("env -P /tmp git push --force"), {
      category: "uncategorized",
      program: null,
      invokedBareName: false,
    });
    assert.deepEqual(runInvocation("env -C /tmp git push --force"), {
      category: "uncategorized",
      program: null,
      invokedBareName: false,
    });

    // `--` ends env's own option processing; a plain PATH= assignment after it is still an
    // assignment (unaffected either way), and the real program is still resolved correctly.
    assert.deepEqual(runInvocation("env -- git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });

    // Bare `env` (no flags at all) is unaffected by any of the above — still the ordinary,
    // reachable case.
    assert.deepEqual(runInvocation("env git push --force"), {
      category: "force-push",
      program: "git",
      invokedBareName: true,
    });
  },
);

test(
  "the shim's --classify-invocation mode reports textCanShadowPathResolution and namesGatedProgram on every safe verdict",
  { skip: SHIM_SKIP_REASON },
  () => {
    const runInvocation = (text) => {
      const result = spawnSync(SHIM_BIN, ["--classify-invocation", text], { encoding: "utf8" });
      return { status: result.status, parsed: JSON.parse(result.stdout.trim()) };
    };

    // B1: an ordinary bare git invocation names a gated program and shadows nothing.
    const b1 = runInvocation("git status");
    assert.equal(b1.status, 0);
    assert.deepEqual(b1.parsed, { category: "safe", textCanShadowPathResolution: false, namesGatedProgram: true });

    // B2: a command naming neither gated program and shadowing nothing.
    const b2 = runInvocation("npm test");
    assert.equal(b2.status, 0);
    assert.deepEqual(b2.parsed, { category: "safe", textCanShadowPathResolution: false, namesGatedProgram: false });

    // B3: the quoted function-shadow payload the token-level scan cannot see inside — requires the
    // raw-text scan, since `sh -c '...'` classifies safe on its own leading "sh" program token and
    // tokenize_shell_words returns the whole single-quoted payload as ONE token.
    const b3 = runInvocation('sh -c \'function git { /usr/bin/git "$@"; }; git push --force\'');
    assert.equal(b3.status, 0);
    assert.deepEqual(b3.parsed, { category: "safe", textCanShadowPathResolution: true, namesGatedProgram: true });

    // B4: a shadowing construct that names neither gated program — must stay ungated by D-61.
    const b4 = runInvocation("source .venv/bin/activate && pytest");
    assert.equal(b4.status, 0);
    assert.deepEqual(b4.parsed, { category: "safe", textCanShadowPathResolution: true, namesGatedProgram: false });
  },
);

// --- invariance assertions (plan 03-24 Task 2): "nothing else moved" is a test, not a claim. ---

test(
  "the destructive --classify-invocation verdict's key set is unchanged by this plan",
  { skip: SHIM_SKIP_REASON },
  () => {
    const result = spawnSync(SHIM_BIN, ["--classify-invocation", "git push origin --delete x"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.deepEqual(
      Object.keys(parsed).sort(),
      ["category", "invokedBareName", "program"],
      "the destructive arm must carry exactly the same three keys it carried before this plan — no new keys leaked in",
    );
  },
);

test(
  "--classify-command's one-word output is unchanged by this plan, for both a destructive and a safe input",
  { skip: SHIM_SKIP_REASON },
  () => {
    const destructive = spawnSync(SHIM_BIN, ["--classify-command", "git push origin --delete x"], { encoding: "utf8" });
    assert.equal(destructive.status, 0);
    assert.equal(destructive.stdout.trim(), "branch-deletion");

    const safe = spawnSync(SHIM_BIN, ["--classify-command", "git status"], { encoding: "utf8" });
    assert.equal(safe.status, 0);
    assert.equal(safe.stdout.trim(), "safe");
  },
);

test(
  "--classify-invocation with no argument still fails closed to the two-key uncategorized line",
  { skip: SHIM_SKIP_REASON },
  () => {
    const result = spawnSync(SHIM_BIN, ["--classify-invocation"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.deepEqual(Object.keys(parsed).sort(), ["category", "invokedBareName"]);
    assert.deepEqual(parsed, { category: "uncategorized", invokedBareName: false });
  },
);

