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
        unobfuscated.contains(r#""category":"uncategorized""#),
        "unobfuscated env -S form must classify uncategorized, got: {unobfuscated}"
    );

    let split = classify(r#"e\nv -S "-P /tmp git push --force""#);
    assert!(
        split.contains(r#""category":"uncategorized""#),
        "backslash-split env -S form must match its unobfuscated twin (uncategorized), got: {split}"
    );
    assert!(
        split.contains(r#""invokedBareName":false"#),
        "backslash-split env -S form must report invokedBareName false, got: {split}"
    );
    assert!(
        split.contains(r#""program":null"#),
        "backslash-split env -S form must report program null, got: {split}"
    );

    let matching = classify(r#"e\nv -S 'git push --force'"#);
    assert!(
        matching.contains(r#""category":"uncategorized""#),
        "e\\nv -S 'git push --force' must match the LAUNCHER_CORPUS row it mirrors (uncategorized), got: {matching}"
    );

    let quote_split = classify(r#"e""nv -S 'git push --force'"#);
    assert!(
        quote_split.contains(r#""category":"uncategorized""#),
        "e\"\"nv -S 'git push --force' must stay uncategorized — the raw tokenizer already resolved quote-toggling, got: {quote_split}"
    );

    let falsifiability = classify("env git push --force");
    assert!(
        !falsifiability.contains(r#""category":"uncategorized""#),
        "env git push --force must NOT classify uncategorized — the retry must not fail-close every env, got: {falsifiability}"
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
