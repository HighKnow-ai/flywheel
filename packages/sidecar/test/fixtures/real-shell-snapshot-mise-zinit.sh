# REAL shell-snapshot content, captured from this machine, NOT hand-written (uat-06b, D-104).
#
# Provenance: an excerpt of ~/.claude/shell-snapshots/snapshot-zsh-1790825015810-muavd4.sh, written
# by `claude 2.1.274` at 2026-10-01 11:23:36 from an ordinary personal Claude Code session. That is
# the snapshot the uat-06b investigation proved, by `cmp`, was the one actually in force in a live
# Claude Code Bash shell on this machine (debug session evidence, 2026-10-01 12:50).
#
# What was changed, and ONLY this: the middle ~3200 lines of zinit function bodies were dropped (the
# original is 3355 lines / 116K), and every occurrence of the capturing developer's home directory
# was rewritten to /Users/example. Nothing else was edited — the `setopt`/alias blocks, the
# rg/find/grep shadow functions, the `pkill` guard function (the marker whose presence in a live
# Bash shell proved the snapshot IS sourced into the shell that runs every agent command), and above
# all the FINAL `export PATH='…'` statement are byte-for-byte as the backend wrote them.
#
# The final statement is the whole point of this fixture. Its first PATH entry is
# /Users/example/.local/share/mise/shims — mise's own shim directory, NOT a Flywheel shim directory.
# That is the measured failing shape: the developer's shell init (mise + zinit) recomputes PATH when
# the snapshot is built, so whatever Flywheel prefixed onto PATH before spawning is not necessarily
# position 0 in the shell that actually runs the agent's commands. `destructive-gate.test.mjs`
# rewrites ONLY this one line to produce its passing variant, so the passing and failing arms differ
# in exactly the property under test and in nothing else.
#
# Do not "tidy" this file. Its realism is the assertion.
# Snapshot file
# Unset all aliases to avoid conflicts with functions
unalias -a 2>/dev/null || true
# Functions
.zinit-add-fpath () {
	[[ $1 = (-f|--front) ]] && {
		shift
		integer front=1 
	}
	.zinit-any-to-user-plugin "$1" ""
	local id_as="$1" add_dir="$2" user="${reply[-2]}" plugin="${reply[-1]}" 
	if (( front ))
	then
		fpath[1,0]=${${${(M)user:#%}:+$plugin}:-${ZINIT[PLUGINS_DIR]}/${id_as//\//---}}${add_dir:+/$add_dir} 
	else
		fpath+=(${${${(M)user:#%}:+$plugin}:-${ZINIT[PLUGINS_DIR]}/${id_as//\//---}}${add_dir:+/$add_dir}) 
	fi
}
.zinit-add-report () {
	[[ -n $1 ]] && {
		(( ${+builtins[zpmod]} && 0 )) && zpmod report-append "$1" "$2"$'\n' || ZINIT_REPORTS[$1]+="$2"$'\n' 
	}
	[[ ${ZINIT[DTRACE]} = 1 ]] && {
		(( ${+builtins[zpmod]} )) && zpmod report-append _dtrace/_dtrace "$2"$'\n' || ZINIT_REPORTS[_dtrace/_dtrace]+="$2"$'\n' 
	}
	return 0
}
.zinit-any-to-pid () {
	builtin emulate -LR zsh ${=${options[xtrace]:#off}:+-o xtrace}
	builtin setopt extendedglob typesetsilent noshortloops rcquotes ${${${+REPLY}:#0}:+warncreateglobal}
	1=${~1} 2=${~2} 
	if [[ -n $2 ]]
	then
		if [[ $1 == (%|/)* || ( -z $1 && $2 == /* ) ]]
		then
			.zinit-util-shands-path $1${${(M)1#(%/?|%[^/]|/?)}:+/}$2
			REPLY=${${REPLY:#%*}:+%}$REPLY 
		else
			REPLY=$1${1:+/}$2 
		fi
		return 0
	fi
	if [[ $1 = (%|/|\~)* ]]
	then
		.zinit-util-shands-path $1
		REPLY=${${REPLY:#%*}:+%}$REPLY 
		return 0
	fi
	REPLY=${1//---//} 
	return 0
}
# Shell Options
setopt extendedhistory
setopt nohashdirs
setopt histignoredups
setopt histignorespace
setopt histreduceblanks
setopt histverify
setopt login
setopt promptsubst
setopt sharehistory
# Aliases
alias -- cat='bat --paging=never'
alias -- gb='git branch'
alias -- gcm='git commit -m'
alias -- gco='git checkout'
alias -- gd='git diff'
alias -- gl='git pull'
alias -- gp='git push'
alias -- gst='git status'
alias -- la='eza -la --icons --git'
alias -- lg=lazygit
alias -- ll='eza -l --icons --git'
alias -- ls='eza --icons --git'
alias -- python=python3
alias -- run-help=man
alias -- tree='eza --tree'
alias -- which-command=whence
alias -- zhk='cd ~/cymarechal/HighKnow && zellij --layout highknow attach -c highknow'
alias -- zi=zinit
alias -- zini=zinit
alias -- zpl=zinit
alias -- zplg=zinit
# Check for rg availability
if ! (unalias rg 2>/dev/null; command -v rg) >/dev/null 2>&1; then
  function rg {
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=/Users/example/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command rg ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=rg "$_cc_bin" ${1+"$@"}
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    ARGV0=rg "$_cc_bin" ${1+"$@"}
  else
    (exec -a rg "$_cc_bin" ${1+"$@"})
  fi
}
fi
# Shadow find/grep with embedded bfs/ugrep
unalias find 2>/dev/null || true
unalias grep 2>/dev/null || true
function find {
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=/Users/example/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command find ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"}
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    ARGV0=bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"}
  else
    (exec -a bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"})
  fi
}
function grep {
  local _cc_a
  for _cc_a in ${1+"$@"}; do
    case "$_cc_a" in -*-filter*|-*-pager*|-*-view*|-*-format-open*|-*-config*|---*|-@*|-*-save-config*|-[Zz]*|-[!-]*[Zz]*|--null|--null-data) command grep ${1+"$@"}; return ;; esac
  done
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=/Users/example/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command grep ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"}
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"}
  else
    (exec -a ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"})
  fi
}
# Shadow pkill to refuse patterns matching the CLI process
unalias pkill 2>/dev/null || true
function pkill {
  if [ -n "${CLAUDE_PID:-}" ] && [ -r "/proc/${CLAUDE_PID}/comm" ]; then
    local _cc_skip="" _cc_a
    local -a _cc_probe=()
    for _cc_a in ${1+"$@"}; do
      if [ -n "$_cc_skip" ]; then _cc_skip=""; continue; fi
      case "$_cc_a" in
        --signal) _cc_skip=1 ;;
        --signal=*|-e|--echo) ;;
        -[0-9]*) ;;
        -[PUGOF]?*) _cc_probe+=("$_cc_a") ;;
        -[ABCDEFGHIJKLMNOPQRSTUVWXYZ][ABCDEFGHIJKLMNOPQRSTUVWXYZ0-9]*) ;;
        *) _cc_probe+=("$_cc_a") ;;
      esac
    done
    if command pgrep ${_cc_probe[@]+"${_cc_probe[@]}"} 2>/dev/null | command grep -qx "${CLAUDE_PID}"; then
      printf 'pkill: refusing to run — this pattern matches the Claude CLI process (PID %s). Narrow the pattern, or target your own children with `pkill -P $$ ...`.\n' "${CLAUDE_PID}" >&2
      return 1
    fi
  fi
  command pkill ${1+"$@"}
}
export PATH='/Users/example/.local/share/mise/shims:/opt/homebrew/opt/libpq/bin:/Users/example/google-cloud-sdk/bin:/Users/example/.local/bin:/Users/example/.antigravity-ide/antigravity-ide/bin:/Users/example/.antigravity/antigravity/bin:/Users/example/.bun/bin:/Users/example/go/bin:/opt/homebrew/opt/openjdk/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Applications/Orca.app/Contents/Resources/bin:/Users/example/.local/share/zinit/polaris/bin:/Users/example/.atuin/bin:/Users/example/.cargo/bin:/Users/example/.docker/bin:/Applications/Visual Studio Code.app/Contents/Resources/app/bin:/Users/example/.volta/bin:/Users/example/.asdf/shims:/Users/example/.fnm/aliases/default/bin:/Users/example/Library/pnpm:/Users/example/.yarn/bin:/usr/local/sbin:/nix/var/nix/profiles/default/bin:/Users/example/bin:/Users/example/.nix-profile/bin:/Users/example/.opencode/bin:/Users/example/.vite-plus/bin:/Users/example/.local/share/mise/installs/python/3.13/bin:/Users/example/.local/share/mise/installs/node/22/bin:/Users/example/.local/share/mise/installs/bun/1.3.5/bin:/Users/example/.local/share/mise/installs/go/1.23.12/bin:/Users/example/.local/share/mise/installs/terraform/latest:/Users/example/.local/share/mise/installs/tflint/latest:/Users/example/.local/share/mise/installs/tfsec/latest:/Users/example/.local/share/mise/installs/terraform-docs/latest:/Users/example/.local/share/mise/installs/trivy/latest:/Users/example/.local/share/mise/installs/hadolint/latest:/Users/example/.local/share/mise/installs/yamllint/latest/bin:/Users/example/.local/share/mise/installs/pipx-vulture/latest/bin:/Users/example/.local/share/mise/installs/pipx-commitizen/latest/bin:/Users/example/.local/share/mise/installs/gh/latest/gh_2.93.0_macOS_arm64/bin:/Users/example/.local/share/mise/installs/lazygit/latest:/Users/example/.local/share/mise/installs/pre-commit/latest:/Users/example/.local/share/mise/installs/jq/latest:/Users/example/.local/share/mise/installs/yq/latest:/Users/example/.local/share/mise/installs/shellcheck/latest/shellcheck-v0.11.0:/Users/example/.local/share/mise/installs/actionlint/latest:/Users/example/.local/share/mise/installs/helm/3/darwin-arm64:/Users/example/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/bin:/Users/example/.claude/plugins/cache/impeccable/impeccable/4.0.4/bin:/Users/example/.claude/plugins/cache/ponytail/ponytail/4.10.0/bin'
