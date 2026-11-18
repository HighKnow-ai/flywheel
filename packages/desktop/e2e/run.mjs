// `npm --prefix packages/desktop run e2e [-- <playwright args>] [--update]`
//
// Stages the headless core and the sidecar, then runs Playwright against the real renderer. With
// `--update` a flow whose recorded trace differs from its sequence diagram rewrites the diagram in
// `docs/flows/` instead of failing; read the diff before you commit it.
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stage } from "./stage.mjs";

const args = process.argv.slice(2);
const update = args.includes("--update");
// `--update` rewrites a flow's doc, and a flow runs in both engines: two workers would write one file at
// once. So an update run is one worker, whatever the config and the command line say.
const withoutWorkers = (list) =>
  list.filter((a, i) => !/^--workers(=|$)/.test(a) && !/^--workers$/.test(list[i - 1] ?? ""));
const passthrough = update ? [...withoutWorkers(args.filter((a) => a !== "--update")), "--workers=1"] : args;

const nice = (command, argv, options) =>
  spawnSync("nice", ["-n", "15", command, ...argv], { stdio: "inherit", ...options });

/** A port nothing listens on, from the OS. Vite takes it with `--strictPort`, so a lost race fails loudly. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

stage();
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = nice("npx", ["playwright", "test", ...passthrough], {
  cwd: desktop,
  env: {
    ...process.env,
    // One Vite server for each run, on a port of its own: the gate runner's run and a developer's run on
    // one Mac must not meet on a fixed one (the second stops at "already used"). A caller that sets
    // FLYWHEEL_E2E_PORT keeps its choice.
    FLYWHEEL_E2E_PORT: process.env.FLYWHEEL_E2E_PORT ?? String(await freePort()),
    ...(update ? { FLYWHEEL_E2E_UPDATE: "1" } : {}),
  },
});
process.exit(result.status ?? 1);
