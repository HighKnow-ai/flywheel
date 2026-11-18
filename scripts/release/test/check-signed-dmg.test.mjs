// The release workflow's own look at the installer it is about to attest. Every macOS tool is a stub that
// logs its call, so these run anywhere; what they hold is the ORDER (Gatekeeper's switch, then the
// checksum, then the quarantined copy, then the tickets, then the signature) and each refusal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkSignedDmg, isLostConnection, signatureRuntime, signatureTeam } from "../check-signed-dmg.mjs";

const HARDENED = "CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1\nTeamIdentifier=ABCDE12345\n";

/** A scratch directory holding a .dmg and the checksum beside it, and the stubbed tools. */
function world({ world = {}, bytes = "signed bytes", sums } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-signed-dmg-"));
  const dmg = path.join(dir, "Flywheel_1.2.3_aarch64.dmg");
  fs.writeFileSync(dmg, bytes);
  const hash = createHash("sha256").update("signed bytes").digest("hex");
  fs.writeFileSync(`${dmg}.sha256`, sums ?? `${hash}  Flywheel_1.2.3_aarch64.dmg\n`);
  const calls = [];
  const sleeps = [];
  const stapler = [...(world.stapler ?? [])];
  const tools = {
    sleep: (s) => sleeps.push(s),
    run(cmd, args) {
      calls.push(`${cmd} ${args.join(" ")}`);
      const line = `${cmd} ${args[0]} ${args[1] ?? ""}`;
      if (cmd === "spctl" && args[0] === "--status") return { status: 0, out: `${world.status ?? "assessments enabled"}\n` };
      if (cmd === "spctl") {
        if (world.refused) return { status: 3, out: "x.dmg: rejected\n" };
        return { status: 0, out: `x.dmg: accepted\nsource=${world.source ?? "Notarized Developer ID"}\n` };
      }
      if (cmd === "xattr") return { status: world.quarantineFails ? 1 : 0, out: "" };
      if (cmd === "xcrun") {
        const next = stapler.length > 0 ? stapler.shift() : "ok";
        if (next === "ok") return { status: 0, out: "The validate action worked!\n" };
        if (next === "net") return { status: 68, out: "NSURLErrorDomain The network connection was lost.\n" };
        return { status: 65, out: "Could not validate ticket\n" };
      }
      if (cmd === "hdiutil" && args[0] === "attach") {
        if (world.mountFails) return { status: 1, out: "hdiutil: attach failed\n" };
        if (!world.noApp) fs.mkdirSync(path.join(args[args.indexOf("-mountpoint") + 1], "Flywheel.app"));
        return { status: 0, out: "" };
      }
      if (cmd === "hdiutil") return { status: 0, out: "" };
      if (cmd === "codesign" && args[0] === "--verify") return { status: world.verifyFails ? 1 : 0, out: "" };
      if (cmd === "codesign") return { status: 0, out: world.signature ?? HARDENED };
      throw new Error(`unexpected tool ${line}`);
    },
  };
  return { dir, dmg, calls, sleeps, tools, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const first = (calls, re) => calls.findIndex((c) => re.test(c));

test("a signed, notarised, stapled installer passes, and the steps run in order", () => {
  const w = world();
  const r = checkSignedDmg(w.dmg, w.tools);
  assert.equal(r.ok, true, r.problem);
  assert.match(r.notes.join("\n"), /signed by team ABCDE12345 with the hardened runtime/);
  const order = [/^spctl --status/, /^xattr -w com\.apple\.quarantine/, /^spctl --assess --type open/, /^xcrun stapler validate/, /^hdiutil attach/, /^codesign --verify/, /^codesign -dv/, /^hdiutil detach/];
  const at = order.map((re) => first(w.calls, re));
  assert.ok(at.every((i) => i >= 0), `every tool ran: ${w.calls.join(" | ")}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
  assert.equal(w.calls.filter((c) => c.startsWith("xcrun stapler validate")).length, 2, "the .dmg's ticket and the app's");
  assert.equal(w.calls.filter((c) => c.startsWith("hdiutil detach")).length, 1);
  w.done();
});

test("the quarantine mark goes on a copy, never on the file that is attested", () => {
  const w = world();
  checkSignedDmg(w.dmg, w.tools);
  const mark = w.calls.find((c) => c.startsWith("xattr -w"));
  assert.ok(!mark.includes(w.dmg), `the mark is on ${mark}`);
  w.done();
});

test("each refusal ends the run, names what failed, and still lets go of the mount", () => {
  const cases = [
    ["assessments off", { status: "assessments disabled" }, /assessments are not enabled/],
    ["a source that is not notarised", { source: "Developer ID" }, /not Notarized Developer ID/],
    ["a refused .dmg", { refused: true }, /Gatekeeper refused the \.dmg/],
    ["a failed quarantine", { quarantineFails: true }, /could not quarantine/],
    ["an unstapled .dmg", { stapler: ["no"] }, /\.dmg's notarisation ticket does not validate/],
    ["an unstapled app", { stapler: ["ok", "no"] }, /app's notarisation ticket does not validate/],
    ["a mount that fails", { mountFails: true }, /could not mount/],
    ["no app inside", { noApp: true }, /no Flywheel\.app inside/],
    ["a failed codesign verify", { verifyFails: true }, /codesign --verify failed/],
    ["no team", { signature: "CodeDirectory v=20500 flags=0x10000(runtime)\n" }, /no Team ID/],
    ["no hardened runtime", { signature: "CodeDirectory v=20500 flags=0x2(adhoc)\nTeamIdentifier=ABCDE12345\n" }, /hardened runtime/],
  ];
  for (const [name, spec, problem] of cases) {
    const w = world({ world: spec });
    const r = checkSignedDmg(w.dmg, w.tools);
    assert.equal(r.ok, false, name);
    assert.match(r.problem, problem, name);
    const attached = w.calls.some((c) => c.startsWith("hdiutil attach")) && !spec.mountFails;
    assert.equal(w.calls.some((c) => c.startsWith("hdiutil detach")), attached, `${name}: the mount is let go`);
    w.done();
  }
});

test("a .dmg whose bytes are not the checksummed ones fails at the checksum, before Gatekeeper is asked", () => {
  const w = world({ bytes: "tampered" });
  const r = checkSignedDmg(w.dmg, w.tools);
  assert.equal(r.ok, false);
  assert.match(r.problem, /hashes to/);
  assert.ok(!w.calls.some((c) => c.startsWith("spctl --assess")));
  w.done();
});

test("a checksum that names another file, or none at all, is refused", () => {
  const other = world({ sums: `${"0".repeat(64)}  Other.dmg\n` });
  assert.match(checkSignedDmg(other.dmg, other.tools).problem, /names Other\.dmg/);
  other.done();
  const missing = world();
  fs.rmSync(`${missing.dmg}.sha256`);
  assert.match(checkSignedDmg(missing.dmg, missing.tools).problem, /no .*\.sha256/);
  missing.done();
});

test("a lost connection to Apple is asked again, with a longer wait each time, and a refusal never is", () => {
  const w = world({ world: { stapler: ["net", "net", "ok", "ok"] } });
  assert.equal(checkSignedDmg(w.dmg, w.tools).ok, true);
  assert.deepEqual(w.sleeps, [10, 20]);
  w.done();
  const refused = world({ world: { stapler: ["no"] } });
  assert.equal(checkSignedDmg(refused.dmg, refused.tools).ok, false);
  assert.deepEqual(refused.sleeps, []);
  refused.done();
  const down = world({ world: { stapler: ["net", "net", "net", "net", "net"] } });
  assert.equal(checkSignedDmg(down.dmg, down.tools).ok, false, "five lost connections is a failure, not a pass");
  assert.equal(down.calls.filter((c) => c.startsWith("xcrun stapler validate")).length, 5);
  down.done();
});

test("the parsers read what codesign prints", () => {
  assert.equal(signatureTeam("Identifier=x\nTeamIdentifier=ABCDE12345\n"), "ABCDE12345");
  assert.equal(signatureTeam("TeamIdentifier=not set\n"), "not set");
  assert.equal(signatureRuntime(HARDENED), true);
  assert.equal(signatureRuntime("CodeDirectory v=20500 flags=0x0(none)\n"), false);
  assert.equal(isLostConnection("NSURLErrorDomain -1005"), true);
  assert.equal(isLostConnection("Could not validate ticket"), false);
});
