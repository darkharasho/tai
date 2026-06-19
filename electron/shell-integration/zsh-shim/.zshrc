# TAI zsh shim — source the user's real .zshrc, then load the TAI integration
# (after the user's prompt/hooks are in place), then restore ZDOTDIR so child
# shells and the user's .zlogin use normal config.
[ -f "$TAI_ZDOTDIR_USER/.zshrc" ] && source "$TAI_ZDOTDIR_USER/.zshrc"
[ -f "$TAI_ZSH_INTEGRATION" ] && source "$TAI_ZSH_INTEGRATION"
if [ -n "$TAI_ZDOTDIR_WAS_SET" ]; then
  export ZDOTDIR="$TAI_ZDOTDIR_USER"
else
  unset ZDOTDIR
fi
