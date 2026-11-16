// `npm --prefix packages/desktop run e2e [-- <playwright args>] [--update]`
//
// Stages the headless core and the sidecar, then runs Playwright against the real renderer. With
// `--update` a flow whose recorded trace differs from its sequence diagram rewrites the diagram in
// `docs/flows/` instead of failing; read the diff before you commit it.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stage } from "./stage.mjs";

const args = process.argv.slice(2);
const update = args.includes("--update");
const passthrough = args.filter((a) => a !== "--update");

const nice = (command, argv, options) =>
  spawnSync("nice", ["-n", "15", command, ...argv], { stdio: "inherit", ...options });

stage();
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = nice("npx", ["playwright", "test", ...passthrough], {
  cwd: desktop,
  env: { ...process.env, ...(update ? { FLYWHEEL_E2E_UPDATE: "1" } : {}) },
});
process.exit(result.status ?? 1);
