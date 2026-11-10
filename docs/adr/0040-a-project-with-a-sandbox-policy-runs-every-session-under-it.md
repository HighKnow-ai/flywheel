# A project with a sandbox policy runs every session under it, or not at all

A project declares a sandbox policy with the `sandbox` block of its own `.claude/settings.json`, and `sandbox.enabled: true` is what makes it one. A project with no block, or with `enabled` absent or `false`, starts its sessions exactly as before.

For a project with a policy, every session Flywheel starts:

- gets the block through the run's `--settings` file, beside the hooks, with `network.strictAllowlist: true` added;
- is started with `--strict-mcp-config`, so only the server Flywheel passes connects;
- gets its allow rules from `--allowedTools`, as every session already does;
- is refused before its first turn unless a check shows the sandbox is on.

## Why the flags, not the project's own file

Each of these was measured on Claude Code 2.1.311 on macOS, with the real binary:

| What was tried | What happened |
|---|---|
| A project file with `{"sandbox":{"enabled":"yes"}}`, or with a trailing comma | The whole file was dropped. A Bash command wrote outside the working directory, the exit code was 0, and stderr was empty |
| The same mistake in a `--settings` file | Dropped in the same way |
| A valid `sandbox` block in `--settings`, with no project file | A write outside the working directory got `Operation not permitted`; one inside landed |
| `allowedDomains: ["github.com"]` with `strictAllowlist: true` in `--settings`, under `--allowedTools Bash` | `curl` reached github.com (200) and was refused www.wikipedia.org: `host is not on the allow list`. With no sandbox, both answered 200 |
| A repository `.mcp.json` server, no flag | The server process was spawned, and `init` listed it with source `project` |
| The same server, with `--strict-mcp-config` | Not spawned, and `init` listed no server |

Measurements made earlier on 2.1.308 add two that were not repeated here: `sandbox.network.strictAllowlist` is honoured only from user, managed and `--settings` settings and is silently ignored in a project file, and a project's `permissions.allow` and `additionalDirectories` aren't used under `-p`, which is why allow rules come from `--allowedTools`.

So a project's policy has to be re-passed by whatever starts the session, and nothing inside a settings file can report that the file was dropped.

## The check

Before the first turn, `sandbox-policy.ts` starts the real binary with the session's own `--settings` file and working directory, pointed at a stub Messages API on a loopback port. The stub answers the first request with one Bash call and the second with the end of the turn. The command writes one file inside the working directory and one in the home directory. Sandbox on means the first exists and the second does not; the run fails otherwise, with a reason on `session_closed`.

- **No model.** The command is the command, it takes under a second, it spends nothing, and the check's only "login" is a made-up API key sent to the stub. The session's own credentials are removed from the check's environment.
- **`--bare`, for the check only.** It skips the repository's hooks, which would otherwise run before the check has answered. A bare start and a plain one had the same sandbox against valid, mistyped and absent policies. A session itself is never bare.
- **Both files are the answer.** Under `--allowedTools 'Bash(touch *)'` with no sandbox, Claude Code's permission layer refused the outside path and nothing was written. A check of the outside file alone reads that as a sandbox that holds. So the check allows every Bash command, and a run that wrote neither file refuses too. It is why a hang, or a backend that exits early, refuses instead of passing.

We rejected:

- **Asking a real model to run the command.** It costs a turn per session, and a model that declines looks like a broken sandbox.
- **A hook that writes outside the sandbox.** A hook in the settings file goes with the file, and hooks run outside the sandbox, so its write proves nothing.
- **A setting of Flywheel's own.** It would be one more place to keep a policy in step, and a project's sandbox should hold in a plain `claude` as well.

## Consequences

- A project whose settings file doesn't parse has a policy only if the text mentions `sandbox`. One that never meant a sandbox still starts, as it did. A misspelt `"sandbx"` key parses and reads as no policy here: catching that takes a schema check where the file is committed.
- A settings file that fails validation for a reason outside `sandbox` still loses its deny rules, while the block Flywheel re-passes holds and the check passes. Flywheel re-passes the sandbox and nothing else.
- A session with a policy starts up to a second later, and a Stop pressed during the check finds no live session. The session then starts if the check passes.
- A session with a policy whose `--settings` file can't be written is refused, where one without a policy still degrades to no hook.
