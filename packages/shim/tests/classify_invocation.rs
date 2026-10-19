//! Round seven integration tests (plan 03-32): drives the COMPILED `flywheel-shim` binary via
//! `--classify-invocation` only — never executes git, rm, or any destructive command (D-63).
//! Proves both halves of round six's defect are closed (the backslash-split leading-token form,
//! and the nested-unobfuscated form) while C5 (`raw_text_names_opaque_env_reparse`) never denies
//! a text naming no gated program, and adds the two AGNT-07 edge rows this plan owns
//! (idempotency, concurrency). Asserts on the exact JSON field substrings the binary prints,
//! never by parsing JSON — the printed shape is the contract `pretooluse-hook.ts` reads.
//!
//! See `packages/core/tests/destructive_classifier.rs` for the workspace's own test style this
//! file follows: plain `#[test]` functions, `assert_eq!`/`assert!` with a message.

use std::process::Command;

/// Runs the compiled binary with `--classify-invocation <text>` and returns trimmed stdout.
/// Never executes anything destructive — this mode is pure classification (D-63).
fn classify(text: &str) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_flywheel-shim"))
        .arg("--classify-invocation")
        .arg(text)
        .output()
        .expect("failed to spawn flywheel-shim");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[test]
fn round_seven_backslash_split_env_matches_unobfuscated() {
    let unobfuscated = classify(r#"env -S "-P /tmp git push --force""#);
    assert!(
        unobfuscated.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "unobfuscated env -S form must read as unresolvable (safe, both shadow facts true), got: {unobfuscated}"
    );

    let split = classify(r#"e\nv -S "-P /tmp git push --force""#);
    assert!(
        split.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "backslash-split env -S form must match its unobfuscated twin (unresolvable), got: {split}"
    );

    let matching = classify(r#"e\nv -S 'git push --force'"#);
    assert!(
        matching.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "e\\nv -S 'git push --force' must match the LAUNCHER_CORPUS row it mirrors (unresolvable), got: {matching}"
    );

    let quote_split = classify(r#"e""nv -S 'git push --force'"#);
    assert!(
        quote_split.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "e\"\"nv -S 'git push --force' must stay unresolvable — the raw tokenizer already resolved quote-toggling, got: {quote_split}"
    );

    let falsifiability = classify("env git push --force");
    assert!(
        falsifiability.contains(r#""category":"force-push""#),
        "env git push --force must classify force-push — the retry must not swallow every env, got: {falsifiability}"
    );
}

#[test]
fn round_seven_nested_env_reparse_reports_can_shadow() {
    let nested = classify(r#"sh -c 'env -S "-P /tmp git push --force"'"#);
    assert!(
        nested.contains(r#""category":"safe""#),
        "nested form must classify safe, got: {nested}"
    );
    assert!(
        nested.contains(r#""textCanShadowPathResolution":true"#),
        "nested form must report textCanShadowPathResolution true, got: {nested}"
    );
    assert!(
        nested.contains(r#""namesGatedProgram":true"#),
        "nested form must report namesGatedProgram true, got: {nested}"
    );

    let nested_split = classify(r#"sh -c 'e\nv -S "-P /tmp git push --force"'"#);
    assert!(
        nested_split.contains(r#""textCanShadowPathResolution":true"#),
        "nested + backslash-split form must ALSO report textCanShadowPathResolution true, got: {nested_split}"
    );
}

#[test]
fn c5_never_denies_a_text_naming_no_gated_program() {
    let harmless = classify(r#"sh -c 'env -S "echo hello"'"#);
    assert!(
        harmless.contains(r#""category":"safe""#),
        "harmless nested env -S form must classify safe, got: {harmless}"
    );
    assert!(
        harmless.contains(r#""textCanShadowPathResolution":true"#),
        "C5 must still fire (env + opaque flag present), got: {harmless}"
    );
    assert!(
        harmless.contains(r#""namesGatedProgram":false"#),
        "harmless nested env -S form must report namesGatedProgram false — C5 must never deny a text naming no gated program, got: {harmless}"
    );
}

#[test]
fn c5_leaves_ordinary_commands_determinate() {
    let destructive_env = classify("env git push --force");
    assert!(
        !destructive_env.contains(r#""textCanShadowPathResolution""#),
        "a destructive verdict must not carry textCanShadowPathResolution at all, got: {destructive_env}"
    );

    let sh_force_push = classify(r#"sh -c "git push --force""#);
    assert!(
        sh_force_push.contains(r#""textCanShadowPathResolution":false"#),
        "sh -c \"git push --force\" must remain unchanged (false), got: {sh_force_push}"
    );

    let commit = classify(r#"git commit -m "fix: thing""#);
    assert!(
        commit.contains(r#""textCanShadowPathResolution":false"#),
        "git commit -m \"fix: thing\" must remain unchanged (false), got: {commit}"
    );

    let env_i = classify("env -i git push --force");
    assert!(
        !env_i.contains(r#""textCanShadowPathResolution""#),
        "env -i git push --force must keep its current (destructive) verdict shape, got: {env_i}"
    );

    let env_u_path = classify("env -u PATH git push --force");
    assert!(
        !env_u_path.contains(r#""textCanShadowPathResolution""#),
        "env -u PATH git push --force must keep its current (destructive) verdict shape, got: {env_u_path}"
    );

    // Deviation (Rule 1 — plan text bug, documented in SUMMARY.md): the PLAN's own acceptance
    // criteria states this row must report `textCanShadowPathResolution:false`, but the pre-existing
    // `source` keyword trigger (unrelated to env/C5 — see `text_can_shadow_path_resolution`'s
    // KEYWORD_TRIGGERS) has ALWAYS made this `true` for this exact command, exactly as
    // LAUNCHER_CORPUS's own Group 4 row for this command documents ("a shadow construct (source) is
    // present, but the text names neither git nor rm"). This function's own job is to prove C5 does
    // NOT ADDITIONALLY misread `.venv` as an `env` token — it does not, and cannot: `.venv/bin/activate`
    // is one whitespace-delimited token, never equal to the literal token `env`. The correct,
    // unchanged assertion is namesGatedProgram:false (this command names neither gated program) AND
    // textCanShadowPathResolution:true (the pre-existing `source` trigger, untouched by this plan).
    let venv = classify("source .venv/bin/activate && pytest");
    assert!(
        venv.contains(r#""namesGatedProgram":false"#) && venv.contains(r#""textCanShadowPathResolution":true"#),
        ".venv must not be additionally read as an env token by C5 (source's own pre-existing trigger \
         already makes textCanShadowPathResolution true; namesGatedProgram must stay false), got: {venv}"
    );
}

#[test]
fn classification_is_idempotent_for_identical_text() {
    let text = r#"sh -c 'env -S "-P /tmp git push --force"'"#;
    let first = classify(text);
    let second = classify(text);
    assert_eq!(
        first, second,
        "classifying the same command text twice must produce byte-identical stdout"
    );
}

// --- Plan 03-33: C3 gains its fourth named mechanism (brace-adjacency), closing CR-01. ---
// Every payload below is a classification string only — never executed — per D-63.

#[test]
fn c3_brace_adjacency_reports_indeterminate_for_assembled_alias() {
    // Measured live during planning: `al{i,}as gitx="echo ..."` genuinely defines the alias
    // under `expand_aliases`. `al{i,}as` welds a `{`/`}`-adjacent letter run, so C3 must now
    // report indeterminate for it — and the raw text still names `git` literally later on.
    let alias = classify(r#"sh -c 'al{i,}as git=/usr/bin/git; git push --force'"#);
    assert!(
        alias.contains(r#""category":"safe""#),
        "brace-assembled alias shadow must classify safe, got: {alias}"
    );
    assert!(
        alias.contains(r#""textCanShadowPathResolution":true"#),
        "brace-assembled alias shadow must report textCanShadowPathResolution true, got: {alias}"
    );
    assert!(
        alias.contains(r#""namesGatedProgram":true"#),
        "brace-assembled alias shadow must report namesGatedProgram true (git appears literally later), got: {alias}"
    );

    // The same adjacency shape on a second keyword (`source`). `./defs.sh` is a string inside
    // the classification payload only and is never read from disk (D-63).
    let source = classify(r#"sh -c 'so{u,}rce ./defs.sh; git push --force'"#);
    assert!(
        source.contains(r#""textCanShadowPathResolution":true"#),
        "brace-assembled source shadow must report textCanShadowPathResolution true, got: {source}"
    );
    assert!(
        source.contains(r#""namesGatedProgram":true"#),
        "brace-assembled source shadow must report namesGatedProgram true, got: {source}"
    );
}

#[test]
fn c3_brace_adjacency_reports_indeterminate_for_assembled_program_name() {
    // `{gi,}t push --force` expands to `git t push --force` — the gated program name itself is
    // brace-assembled. The raw text does NOT contain the contiguous literal `git`, so
    // namesGatedProgram stays false; the point of this row is that
    // textCanShadowPathResolution is now honest (true) so the hook still defers to Layer 2,
    // which is proven to backstop this exact shape.
    let git = classify("{gi,}t push --force");
    assert!(
        git.contains(r#""textCanShadowPathResolution":true"#),
        "brace-assembled `git` must report textCanShadowPathResolution true, got: {git}"
    );
    assert!(
        git.contains(r#""namesGatedProgram":false"#),
        "brace-assembled `git` must still report namesGatedProgram false (decision unchanged), got: {git}"
    );

    let rm = classify("{r,}m -rf /tmp/nonexistent-x");
    assert!(
        rm.contains(r#""textCanShadowPathResolution":true"#),
        "brace-assembled `rm` must report textCanShadowPathResolution true, got: {rm}"
    );
    assert!(
        rm.contains(r#""namesGatedProgram":false"#),
        "brace-assembled `rm` must still report namesGatedProgram false (decision unchanged), got: {rm}"
    );
}

#[test]
fn c3_brace_rule_leaves_ordinary_path_braces_determinate() {
    // The adjacency rule's whole purpose: `{` following `/` and `}` preceding `.` welds nothing,
    // so ordinary path-brace idioms stay determinate.
    let git_add = classify("git add src/{a,b}.rs");
    assert!(
        git_add.contains(r#""textCanShadowPathResolution":false"#),
        "git add src/{{a,b}}.rs must remain determinate (false), got: {git_add}"
    );

    let mkdir = classify("mkdir -p src/{a,b}");
    assert!(
        mkdir.contains(r#""textCanShadowPathResolution":false"#),
        "mkdir -p src/{{a,b}} must remain determinate (false), got: {mkdir}"
    );

    let curl = classify(r#"curl -s -d '{"a":1}' http://x"#);
    assert!(
        curl.contains(r#""textCanShadowPathResolution":false"#),
        "curl -s -d '{{\"a\":1}}' http://x must remain determinate (false), got: {curl}"
    );

    let commit = classify(r#"git commit -m "fix: thing""#);
    assert!(
        commit.contains(r#""textCanShadowPathResolution":false"#),
        "git commit -m \"fix: thing\" must remain determinate (false), got: {commit}"
    );

    let log = classify("git log --oneline -n 5");
    assert!(
        log.contains(r#""textCanShadowPathResolution":false"#),
        "git log --oneline -n 5 must remain determinate (false), got: {log}"
    );
}

#[test]
fn c3_brace_rule_does_not_flip_the_wildcard_git_add_row() {
    // The WR-03 ruling's own falsifiability row: if the brace rule became symmetric or
    // presence-based instead of the asymmetric `{`-looks-backward/`}`-looks-forward rule, this
    // row (which has no brace at all) must still stay unaffected — this test guards against a
    // change to the GLOB rule, not the brace rule, moving unexpectedly.
    let wildcard = classify("git add *.rs");
    assert!(
        wildcard.contains(r#""textCanShadowPathResolution":false"#),
        "git add *.rs must still defer — a genuine inversion would have flipped this row, got: {wildcard}"
    );

    // Unchanged behaviour re-asserted so the new brace rule is not the reason this passes: the
    // pre-existing `()`-adjacency scan still catches this shape, and its own `{`/`}` are
    // space-adjacent, not letter-adjacent, so they are not a brace trigger.
    let function_shadow = classify(r#"sh -c 'git() { /usr/bin/git "$@"; }; git push --force'"#);
    assert!(
        function_shadow.contains(r#""textCanShadowPathResolution":true"#),
        "the pre-existing git() function-shadow shape must still report true via the ()-scan, got: {function_shadow}"
    );
}

#[test]
fn c3_brace_rule_priced_friction_xargs_placeholder() {
    // Accepted, priced friction (recorded explicitly, not parsed away): `{` immediately follows
    // `I`, so this moves from false to true. Combined with namesGatedProgram:true this becomes a
    // deny — asserted here as a decision, not a surprise.
    let xargs = classify("xargs -I{} rm {}");
    assert!(
        xargs.contains(r#""textCanShadowPathResolution":true"#),
        "xargs -I{{}} rm {{}} is the accepted, priced friction row — must report true, got: {xargs}"
    );
}

// --- Plan 03-35 (round eight): C6 promotes wrapper-token recognition from exact-token-equality
// (C5) to word-boundary containment, closing brace expansion (`{env,}`), a path prefix
// (`/usr/bin/env`), and an indeterminate token at a wrapper's own flag or NAME position. Every
// payload below is a classification string only — never executed — per D-63.

#[test]
fn round_eight_brace_obfuscated_env_wrapper_matches_unobfuscated() {
    let unobfuscated = classify(r#"env -S "-P /tmp git push --force""#);
    assert!(
        unobfuscated.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "unobfuscated control must read as unresolvable (safe, both shadow facts true), got: {unobfuscated}"
    );

    let obfuscated = classify(r#"{env,} -S "-P /tmp git push --force""#);
    assert!(
        obfuscated.contains(r#""textCanShadowPathResolution":true"#),
        "brace-obfuscated env wrapper must report textCanShadowPathResolution true, got: {obfuscated}"
    );
    assert!(
        obfuscated.contains(r#""namesGatedProgram":true"#),
        "brace-obfuscated env wrapper must report namesGatedProgram true, got: {obfuscated}"
    );
}

#[test]
fn round_eight_nested_brace_obfuscated_env_wrapper_reports_can_shadow() {
    let nested = classify(r#"sh -c '{env,} -S "-P /tmp git push --force"'"#);
    assert!(
        nested.contains(r#""textCanShadowPathResolution":true"#),
        "nested brace-obfuscated form must report textCanShadowPathResolution true, got: {nested}"
    );
    assert!(
        nested.contains(r#""namesGatedProgram":true"#),
        "nested brace-obfuscated form must report namesGatedProgram true, got: {nested}"
    );
}

// --- Plan 03-35 Task 2: the `command` half and the path-qualified siblings — the same root
// cause, two more spellings. Every payload below is a classification string only — never
// executed — per D-63.

#[test]
fn round_eight_brace_obfuscated_command_wrapper_matches_unobfuscated() {
    let control = classify("command -p git push --force");
    assert!(
        control.contains(r#""category":"force-push""#) && control.contains(r#""invokedBareName":false"#),
        "command -p git push --force control must classify force-push/invokedBareName:false, got: {control}"
    );

    let obfuscated = classify("{command,} -p git push --force");
    assert!(
        obfuscated.contains(r#""textCanShadowPathResolution":true"#),
        "brace-obfuscated command wrapper must report textCanShadowPathResolution true, got: {obfuscated}"
    );
    assert!(
        obfuscated.contains(r#""namesGatedProgram":true"#),
        "brace-obfuscated command wrapper must report namesGatedProgram true, got: {obfuscated}"
    );
}

#[test]
fn round_eight_path_qualified_env_wrapper_is_recognised() {
    // No obfuscation at all — found during 03-35's own planning pass, named in neither
    // 03-REVIEW.md nor 03-VERIFICATION.md. `/usr/bin/env -S "echo …"` was confirmed live with a
    // harmless echo payload to be a real, executable invocation (D-63 — never a destructive one).
    let qualified = classify(r#"/usr/bin/env -S "-P /tmp git push --force""#);
    assert!(
        qualified.contains(r#""textCanShadowPathResolution":true"#),
        "path-qualified env wrapper must report textCanShadowPathResolution true, got: {qualified}"
    );
}

#[test]
fn round_eight_path_qualified_command_wrapper_is_recognised() {
    let qualified = classify("/usr/bin/command -p git push --force");
    assert!(
        qualified.contains(r#""textCanShadowPathResolution":true"#),
        "path-qualified command wrapper must report textCanShadowPathResolution true, got: {qualified}"
    );
}

#[test]
fn c6_keeps_c5_falsifiability_companions() {
    // Load-bearing: a corpus Group 4 companion AND a live probe inside
    // scripts/uat/uat-05-concurrent-commits.mjs. `-v`/`-V` never execute their argument, so C6
    // must not fire on them.
    let command_v = classify("command -v git");
    assert!(
        command_v.contains(r#""category":"safe""#) && command_v.contains(r#""textCanShadowPathResolution":false"#),
        "command -v git must stay safe/false, got: {command_v}"
    );

    // The measurement that justifies the dash-carrying requirement at the flag position: a
    // brace-bearing token with no `-` sits at the PROGRAM position, not the flag position, so
    // the real shell reaches this shim through an ordinary PATH search.
    let env_git_brace = classify("env {git,} push --force");
    assert!(
        env_git_brace.contains(r#""textCanShadowPathResolution":false"#),
        "env {{git,}} push --force must still defer, got: {env_git_brace}"
    );

    // C5's own inherited companion.
    let harmless_nested = classify(r#"sh -c 'env -S "echo hello"'"#);
    assert!(
        harmless_nested.contains(r#""textCanShadowPathResolution":true"#)
            && harmless_nested.contains(r#""namesGatedProgram":false"#),
        "sh -c 'env -S \"echo hello\"' must keep textCanShadowPathResolution:true / namesGatedProgram:false, got: {harmless_nested}"
    );

    // The ordinary bare git invocation Layer 2 is trusted to handle.
    let status = classify("git status");
    assert!(
        status.contains(r#""textCanShadowPathResolution":false"#),
        "git status must still defer, got: {status}"
    );
}

// --- Plan 03-35 Task 3: an indeterminate token at a flag or NAME position fails closed, and
// the friction is priced. Every payload below is a classification string only — never
// executed — per D-63.

#[test]
fn c6_indeterminate_flag_position_fails_closed() {
    // All three brace forms were confirmed live with harmless echo payloads to be real shell
    // invocations (D-63). `env -u {PATH,} git push --force` is the one of the three plan 03-36's
    // brace sweep will generate mechanically, because PATH is already a KEYED_WORDS member while
    // -S and -p are not.
    let env_flag = classify(r#"env {-S,} "-P /tmp git push --force""#);
    assert!(
        env_flag.contains(r#""textCanShadowPathResolution":true"#),
        "env {{-S,}} must report textCanShadowPathResolution true, got: {env_flag}"
    );

    let env_unset_name = classify("env -u {PATH,} git push --force");
    assert!(
        env_unset_name.contains(r#""textCanShadowPathResolution":true"#),
        "env -u {{PATH,}} must report textCanShadowPathResolution true, got: {env_unset_name}"
    );

    let command_flag = classify("command {-p,} git push --force");
    assert!(
        command_flag.contains(r#""textCanShadowPathResolution":true"#),
        "command {{-p,}} must report textCanShadowPathResolution true, got: {command_flag}"
    );

    // Negative control: --unset naming any OTHER variable leaves PATH intact and must not
    // trigger, exactly as it does not today.
    let unset_other = classify("env -u FOO git push --force");
    assert!(
        unset_other.contains(r#""category":"force-push""#),
        "env -u FOO git push --force must remain force-push, got: {unset_other}"
    );
}

#[test]
fn c6_priced_friction_ordinary_commit_message_with_braces() {
    // WR-01's own class, asserted rather than assumed. This is C3's pre-existing letter-adjacency
    // cost, not new to C6, and it denies today — the gap 03-VERIFICATION.md's fourth `missing:`
    // item says must stop persisting silently.
    let commit = classify(r#"git commit -m "add {foo}bar support""#);
    assert!(
        commit.contains(r#""textCanShadowPathResolution":true"#) && commit.contains(r#""namesGatedProgram":true"#),
        "git commit -m \"add {{foo}}bar support\" must report both true (priced friction), got: {commit}"
    );
}

#[test]
fn c6_did_not_widen_c3s_adjacency_scope() {
    let git_add = classify("git add src/{a,b}.rs");
    assert!(
        git_add.contains(r#""textCanShadowPathResolution":false"#),
        "git add src/{{a,b}}.rs must remain determinate, got: {git_add}"
    );

    let mkdir = classify("mkdir -p src/{a,b}");
    assert!(
        mkdir.contains(r#""textCanShadowPathResolution":false"#),
        "mkdir -p src/{{a,b}} must remain determinate, got: {mkdir}"
    );
}

#[test]
fn concurrent_classifications_agree_with_serial_ones() {
    let texts = [
        r#"env -S "-P /tmp git push --force""#,
        r#"e\nv -S "-P /tmp git push --force""#,
        r#"sh -c 'env -S "-P /tmp git push --force"'"#,
        r#"sh -c 'env -S "echo hello"'"#,
    ];

    let serial: Vec<String> = texts.iter().map(|t| classify(t)).collect();

    let handles: Vec<_> = texts
        .iter()
        .map(|t| {
            let text = t.to_string();
            std::thread::spawn(move || classify(&text))
        })
        .collect();
    let concurrent: Vec<String> = handles
        .into_iter()
        .map(|h| h.join().expect("classification thread panicked"))
        .collect();

    assert_eq!(
        serial, concurrent,
        "four classifications spawned concurrently must produce the same verdicts as spawned serially"
    );
}

// --- Plan 03-37 (round nine): the retired trust-boundary doc stated C6's charged
// friction class narrower than C6's own measured behaviour (03-REVIEW.md WR-A). These tests prove
// the corrected, broader class against the compiled binary. Every payload below is a
// classification string only — never executed — per D-63.

#[test]
fn round_nine_plain_prose_wrapper_flag_adjacency_denies() {
    // Establish the control's own verdict in this same test, rather than trusting a remembered
    // one: no dash-flag word sits immediately after "command", so the walk breaks and this
    // defers.
    let control = classify(r#"git commit -m "fix the command parser""#);
    assert!(
        control.contains(r#""textCanShadowPathResolution":false"#),
        "control must defer (no dash-flag word adjacent to \"command\"), got: {control}"
    );

    // The verifier's own named representative (03-VERIFICATION.md's `missing:` item): plain
    // prose, no brace, no glob, no obfuscation of any kind — yet C1's context-free quote removal
    // re-tokenizes the quoted commit message and C6's flag walk sees "-p" immediately following
    // "command".
    let command_form = classify(r#"git commit -m "document the command -p flag behavior""#);
    assert!(
        command_form.contains(r#""namesGatedProgram":true"#),
        "representative must report namesGatedProgram true, got: {command_form}"
    );
    assert!(
        command_form.contains(r#""textCanShadowPathResolution":true"#),
        "representative must report textCanShadowPathResolution true — the D-61 AND-gate reads \
         both this and namesGatedProgram, got: {command_form}"
    );

    // The `env` half of the same class: no brace, no glob, no obfuscation.
    let env_form = classify(r#"git commit -m "the env -i flag clears vars""#);
    assert!(
        env_form.contains(r#""namesGatedProgram":true"#)
            && env_form.contains(r#""textCanShadowPathResolution":true"#),
        "env half of the plain-prose class must report both fields true, got: {env_form}"
    );
}

#[test]
fn round_nine_env_charges_any_dash_command_charges_only_the_p_run() {
    // `env`'s recognised-flag set is OPEN: an unrecognised dash-prefixed token means the scanner
    // cannot tell where `env`'s own arguments end, so it fails closed and fires on ANY
    // dash-prefixed follower, not only the named PATH-defeating flags. `command`'s recognised-flag
    // set is CLOSED (`-v`, `-V`, `-p`), so `command` can safely step over an unrecognised flag
    // without firing — it fires only when the walk actually reaches `-p`. This asymmetry is why
    // `env --help form` charges while `command --help form` (tested in the sibling negative-control
    // test) does not.
    let env_payloads = [
        "the env -i form",
        "the env --ignore-environment form",
        "the env -u PATH form",
        "the env --unset=PATH form",
        "the env -S form",
        "the env --split-string form",
        "the env --help form",
        "the env -x form",
    ];
    for payload in env_payloads {
        let text = format!(r#"git commit -m "{payload}""#);
        let result = classify(&text);
        assert!(
            result.contains(r#""textCanShadowPathResolution":true"#),
            "{payload} must report textCanShadowPathResolution true, got: {result}"
        );
    }

    let command_payloads = ["the command -p form", "the command --verbose -p form"];
    for payload in command_payloads {
        let text = format!(r#"git commit -m "{payload}""#);
        let result = classify(&text);
        assert!(
            result.contains(r#""textCanShadowPathResolution":true"#),
            "{payload} must report textCanShadowPathResolution true (the walk reaches -p), got: {result}"
        );
    }
}

#[test]
fn round_nine_prose_controls_still_defer() {
    // Each control is load-bearing for a distinct reason:
    // - "the env vars form" / "the env handling form": an ordinary non-dash word after `env`
    //   proves the walk still requires an actual flag, not bare presence of the wrapper word.
    // - "the command -v form" / "the command -V form": the query flags that make `command` a
    //   lookup rather than an execution — protecting `command -v git`, both a corpus Group 4
    //   falsifiability companion and a live probe inside
    //   `scripts/uat/uat-05-concurrent-commits.mjs`.
    // - "the command --help form": proves `command`'s flag run must actually REACH `-p`, not
    //   merely contain a recognised query flag or an unrecognised one.
    // - "the command parser form": an ordinary word after `command` with no flag at all.
    // - "the environment -i flag": proves the word-boundary rule still holds — `environment` does
    //   not word-contain `env` (an identifier character, `i`, sits immediately after where `env`
    //   would end).
    // - "add --unset=PATH support to env": `env` is the LAST token, so nothing follows it to walk.
    let negative_controls = [
        "the env vars form",
        "the env handling form",
        "the command -v form",
        "the command -V form",
        "the command --help form",
        "the command parser form",
        "the environment -i flag",
        "add --unset=PATH support to env",
    ];
    for payload in negative_controls {
        let text = format!(r#"git commit -m "{payload}""#);
        let result = classify(&text);
        assert!(
            result.contains(r#""textCanShadowPathResolution":false"#),
            "{payload} must report textCanShadowPathResolution false, got: {result}"
        );
    }

    // D-61's AND-gate proof: C6 fires (the env/dash adjacency is present), but this text names no
    // gated program, so the AND-gate never denies it.
    let grep_control = classify(r#"grep -rn "env -i" packages"#);
    assert!(
        grep_control.contains(r#""textCanShadowPathResolution":true"#)
            && grep_control.contains(r#""namesGatedProgram":false"#),
        "grep -rn \"env -i\" packages must report textCanShadowPathResolution:true and \
         namesGatedProgram:false, got: {grep_control}"
    );
}

#[test]
fn round_nine_quote_removed_form_is_load_bearing() {
    // Why this test exists, not merely what it asserts: both nested payloads below are ONE token
    // in the raw form — `env` never appears at a segment's own leading position, buried instead
    // inside the outer `sh -c '...'` single-quoted payload. Their true verdict comes entirely from
    // `shell_quote_removed`'s re-tokenization of that quoted span — the SAME mechanism that
    // produces round nine's plain-prose false positive
    // (`round_nine_plain_prose_wrapper_flag_adjacency_denies`). A future author implementing the
    // co-location narrowing or the original-quoted-span narrowing named in
    // the retired trust-boundary doc's `## Named residuals` table (the "DECLINED (round
    // nine, plan 03-37)" row) must see THIS test go red rather than silently reopening a bypass
    // rounds seven and eight already closed.
    let nested_env = classify(r#"sh -c 'env -S "-P /tmp git push --force"'"#);
    assert!(
        nested_env.contains(r#""textCanShadowPathResolution":true"#),
        "round seven's nested env shape must still deny, got: {nested_env}"
    );

    let nested_brace_env = classify(r#"sh -c '{env,} -S "-P /tmp git push --force"'"#);
    assert!(
        nested_brace_env.contains(r#""textCanShadowPathResolution":true"#),
        "round eight's nested brace-obfuscated env shape must still deny, got: {nested_brace_env}"
    );

    let unobfuscated_top_level = classify(r#"env -S "-P /tmp git push --force""#);
    assert!(
        unobfuscated_top_level.contains(r#""category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true"#),
        "the unobfuscated top-level control must still read as unresolvable (safe, both shadow facts true), got: {unobfuscated_top_level}"
    );
}
