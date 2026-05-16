# tai shell integration for fish — emits OSC 133 semantic prompts.

status is-interactive; or exit 0
test "$TERM" = dumb; and exit 0

function __tai_osc133
    printf '\e]133;%s\a' $argv[1]
end

function __tai_prompt_start --on-event fish_prompt
    if set -q __TAI_CMD_ACTIVE
        __tai_osc133 "D;$__TAI_LAST_STATUS"
        set -e __TAI_CMD_ACTIVE
    end
    __tai_osc133 A
end

function __tai_preexec --on-event fish_preexec
    __tai_osc133 C
    set -g __TAI_CMD_ACTIVE 1
end

function __tai_postexec --on-event fish_postexec
    set -g __TAI_LAST_STATUS $status
end

# Wrap fish_prompt to emit B at the end of prompt rendering.
if not functions -q __tai_orig_fish_prompt
    functions -c fish_prompt __tai_orig_fish_prompt
    function fish_prompt
        __tai_orig_fish_prompt
        __tai_osc133 B
    end
end

set -gx TAI_SHELL_INTEGRATION 1
