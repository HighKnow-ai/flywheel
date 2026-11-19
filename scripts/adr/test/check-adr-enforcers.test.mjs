// The positive control of check-adr-enforcers.mjs: an ADR that breaks the rule fails, one that keeps it passes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkAdrDir, checkAdrText, enforcerBullets, hasSymbol, withoutCommentLines } from "../check-adr-enforcers.mjs";

function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "adr-check-")));
  fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.test.rs"), "fn it_holds() {}\n// fn only_in_a_comment() {}\nfn it_holds_longer() {}\n");
  return root;
}
const adr = (section) => `# Title\n\nBody.\n\n${section}`;

test("an ADR with no section fails", () => {
  const root = scratch();
  assert.deepEqual(checkAdrText("0001-x.md", adr(""), root), ['0001-x.md: no "## Enforced by" section']);
});

test("an empty section fails", () => {
  const root = scratch();
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n"), root)[0], /no bullet/);
});

test("a path that does not exist fails", () => {
  const root = scratch();
  const out = checkAdrText("0001-x.md", adr("## Enforced by\n\n- `gone.test.rs`\n"), root);
  assert.match(out[0], /does not exist: gone\.test\.rs/);
});

test("a symbol that is not in its file fails, and one that is passes", () => {
  const root = scratch();
  const bad = checkAdrText("0001-x.md", adr("## Enforced by\n\n- `a.test.rs` `it_was_renamed`\n"), root);
  assert.match(bad[0], /does not contain `it_was_renamed`/);
  assert.deepEqual(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `a.test.rs` `it_holds`\n"), root), []);
});

test("a path that climbs out of the folder does not resolve to an enforcer", () => {
  const root = scratch();
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `../x`\n"), root)[0], /does not exist/);
});

test("a bullet with no path fails", () => {
  const root = scratch();
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n- a test\n"), root)[0], /names no backticked path/);
});

test("Not machine-enforceable needs a reason and stands alone", () => {
  const root = scratch();
  const section = (b) => adr(`## Enforced by\n\n${b}\n`);
  assert.deepEqual(
    checkAdrText("0001-x.md", section("- Not machine-enforceable: it is a statement of how a screen reads to a person."), root),
    [],
  );
  assert.match(checkAdrText("0001-x.md", section("- Not machine-enforceable: too short a reason."), root)[0], /at least 6 words/);
  assert.match(
    checkAdrText("0001-x.md", section("- Not machine-enforceable: a long enough reason is written here.\n- `a.test.rs` `it_holds`"), root)[0],
    /only bullet/,
  );
});

test("the section ends at the next heading", () => {
  assert.deepEqual(enforcerBullets("## Enforced by\n\n- `a`\n\n## Other\n\n- `b`\n").bullets, ["`a`"]);
});

test("checkAdrDir reads numbered ADR files only", () => {
  const root = scratch();
  const dir = path.join(root, "docs", "adr");
  fs.writeFileSync(path.join(dir, "0001-x.md"), adr("## Enforced by\n\n- `a.test.rs` `it_holds`\n"));
  fs.writeFileSync(path.join(dir, "0002-y.md"), adr(""));
  fs.writeFileSync(path.join(dir, "README.md"), "no section here\n");
  const { count, problems } = checkAdrDir(dir, root);
  assert.equal(count, 2);
  assert.equal(problems.length, 1);
});

test("a star bullet, an indented bullet and an indented continuation line are read", () => {
  const root = scratch();
  const star = "## Enforced by\n\n* `a.test.rs` `it_holds`\n  `it_was_renamed`\n";
  assert.match(checkAdrText("0001-x.md", adr(star), root)[0], /does not contain `it_was_renamed`/);
  assert.deepEqual(checkAdrText("0001-x.md", adr("## Enforced by\n\n   - `a.test.rs` `it_holds`\n"), root), []);
});

test("a section with no bullet at the margin says why it found none", () => {
  const root = scratch();
  const out = checkAdrText("0001-x.md", adr("## Enforced by\n\nSome words with `a.test.rs`.\n"), root);
  assert.match(out[0], /1 line\(s\) and no bullet/);
});

test("a symbol matches as a whole word and not inside a comment", () => {
  const root = scratch();
  const run = (sym) => checkAdrText("0001-x.md", adr(`## Enforced by\n\n- \`a.test.rs\` \`${sym}\`\n`), root);
  assert.deepEqual(run("it_holds"), []);
  assert.deepEqual(run("it_holds_longer"), []);
  assert.match(run("it_hold")[0], /does not contain/);
  assert.match(run("only_in_a_comment")[0], /does not contain/);
  assert.equal(hasSymbol("a offers + Story only b", "offers + Story only"), true);
  assert.equal(withoutCommentLines("x.rs", "a\n  // b\n/* c\n * d\n */\ne").includes("d"), false);
});

test("a test file named with no symbol fails, a script named with no symbol passes", () => {
  const root = scratch();
  fs.mkdirSync(path.join(root, "packages", "core", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages", "core", "tests", "t.rs"), "fn x() {}\n");
  fs.writeFileSync(path.join(root, "check.mjs"), "x\n");
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `packages/core/tests/t.rs`\n"), root)[0], /is a test file/);
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `a.test.rs`\n"), root)[0], /is a test file/);
  assert.deepEqual(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `check.mjs`\n"), root), []);
});

test("a symlink out of the folder fails", () => {
  const root = scratch();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "adr-out-")));
  fs.writeFileSync(path.join(outside, "x.mjs"), "x\n");
  fs.symlinkSync(path.join(outside, "x.mjs"), path.join(root, "link.mjs"));
  assert.match(checkAdrText("0001-x.md", adr("## Enforced by\n\n- `link.mjs`\n"), root)[0], /leaves the folder/);
});

test("the escape hatch is case-insensitive and may be bold, and a near miss is named", () => {
  const root = scratch();
  const section = (b) => adr(`## Enforced by\n\n- ${b}\n`);
  const reason = "it is a statement of how a screen reads.";
  assert.deepEqual(checkAdrText("0001-x.md", section(`**Not machine-enforceable:** ${reason}`), root), []);
  assert.deepEqual(checkAdrText("0001-x.md", section(`not machine-enforceable: ${reason}`), root), []);
  assert.match(checkAdrText("0001-x.md", section(`Not machine enforceable ${reason}`), root)[0], /misspelled escape hatch/);
});

test("a file name that is not NNNN-lower-case-words.md fails, and so does a repeated number", () => {
  const root = scratch();
  const dir = path.join(root, "docs", "adr");
  const ok = adr("## Enforced by\n\n- `a.test.rs` `it_holds`\n");
  for (const f of ["0001-x.md", "0001-y.md", "12-short.md", "0004-Upper.md", "0003-ok.md"]) fs.writeFileSync(path.join(dir, f), ok);
  const { problems, gaps } = checkAdrDir(dir, root);
  assert.equal(problems.filter((p) => /is named NNNN/.test(p)).length, 2);
  assert.equal(problems.filter((p) => /also used by/.test(p)).length, 1);
  assert.deepEqual(gaps, [2]);
});
