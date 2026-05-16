# tai shell integration for bash — emits OSC 133 semantic prompts.
# Sourced after the user's rc files; safe to re-source (idempotent).

# Interactive-shell guard. Avoid testing $PS1 — some prompt managers
# (starship, oh-my-bash, custom PROMPT_COMMAND themes) leave it empty and
# print the prompt directly from a hook, which would otherwise make us bail.
case "$-" in *i*) ;; *) return 0 ;; esac
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
  # Replay the user's PROMPT_COMMAND FIRST — any PS1 rebuilds it does need to
  # happen before we layer B onto the (possibly new) PS1. DEBUG fires here
  # stay quiet because __TAI_INTERACTIVE_MODE is still empty.
  if [ -n "$__tai_user_pc" ]; then
    eval "$__tai_user_pc"
  fi
  # Now decide how to emit B:
  #   - PS1 non-empty: append B (idempotent); fires after the visible prompt
  #     characters when bash expands PS1.
  #   - PS1 empty: user's PROMPT_COMMAND drew the prompt itself (starship,
  #     oh-my-bash). PS1 expansion is a no-op, so emit B inline — the
  #     prompt characters have already been printed by this point.
  if [ -z "$PS1" ]; then
    __tai_osc133 "B"
  else
    case "$PS1" in
      *'\[\033]133;B\007\]'*) ;;
      *) PS1="${PS1}"'\[\033]133;B\007\]' ;;
    esac
  fi
  # Arm preexec: the next DEBUG trap fire is the user's typed command.
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
