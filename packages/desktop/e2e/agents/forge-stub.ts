/**
 * A stub `gh` for the landing flow (issue #1757, ADR 0042): a shell script in a scratch directory that
 * records each call and answers from files beside it, so no flow touches a network or a real account.
 * The core finds it through `FLYWHEEL_FORGE_PATH` (`ForgeCli::from_env`), which puts this directory in
 * front of the login `PATH` the core adopts at start.
 *
 * - `calls`: one line for each call, the arguments as given.
 * - `pr-state`: the request's state on the stub's "forge" (`OPEN`, `MERGED`, `CLOSED`). No file means no
 *   request. `pr create` writes `OPEN`; a flow writes `MERGED` to play the forge merging it.
 * - `signed-out`: when present, `auth status` fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REQUEST_URL = "https://github.com/acme/threadfin/pull/7";

const GH = `#!/bin/sh
dir=$(dirname "$0")
echo "$@" >> "$dir/calls"
case "$1 $2" in
  "auth status")
    if [ -f "$dir/signed-out" ]; then echo "You are not logged in. Run: gh auth login" >&2; exit 1; fi
    exit 0 ;;
  "pr view")
    if [ -f "$dir/pr-state" ]; then
      printf '{"state":"%s","url":"${REQUEST_URL}"}\\n' "$(cat "$dir/pr-state")"
    else
      echo 'no pull requests found for branch' >&2; exit 1
    fi ;;
  "pr create") echo OPEN > "$dir/pr-state"; echo "${REQUEST_URL}" ;;
  "pr merge") exit 0 ;;
esac
`;

export interface ForgeStub {
  dir: string;
  /** Every recorded call, in order. */
  calls(): string[];
  /** Play the forge: the request is now in this state. */
  setRequestState(state: "OPEN" | "MERGED" | "CLOSED"): void;
  remove(): void;
}

export function makeForgeStub(): ForgeStub {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-forge-")));
  fs.writeFileSync(path.join(dir, "gh"), GH, { mode: 0o755 });
  return {
    dir,
    calls: () => {
      try {
        return fs.readFileSync(path.join(dir, "calls"), "utf8").split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    setRequestState: (state) => fs.writeFileSync(path.join(dir, "pr-state"), `${state}\n`),
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
