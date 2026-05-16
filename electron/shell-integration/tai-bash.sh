# tai shell integration for bash — emits OSC 133 semantic prompts.
# Sourced after the user's rc files; safe to re-source.

[ -z "$PS1" ] && return 0
case "$TERM" in dumb) return 0 ;; esac

__tai_osc133() { printf '\033]133;%s\007' "$1"; }

__tai_precmd() {
  local __ec=$?
  if [ -n "$__TAI_CMD_ACTIVE" ]; then
    __tai_osc133 "D;$__ec"
    __TAI_CMD_ACTIVE=
  fi
  __tai_osc133 "A"
}

__tai_preexec_dbg() {
  # Fires for every command in the prompt's command list; only the first one
  # after a fresh prompt is the user's command.
  [ -n "$COMP_LINE" ] && return
  [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
  if [ -z "$__TAI_CMD_ACTIVE" ]; then
    __tai_osc133 "C"
    __TAI_CMD_ACTIVE=1
  fi
}

# Mark prompt-end (B) inside PS1 itself so it appears at the exact boundary
# between prompt display and command line. \[ \] keeps bash's line-length math
# correct.
case "$PS1" in
  *$'\001\033]133;B\007\002'*) ;;
  *) PS1='\[\033]133;B\007\]'"$PS1" ;;
esac

PROMPT_COMMAND="__tai_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
trap '__tai_preexec_dbg' DEBUG

export TAI_SHELL_INTEGRATION=1
