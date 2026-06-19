# tai shell integration for zsh — emits OSC 133 semantic prompts plus
# OSC 6973 JSON sidechannel for structured command metadata.
# Sourced after the user's .zshrc; safe to re-source.

[[ -o interactive ]] || return 0
[[ "$TERM" == "dumb" ]] && return 0

# Prevent the injected `. '<path>'` bootstrap line from being written to the
# history file. We only set HISTORY_IGNORE if the user hasn't already set it;
# clobbering a user-defined value would silently drop unrelated commands.
# ${(%):-%x} expands to the current file's path; :t gives the basename.
if [[ -z "${HISTORY_IGNORE+x}" ]]; then
  HISTORY_IGNORE="(. *${${(%):-%x}:t}*|source *${${(%):-%x}:t}*)"
fi

# zsh's EPOCHREALTIME comes from the datetime module. Load best-effort; the
# emitter falls back to $(date +%s)000 if it isn't available.
zmodload zsh/datetime 2>/dev/null

__tai_osc133() { print -nu1 $'\e]133;'"$1"$'\a'; }

# OSC 6973: hex-encoded JSON sidechannel. Hex avoids needing to escape OSC
# terminators or control bytes inside the payload.
__tai_osc6973() {
  local json="$1"
  local hex
  if (( $+commands[xxd] )); then
    hex=$(print -rn -- "$json" | xxd -p -c 99999 | tr -d '\n')
  else
    hex=$(print -rn -- "$json" | od -An -tx1 | tr -d ' \n')
  fi
  print -nu1 $'\e]6973;'"$hex"$'\a'
}

# Escape a string for embedding inside a JSON string literal. Handles all C0
# control bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) as \u00XX per RFC 8259, in
# addition to \, ", \n, \r, \t. Copied from tai-bash.sh so the two stay in
# lockstep.
__tai_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\x01'/\\u0001}"
  s="${s//$'\x02'/\\u0002}"
  s="${s//$'\x03'/\\u0003}"
  s="${s//$'\x04'/\\u0004}"
  s="${s//$'\x05'/\\u0005}"
  s="${s//$'\x06'/\\u0006}"
  s="${s//$'\x07'/\\u0007}"
  s="${s//$'\x08'/\\u0008}"
  s="${s//$'\x0b'/\\u000b}"
  s="${s//$'\x0c'/\\u000c}"
  s="${s//$'\x0e'/\\u000e}"
  s="${s//$'\x0f'/\\u000f}"
  s="${s//$'\x10'/\\u0010}"
  s="${s//$'\x11'/\\u0011}"
  s="${s//$'\x12'/\\u0012}"
  s="${s//$'\x13'/\\u0013}"
  s="${s//$'\x14'/\\u0014}"
  s="${s//$'\x15'/\\u0015}"
  s="${s//$'\x16'/\\u0016}"
  s="${s//$'\x17'/\\u0017}"
  s="${s//$'\x18'/\\u0018}"
  s="${s//$'\x19'/\\u0019}"
  s="${s//$'\x1a'/\\u001a}"
  s="${s//$'\x1b'/\\u001b}"
  s="${s//$'\x1c'/\\u001c}"
  s="${s//$'\x1d'/\\u001d}"
  s="${s//$'\x1e'/\\u001e}"
  s="${s//$'\x1f'/\\u001f}"
  print -rn -- "$s"
}

__tai_now_ms() {
  if [[ -n "$EPOCHREALTIME" ]]; then
    local s="${EPOCHREALTIME%.*}"
    local us="${EPOCHREALTIME#*.}"
    us="${us:0:3}"
    print -rn -- "${s}${us}"
  else
    print -rn -- "$(date +%s)000"
  fi
}

__tai_precmd() {
  local __ec=$?
  if [[ -n "$__TAI_CMD_ACTIVE" ]]; then
    # Emit precmd OSC 6973 before the D marker so consumers see structured
    # metadata in the same block transition.
    local end duration_ms cwd_esc cmd_esc signal
    end=$(__tai_now_ms)
    if [[ -n "$__TAI_CMD_START" && "$__TAI_CMD_START" -gt 0 ]] 2>/dev/null; then
      duration_ms=$(( end - __TAI_CMD_START ))
    else
      duration_ms=0
    fi
    cwd_esc=$(__tai_json_escape "$PWD")
    cmd_esc=$(__tai_json_escape "${__TAI_CMD_LINE-}")
    if [[ "$__ec" -gt 128 && "$__ec" -lt 165 ]] 2>/dev/null; then
      signal="\"SIG$(( __ec - 128 ))\""
    else
      signal="null"
    fi
    __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":${__ec},\"signal\":${signal},\"duration_ms\":${duration_ms},\"command\":\"${cmd_esc}\",\"cwd\":\"${cwd_esc}\"}"

    __tai_osc133 "D;$__ec"
    __TAI_CMD_ACTIVE=
    __TAI_CMD_LINE=
    __TAI_CMD_START=
  fi
  __tai_osc133 "A"
  # Re-inject the prompt-end marker every precmd so themes that rebuild PS1
  # (powerlevel10k, starship) can't strip it permanently.
  if [[ "$PS1" != *$'\e]133;B\a'* ]]; then
    PS1=$'%{\e]133;B\a%}'"$PS1"
  fi
}

__tai_preexec() {
  # zsh's preexec receives the full command line as $1.
  __TAI_CMD_LINE="$1"
  __TAI_CMD_START=$(__tai_now_ms)
  __TAI_CMD_ACTIVE=1
  local cmd_esc
  cmd_esc=$(__tai_json_escape "$1")
  __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"${cmd_esc}\"}"
  __tai_osc133 "C"
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
