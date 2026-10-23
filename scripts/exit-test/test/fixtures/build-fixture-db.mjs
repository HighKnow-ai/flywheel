#!/usr/bin/env node
/**
 * Builds a Flywheel DB from the core's migrations and flywheel-fixture.sql.
 *
 *   node scripts/exit-test/test/fixtures/build-fixture-db.mjs <out.db> [last-migration]
 *
 * `last-migration` (e.g. `0004`) stops after that migration; without it every migration runs. The
 * committed flywheel.db beside this file is this script's output with no limit: rebuild it when a
 * migration changes a table the exit-test script reads. The test also calls `buildFixtureDb` to make
 * a database stopped at 0004, the oldest schema the script reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../../packages/core/src/db/migrations");

export async function buildFixtureDb(outPath, lastMigration) {
  const { DatabaseSync } = await import("node:sqlite");
  fs.rmSync(outPath, { force: true });
  const db = new DatabaseSync(outPath);
  try {
    const migrations = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()
      .filter((f) => lastMigration === undefined || f.slice(0, 4) <= lastMigration);
    for (const file of migrations) db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    db.exec(`PRAGMA user_version = ${migrations.length}`);
    db.exec(fs.readFileSync(path.join(here, "flywheel-fixture.sql"), "utf8"));
    db.exec("VACUUM");
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, last] = process.argv.slice(2);
  if (!out) {
    console.error("usage: build-fixture-db.mjs <out.db> [last-migration]");
    process.exit(2);
  }
  await buildFixtureDb(path.resolve(out), last);
}
