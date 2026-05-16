# tai shell integration for bash — emits OSC 133 semantic prompts.
# Sourced after the user's rc files; safe to re-source (idempotent).

[ -z "$PS1" ] && return 0
case "$TERM" in dumb) return 0 ;; esac
[ -n "$__TAI_LOADED" ] && return 0
__TAI_LOADED=1

__tai_osc133() { printf '\033]133;%s\007' "$1"; }

# Snapshot the user's existing PROMPT_COMMAND once so we can replay it inside
# our wrapper. This lets us own the state machine (DEBUG trap correctness)
# without breaking user/theme hooks.
__tai_user_pc="${PROMPT_COMMAND}"

__tai_prompt_invoke() {
  local __ec=$?
  if [ -n "$__TAI_CMD_ACTIVE" ]; then
    __tai_osc133 "D;$__ec"
    __TAI_CMD_ACTIVE=
  fi
  __tai_osc133 "A"
  # Re-inject the prompt-end marker every precmd so themes that rebuild PS1
  # (powerlevel10k, starship, oh-my-bash) can't strip it permanently.
  case "$PS1" in
    *$'\001\033]133;B\007\002'*) ;;
    *) PS1='\[\033]133;B\007\]'"$PS1" ;;
  esac
  # Replay user's original PROMPT_COMMAND inside our state — DEBUG fires here
  # are still suppressed because __TAI_INTERACTIVE_MODE is empty.
  if [ -n "$__tai_user_pc" ]; then
    eval "$__tai_user_pc"
  fi
  # Arm preexec: the *next* DEBUG trap fire is the user's typed command.
  __TAI_INTERACTIVE_MODE=1
}

__tai_preexec() {
  # Tab completion shells out internally; ignore.
  [ -n "$COMP_LINE" ] && return
  # Suppress DEBUG noise that doesn't correspond to user-typed commands.
  [ -z "$__TAI_INTERACTIVE_MODE" ] && return
  __TAI_INTERACTIVE_MODE=
  __TAI_CMD_ACTIVE=1
  __tai_osc133 "C"
}

PROMPT_COMMAND="__tai_prompt_invoke"
trap '__tai_preexec' DEBUG

export TAI_SHELL_INTEGRATION=1
