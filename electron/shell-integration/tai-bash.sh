# tai shell integration for bash — emits OSC 133 semantic prompts plus
# OSC 6973 JSON sidechannel for structured command metadata.
# Sourced after the user's rc files; safe to re-source (idempotent).

# Interactive-shell guard. Avoid testing $PS1 — some prompt managers
# (starship, oh-my-bash, custom PROMPT_COMMAND themes) leave it empty and
# print the prompt directly from a hook, which would otherwise make us bail.
case "$-" in *i*) ;; *) return 0 ;; esac
case "$TERM" in dumb) return 0 ;; esac
[ -n "$__TAI_LOADED" ] && return 0
__TAI_LOADED=1

__tai_osc133() { printf '\033]133;%s\007' "$1"; }

# OSC 6973: hex-encoded JSON sidechannel. Hex avoids needing to escape OSC
# terminators or control bytes inside the payload.
__tai_osc6973() {
  local json="$1"
  local hex
  if command -v xxd >/dev/null 2>&1; then
    hex=$(printf '%s' "$json" | xxd -p -c 99999 | tr -d '\n')
  else
    hex=$(printf '%s' "$json" | od -An -tx1 | tr -d ' \n')
  fi
  printf '\033]6973;%s\007' "$hex"
}

__tai_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

__tai_now_ms() {
  if [ -n "$EPOCHREALTIME" ]; then
    local s="${EPOCHREALTIME%.*}"
    local us="${EPOCHREALTIME#*.}"
    us="${us:0:3}"
    printf '%s%s' "$s" "$us"
  else
    printf '%s000' "$(date +%s)"
  fi
}

# PS0 expands inside a command-substitution subshell, so variable assignments
# made there are lost. We persist the per-command preexec state through a
# tempfile dir so __tai_prompt_invoke (running in the parent shell) can see
# whether a command was actually executed and recover its start time.
__TAI_STATE_DIR="${TMPDIR:-/tmp}/tai-bash-$$"
mkdir -p "$__TAI_STATE_DIR" 2>/dev/null
# Best-effort cleanup on shell exit. We don't replace any existing EXIT trap.
__tai_existing_exit_trap=$(trap -p EXIT)
if [ -z "$__tai_existing_exit_trap" ]; then
  trap 'rm -rf "$__TAI_STATE_DIR"' EXIT
fi

__tai_preexec_emit() {
  # Recover the command line from history. Readline updates history before
  # PS0 expands, so `history 1` is reliable here. $BASH_COMMAND would refer
  # to the command-substitution itself, not the user's command, so we cannot
  # use it from within PS0.
  local line
  line=$(HISTTIMEFORMAT='' history 1 2>/dev/null)
  # Strip the leading "  NNN  " history index.
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#* }"
  line="${line#"${line%%[![:space:]]*}"}"
  printf '%s' "$line" > "$__TAI_STATE_DIR/cmd" 2>/dev/null
  __tai_now_ms > "$__TAI_STATE_DIR/start" 2>/dev/null
  : > "$__TAI_STATE_DIR/pending" 2>/dev/null
  local cmd_esc
  cmd_esc=$(__tai_json_escape "$line")
  __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"$cmd_esc\"}"
}

# Snapshot the user's existing PROMPT_COMMAND once so we can replay it inside
# our wrapper.
__tai_user_pc="${PROMPT_COMMAND}"

__tai_prompt_invoke() {
  local __ec=$?
  # Emit precmd before D so consumers see structured metadata in the same
  # block transition. Only fires if a command actually ran (pending marker
  # was written by PS0 expansion).
  if [ -f "$__TAI_STATE_DIR/pending" ]; then
    local start cmd end duration_ms cwd_esc cmd_esc signal
    start=$(cat "$__TAI_STATE_DIR/start" 2>/dev/null || printf 0)
    cmd=$(cat "$__TAI_STATE_DIR/cmd" 2>/dev/null || printf '')
    end=$(__tai_now_ms)
    if [ "$start" -gt 0 ] 2>/dev/null; then
      duration_ms=$((end - start))
    else
      duration_ms=0
    fi
    cwd_esc=$(__tai_json_escape "$PWD")
    cmd_esc=$(__tai_json_escape "$cmd")
    if [ "$__ec" -gt 128 ] 2>/dev/null && [ "$__ec" -lt 165 ] 2>/dev/null; then
      signal="\"SIG$((__ec - 128))\""
    else
      signal="null"
    fi
    __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":$__ec,\"signal\":$signal,\"duration_ms\":$duration_ms,\"command\":\"$cmd_esc\",\"cwd\":\"$cwd_esc\"}"
    rm -f "$__TAI_STATE_DIR/pending" 2>/dev/null
  fi

  __tai_osc133 "D;$__ec"
  __tai_osc133 "A"
  # Replay the user's PROMPT_COMMAND FIRST — any PS1 rebuilds it does need to
  # happen before we layer B onto the (possibly new) PS1.
  if [ -n "$__tai_user_pc" ]; then
    eval "$__tai_user_pc"
  fi
  # Decide how to emit B:
  #   - PS1 non-empty: append B (idempotent); fires after the visible prompt
  #     characters when bash expands PS1.
  #   - PS1 empty: user's PROMPT_COMMAND drew the prompt itself (starship,
  #     oh-my-bash). PS1 expansion is a no-op, so emit B inline.
  if [ -z "$PS1" ]; then
    __tai_osc133 "B"
  else
    case "$PS1" in
      *'\[\033]133;B\007\]'*) ;;
      *) PS1="${PS1}"'\[\033]133;B\007\]' ;;
    esac
  fi
}

# PS0 expands after Enter but before bash runs the command — that's the
# preexec moment. We emit both OSC 133 C (segmenter phase transition) and
# OSC 6973 preexec (structured metadata). Using PS0 avoids fighting other
# integrations (Ptyxis/vte, bash-preexec) for the DEBUG trap, which they
# tend to reinstall on every prompt cycle. Empty Enter still expands PS0,
# but the resulting empty-command block is dropped by the segmenter.
PS0=$'\e]133;C\a$(__tai_preexec_emit)'
PROMPT_COMMAND="__tai_prompt_invoke"

export TAI_SHELL_INTEGRATION=1
