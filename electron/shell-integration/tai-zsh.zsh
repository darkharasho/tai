# tai shell integration for zsh — emits OSC 133 semantic prompts.
# Sourced after the user's .zshrc; safe to re-source.

[[ -o interactive ]] || return 0
[[ "$TERM" == "dumb" ]] && return 0

__tai_osc133() { print -nu1 $'\e]133;'"$1"$'\a'; }

__tai_precmd() {
  local __ec=$?
  if [[ -n "$__TAI_CMD_ACTIVE" ]]; then
    __tai_osc133 "D;$__ec"
    __TAI_CMD_ACTIVE=
  fi
  __tai_osc133 "A"
}

__tai_preexec() {
  __tai_osc133 "C"
  __TAI_CMD_ACTIVE=1
}

autoload -Uz add-zsh-hook 2>/dev/null
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd __tai_precmd
  add-zsh-hook preexec __tai_preexec
else
  precmd_functions+=(__tai_precmd)
  preexec_functions+=(__tai_preexec)
fi

# Inject prompt-end marker into PS1 (idempotent).
if [[ "$PS1" != *$'\e]133;B\a'* ]]; then
  PS1=$'%{\e]133;B\a%}'"$PS1"
fi

export TAI_SHELL_INTEGRATION=1
