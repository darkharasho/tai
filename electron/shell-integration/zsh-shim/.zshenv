# TAI zsh shim — loaded because TAI set ZDOTDIR to this dir. Source the user's
# real .zshenv, then re-assert the shim dir so the remaining startup files
# (.zprofile/.zshrc) are still read from here.
[ -f "$TAI_ZDOTDIR_USER/.zshenv" ] && source "$TAI_ZDOTDIR_USER/.zshenv"
[ -n "$TAI_ZSH_SHIM" ] && export ZDOTDIR="$TAI_ZSH_SHIM"
