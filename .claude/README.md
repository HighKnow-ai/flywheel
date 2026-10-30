# The agents' sandbox policy

`settings.json` beside this page is the Claude Code policy for every session started at the root
of this repository. HighKnow's agents work in local clones of it, and the policy keeps them away
from the credentials on the machine they run on:

- Every Bash command runs in Claude Code's sandbox (macOS Seatbelt). A session refuses to start
  without it, and a `dangerouslyDisableSandbox` retry still runs sandboxed.
- Neither a sandboxed command nor the Read tool can read a credential store (SSH keys, `gh` logins,
  cloud CLI logins, the npm token in `~/.npmrc`, the keychains, shell history and the others
  listed).
- Commands write only the working directory, `$TMPDIR` and the package-manager caches, and reach
  only GitHub over HTTPS, the npm registry and crates.io. `allowLocalBinding` lets them reach
  services on localhost, which a Postgres client cannot do through the sandbox's proxy.
- The Edit and Write tools cannot change `.claude/`, and `bypassPermissions` mode is off.

Some keys are ignored in a repository's `.claude/settings.json` and have to come from whoever starts
the session: `sandbox.network.strictAllowlist` (without it a host outside the list is a prompt, not
a refusal), `allowManagedHooksOnly` and `allowManagedMcpServersOnly`. Flywheel passes them to the
sessions it starts.

**If Claude Code will not start here**, your platform has no sandbox (native Windows, or Linux
without bubblewrap). Override the policy for yourself in `.claude/settings.local.json` (keep it out of
git), for example `{"sandbox": {"enabled": false}}`.

This file is copied from HighKnow's private repository, where it is maintained and tested.
