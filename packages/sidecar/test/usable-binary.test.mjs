import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { unusableReason } from "./usable-binary.mjs";

// POSITIVE CONTROL: the empty stand-in is refused with a reason, never treated as present.
test("an empty stand-in and a non-executable file are refused, a real executable is not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usable-binary-"));
  try {
    const standIn = path.join(dir, "stand-in");
    fs.writeFileSync(standIn, "");
    assert.match(unusableReason(standIn), /empty/);
    const plain = path.join(dir, "plain");
    fs.writeFileSync(plain, "#!/bin/sh\n", { mode: 0o644 });
    assert.equal(unusableReason(plain, { needsExecBit: true }), "not executable");
    assert.equal(unusableReason(plain, { needsExecBit: false }), undefined);
    const real = path.join(dir, "real");
    fs.writeFileSync(real, "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(unusableReason(real), undefined);
    assert.equal(unusableReason(path.join(dir, "none")), "missing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
