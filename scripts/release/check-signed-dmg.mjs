#!/usr/bin/env node
// Is this `.dmg` what a user's Mac accepts: signed with a Developer ID, notarised, stapled, hardened?
//
//   node scripts/release/check-signed-dmg.mjs <path-to.dmg>
//
// The installer on a Flywheel release is built and signed elsewhere and put on the release's draft before
// this workflow starts, so this is the workflow's own look at the bytes it is about to attest: it asks
// the same questions Gatekeeper asks, from a clean hosted Mac, and trusts nothing the file says about
// itself. It must run on macOS. The checksum is read from `<dmg>.sha256`, beside it.
//
// IN ORDER, each step ending the run when it fails:
//   1. Gatekeeper is on (`spctl --status`), or `spctl --assess` would accept anything.
//   2. The .dmg hashes to the checksum beside it, which names this file.
//   3. A COPY, with the quarantine mark a browser puts on a download (a file a shell wrote is not
//      assessed without one), is assessed: `spctl --assess --type open` must say `Notarized Developer ID`.
//   4. The .dmg's notarisation ticket validates (`stapler validate`; Apple's network drops now and
//      then, so only a lost connection is asked again, never a refusal).
//   5. The app inside it is mounted read-only; its ticket validates, `codesign --verify --deep --strict`
//      passes, and its signature carries the hardened runtime and a Team ID.
//
// WHAT IT DOES NOT SAY: whose Developer ID it is. The release's own tests pin that on the machine that
// signed. Here the Team ID is printed, so the log of every release says which one it was.
//
// Exit 0: every step passed. Exit 1: a step did not (named). Exit 2: usage, or not macOS.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "Flywheel.app";
const STAPLER_TRIES = 5;

/** The tool run for real: its stdout and stderr together, and its exit status. */
export function realRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, out: `${cmd} did not run: ${r.error.message}` };
  return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export const realTools = { run: realRun, sleep: (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000) };

/** The `TeamIdentifier=` of `codesign -dv --verbose=4` output, or "". */
export function signatureTeam(text) {
  const m = /^TeamIdentifier=(.+)$/m.exec(text);
  return m ? m[1].trim() : "";
}

/** Whether `codesign -dv --verbose=4` output shows the hardened runtime flag. */
export function signatureRuntime(text) {
  return /^CodeDirectory .*flags=0x[0-9a-f]+\([a-z,]*runtime[a-z,]*\)/m.test(text);
}

/** Apple's network dropping, which exits as a refusal does. Only this is asked again. */
export function isLostConnection(text) {
  return text.includes("NSURLErrorDomain");
}

function sha256Of(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** `stapler validate`, asked again only when Apple could not be reached. */
function validateTicket(tools, target) {
  let delay = 10;
  for (let attempt = 1; ; attempt++) {
    const r = tools.run("xcrun", ["stapler", "validate", target]);
    if (r.status === 0) return { ok: true };
    if (!isLostConnection(r.out) || attempt >= STAPLER_TRIES) return { ok: false, out: r.out };
    tools.sleep(delay);
    delay *= 2;
  }
}

/**
 * `{ ok: true, notes }` or `{ ok: false, problem, notes }`. `tools.run(cmd, args)` answers `{ status, out }`, and
 * `tools.sleep(seconds)` waits; both are the real ones unless a test hands in stubs.
 */
export function checkSignedDmg(dmg, tools = realTools) {
  const notes = [];
  const fail = (problem) => ({ ok: false, problem, notes });
  if (!fs.existsSync(dmg)) return fail(`no ${dmg}`);
  const sums = `${dmg}.sha256`;
  if (!fs.existsSync(sums)) return fail(`no ${sums}: the checksum travels beside the .dmg`);

  const status = tools.run("spctl", ["--status"]).out.trim();
  notes.push(`spctl --status: ${status}`);
  if (status !== "assessments enabled") return fail("assessments are not enabled, so spctl would accept anything");

  const [want, named] = fs.readFileSync(sums, "utf8").trim().split(/\s+/);
  if (named?.replace(/^\*/, "") !== path.basename(dmg)) return fail(`${sums} names ${named}, not ${path.basename(dmg)}`);
  const have = sha256Of(dmg);
  if (have !== want) return fail(`the .dmg hashes to ${have}, not the ${want} its checksum says`);
  notes.push("ok: the .dmg matches its checksum");

  const work = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "flywheel-dmg-"));
  let mnt = "";
  try {
    const copy = path.join(work, path.basename(dmg));
    fs.copyFileSync(dmg, copy);
    const mark = `0081;${Math.floor(Date.now() / 1000).toString(16)};Safari;`;
    if (tools.run("xattr", ["-w", "com.apple.quarantine", mark, copy]).status !== 0) return fail("could not quarantine the copy");
    const assessed = tools.run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "-vv", copy]);
    notes.push(assessed.out.trim());
    if (assessed.status !== 0) return fail("Gatekeeper refused the .dmg");
    if (!assessed.out.includes("Notarized Developer ID")) return fail("the .dmg's source is not Notarized Developer ID");

    const dmgTicket = validateTicket(tools, copy);
    if (!dmgTicket.ok) return fail(`the .dmg's notarisation ticket does not validate: ${dmgTicket.out.trim()}`);
    notes.push("ok: the .dmg is notarised and stapled");

    mnt = fs.mkdtempSync(path.join(work, "mnt-"));
    const attached = tools.run("hdiutil", ["attach", copy, "-nobrowse", "-readonly", "-mountpoint", mnt, "-quiet"]);
    if (attached.status !== 0) {
      mnt = "";
      return fail(`could not mount the .dmg: ${attached.out.trim()}`);
    }
    const app = path.join(mnt, APP_NAME);
    if (!fs.existsSync(app)) return fail(`no ${APP_NAME} inside the .dmg`);
    const appTicket = validateTicket(tools, app);
    if (!appTicket.ok) return fail(`the app's notarisation ticket does not validate: ${appTicket.out.trim()}`);
    const verified = tools.run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
    if (verified.status !== 0) return fail(`codesign --verify failed on the app inside the .dmg: ${verified.out.trim()}`);
    const sig = tools.run("codesign", ["-dv", "--verbose=4", app]).out;
    const team = signatureTeam(sig);
    if (!/^[A-Z0-9]{10}$/.test(team)) return fail("the app's signature carries no Team ID: it is not signed with a Developer ID");
    if (!signatureRuntime(sig)) return fail("the app does not carry the hardened runtime, which notarisation requires");
    notes.push(`ok: the app is signed by team ${team} with the hardened runtime, and its ticket validates`);
    return { ok: true, notes };
  } finally {
    if (mnt) tools.run("hdiutil", ["detach", mnt, "-quiet"]);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dmg = process.argv[2];
  if (process.argv.length !== 3 || !dmg?.endsWith(".dmg")) {
    console.error("usage: check-signed-dmg.mjs <path-to.dmg>");
    process.exit(2);
  }
  if (process.platform !== "darwin") {
    console.error("check-signed-dmg: this asks Gatekeeper, so it runs on macOS only");
    process.exit(2);
  }
  const result = checkSignedDmg(dmg);
  for (const line of result.notes) console.log(line);
  if (!result.ok) {
    console.error(`check-signed-dmg: ${result.problem}`);
    process.exit(1);
  }
  console.log("check-signed-dmg: the installer is signed, notarised and stapled");
}
