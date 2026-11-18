// Fails when a process the sidecar suite recorded as stubborn is still alive after the suite.
//
// Reads every pid file in FLYWHEEL_STUBBORN_DIR (written by `test/fake-claude.mjs` for the
// suite's own sessions), so it never matches a process by its command line and never sees a
// process another job started. A survivor is ended, listed, and fails the check.
import fs from "node:fs";
import path from "node:path";

import { killSurvivors } from "../test/stubborn-children.mjs";

const dir = process.env.FLYWHEEL_STUBBORN_DIR;
if (!dir) {
  console.error("check-no-stubborn-left: FLYWHEEL_STUBBORN_DIR is not set; run it through `npm test`.");
  process.exit(2);
}

const leaked = [];
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!name.endsWith(".pids")) continue;
  for (const pid of killSurvivors(path.join(dir, name))) leaked.push(`${pid} (${name})`);
}
if (leaked.length > 0) {
  console.error(`check-no-stubborn-left: the suite left stubborn processes running (ended now): ${leaked.join(", ")}`);
  process.exit(1);
}
console.log("check-no-stubborn-left: no stubborn process of the suite is left.");
