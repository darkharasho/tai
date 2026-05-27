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
# our wrapper.
__tai_user_pc="${PROMPT_COMMAND}"

__tai_prompt_invoke() {
  local __ec=$?
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
# preexec moment, exactly where the segmenter needs OSC 133 C to transition
# from 'command' to 'output' phase. Using PS0 avoids fighting other
# integrations (Ptyxis/vte, bash-preexec) for the DEBUG trap, which they
# tend to reinstall on every prompt cycle. Empty Enter still expands PS0,
# but the resulting empty-command block is dropped by the segmenter.
PS0=$'\e]133;C\a'
PROMPT_COMMAND="__tai_prompt_invoke"

export TAI_SHELL_INTEGRATION=1
