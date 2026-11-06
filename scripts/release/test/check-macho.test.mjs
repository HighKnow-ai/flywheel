// The Mach-O guard. dyld_info's output is judged as an allow-list, so an error nobody
// has seen yet is refused; the LINKEDIT read is judged on fabricated headers, because the tool on a
// CI runner cannot be made to object to them; and the last test runs the real tool on the real Node
// binary running this file, so a change in what dyld_info prints fails on a pull request and not at
// a release.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { REQUIRED_IN_APP, checkPaths, dyldObjection, isMachO, linkeditObjection } from "../check-macho.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../check-macho.mjs");

const CLEAN = [
  "target/release/flywheel-desktop [arm64]:",
  "    -platform:",
  "        platform     minOS      sdk",
  "           macOS     11.0      15.5   ",
  "",
].join("\n");

/** A little-endian 64-bit Mach-O header with one LC_SYMTAB and one LC_DYSYMTAB, and nothing else. */
function macho({ symoff = 4096, nsyms = 1, stroff = 4112, strsize = 8, indirectoff = 4104, nindirect = 1 } = {}) {
  const b = Buffer.alloc(32 + 24 + 80);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(2, 16);
  b.writeUInt32LE(24 + 80, 20);
  let at = 32;
  b.writeUInt32LE(0x2, at);
  b.writeUInt32LE(24, at + 4);
  b.writeUInt32LE(symoff, at + 8);
  b.writeUInt32LE(nsyms, at + 12);
  b.writeUInt32LE(stroff, at + 16);
  b.writeUInt32LE(strsize, at + 20);
  at += 24;
  b.writeUInt32LE(0xb, at);
  b.writeUInt32LE(80, at + 4);
  b.writeUInt32LE(indirectoff, at + 56);
  b.writeUInt32LE(nindirect, at + 60);
  return b;
}

/** Wraps a thin Mach-O as the one slice of a fat file, at offset 4096. */
function fat(thin) {
  const head = Buffer.alloc(4096);
  head.writeUInt32BE(0xcafebabe, 0);
  head.writeUInt32BE(1, 4);
  head.writeUInt32BE(4096, 8 + 8);
  return Buffer.concat([head, thin]);
}

/** A scratch directory, removed afterwards, whose `xcrun` is a stub that prints `report`. */
function withStub(report, status, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-macho-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "report.txt"), report);
    fs.writeFileSync(path.join(bin, "xcrun"), `#!/bin/sh\ncat "${bin}/report.txt"\nexit ${status}\n`, { mode: 0o755 });
    return body(dir, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(env, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("a clean dyld_info report is accepted", () => {
  assert.equal(dyldObjection(CLEAN, 0), null);
});

test("dyld_info's error is refused, and named", () => {
  const report = "target/release/flywheel-desktop [arm64]:\n   mis-aligned LINKEDIT string pool, fileOffset=0x0023E5B4\n";
  assert.match(dyldObjection(report, 1), /mis-aligned LINKEDIT string pool, fileOffset=0x0023E5B4/);
});

test("an error line nobody has seen yet is refused, even when dyld_info exits 0", () => {
  assert.match(dyldObjection(`${CLEAN}   some objection from a later dyld\n`, 0), /some objection from a later dyld/);
});

test("a failing exit status is refused on a clean report", () => {
  assert.match(dyldObjection(CLEAN, 1), /exited 1/);
});

test("a report with no platform section is refused, which is what a non-Mach-O gets", () => {
  assert.match(dyldObjection("", 0), /no platform report/);
  assert.match(dyldObjection("target/release/x [arm64]:\n", 0), /no platform report/);
});

test("well-aligned LINKEDIT tables pass, thin and fat", () => {
  assert.equal(linkeditObjection(macho()), null);
  assert.equal(linkeditObjection(fat(macho())), null);
});

test("the string table 4 bytes off is refused, thin and fat: this is the hazard itself", () => {
  const off = macho({ stroff: 4108 });
  assert.match(linkeditObjection(off), /string table is misaligned, at offset 4108/);
  assert.match(linkeditObjection(fat(off)), /string table is misaligned/);
});

test("the other tables are held to their own alignment", () => {
  assert.match(linkeditObjection(macho({ symoff: 4100 })), /symbol table is misaligned/);
  assert.match(linkeditObjection(macho({ indirectoff: 4102 })), /indirect symbol table is misaligned/);
  assert.equal(linkeditObjection(macho({ indirectoff: 4100 })), null, "4 is the indirect table's alignment");
});

test("an empty table has no alignment to get wrong", () => {
  assert.equal(linkeditObjection(macho({ stroff: 4108, strsize: 0 })), null);
});

test("what this cannot read is refused rather than passed", () => {
  const big = Buffer.alloc(64);
  big.writeUInt32BE(0xfeedfacf, 0);
  assert.match(linkeditObjection(big), /not a little-endian 64-bit/);
  assert.match(linkeditObjection(macho().subarray(0, 40)), /past the end/);
});

test("isMachO knows a Mach-O, a fat file, a script and a Java class file apart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-macho-"));
  try {
    assert.equal(isMachO(write(dir, "thin", macho())), true);
    assert.equal(isMachO(write(dir, "fat", fat(macho()))), true);
    assert.equal(isMachO(write(dir, "launcher.sh", "#!/bin/sh\nexec node\n")), false);
    assert.equal(isMachO(write(dir, "short", "ab")), false);
    assert.equal(isMachO(write(dir, "A.class", Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 65]))), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bundle whose every Mach-O passes passes, and a script in it is not asked about", () => {
  withStub(CLEAN, 0, (dir, env) => {
    for (const name of REQUIRED_IN_APP) write(dir, `Flywheel.app/Contents/MacOS/${name}`, macho());
    write(dir, "Flywheel.app/Contents/MacOS/flywheel-sidecar", "#!/bin/sh\n");
    write(dir, "Flywheel.app/Contents/Resources/sidecar/dist/index.js", "console.log(1)\n");
    const r = run(env, path.join(dir, "Flywheel.app"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 Mach-O files/);
  });
});

