# TAI zsh shim — login shells. Source the user's real .zprofile, then re-assert
# the shim dir for .zshrc.
[ -f "$TAI_ZDOTDIR_USER/.zprofile" ] && source "$TAI_ZDOTDIR_USER/.zprofile"
[ -n "$TAI_ZSH_SHIM" ] && export ZDOTDIR="$TAI_ZSH_SHIM"
