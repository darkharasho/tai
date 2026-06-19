# TAI zsh shim — safety net. In the normal login flow .zshrc already restored
# ZDOTDIR, so zsh reads the user's real .zlogin from their dir and this file is
# not read. It only runs if .zshrc was somehow skipped; keep behavior correct.
[ -f "$TAI_ZDOTDIR_USER/.zlogin" ] && source "$TAI_ZDOTDIR_USER/.zlogin"
if [ -n "$TAI_ZDOTDIR_WAS_SET" ]; then
  export ZDOTDIR="$TAI_ZDOTDIR_USER"
else
  unset ZDOTDIR
fi