test("a native module deep in the bundle's resources is checked too, and refuses the bundle", () => {
  withStub(CLEAN, 0, (dir, env) => {
    for (const name of REQUIRED_IN_APP) write(dir, `Flywheel.app/Contents/MacOS/${name}`, macho());
    const addon = write(dir, "Flywheel.app/Contents/Resources/sidecar/node_modules/x/x.node", macho({ stroff: 4108 }));
    const r = run(env, path.join(dir, "Flywheel.app"));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(addon), r.stderr);
    assert.match(r.stderr, /string table is misaligned/);
  });
});

test("the LINKEDIT read refuses what a lenient dyld_info passes: the macos-15 case", () => {
  withStub(CLEAN, 0, (dir, env) => {
    const r = run(env, write(dir, "flywheel-desktop", macho({ stroff: 4108 })));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /string table is misaligned/);
  });
});

test("dyld_info's objection refuses a binary the LINKEDIT read passes", () => {
  const report = "flywheel-shim [arm64]:\n   LINKEDIT overlap of a and b\n";
  withStub(report, 1, (dir, env) => {
    const r = run(env, write(dir, "flywheel-shim", macho()));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /LINKEDIT overlap of a and b/);
  });
});

test("a .app missing a binary it must carry is refused, naming it", () => {
  withStub(CLEAN, 0, (dir, env) => {
    write(dir, "Flywheel.app/Contents/MacOS/flywheel-desktop", macho());
    write(dir, "Flywheel.app/Contents/MacOS/flywheel-node", macho());
    const r = run(env, path.join(dir, "Flywheel.app"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /flywheel-shim: a bundle must carry this as a Mach-O/);
  });
});

test("a file named on the command line that is not a Mach-O is refused", () => {
  withStub(CLEAN, 0, (dir, env) => {
    const r = run(env, write(dir, "flywheel-shim", "#!/bin/sh\n"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a Mach-O/);
  });
});

test("a directory with no Mach-O in it fails, rather than passing by checking nothing", () => {
  withStub(CLEAN, 0, (dir, env) => {
    write(dir, "empty/readme.txt", "nothing\n");
    const r = run(env, path.join(dir, "empty"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nothing was checked/);
  });
});

test("a missing path fails, and no paths at all is a usage error", () => {
  withStub(CLEAN, 0, (dir, env) => {
    assert.equal(run(env, path.join(dir, "nowhere")).status, 1);
    assert.equal(run(env).status, 2);
  });
});

test("an xcrun that cannot run is a refusal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-macho-"));
  const before = process.env.PATH;
  try {
    process.env.PATH = path.join(dir, "no-such-bin");
    const { refusals } = checkPaths([write(dir, "flywheel-shim", macho())]);
    assert.equal(refusals.length, 1);
    assert.match(refusals[0].why, /xcrun did not run/);
  } finally {
    process.env.PATH = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const hasXcrun = spawnSync("xcrun", ["--find", "dyld_info"], { encoding: "utf8" }).status === 0;
test(
  "the real dyld_info's report on a real binary is inside the allow-list",
  { skip: hasXcrun ? false : "no xcrun dyld_info on this machine" },
  () => {
    const { checked, refusals } = checkPaths([process.execPath]);
    assert.deepEqual(refusals, []);
    assert.equal(checked, 1);
  },
);
