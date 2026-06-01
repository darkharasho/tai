# tai shell integration for fish — emits OSC 133 semantic prompts plus
# OSC 6973 JSON sidechannel for structured command metadata.

status is-interactive; or exit 0
test "$TERM" = dumb; and exit 0

function __tai_osc133
    printf '\e]133;%s\a' $argv[1]
end

# OSC 6973: hex-encoded JSON sidechannel. Hex avoids needing to escape OSC
# terminators or control bytes inside the payload.
function __tai_osc6973
    set -l json $argv[1]
    set -l hex
    if type -q xxd
        set hex (printf '%s' "$json" | xxd -p -c 99999 | tr -d '\n')
    else
        set hex (printf '%s' "$json" | od -An -tx1 | tr -d ' \n')
    end
    printf '\e]6973;%s\a' "$hex"
end

# Escape a string for embedding inside a JSON string literal. Handles all C0
# control bytes (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) as \u00XX per RFC 8259, in
# addition to \, ", \n, \r, \t. Mirrors tai-bash.sh / tai-zsh.zsh.
function __tai_json_escape
    set -l s $argv[1]
    set s (string replace -a '\\' '\\\\' -- $s)
    set s (string replace -a '"' '\\"' -- $s)
    set s (string replace -ar '\n' '\\n' -- $s)
    set s (string replace -ar '\r' '\\r' -- $s)
    set s (string replace -ar '\t' '\\t' -- $s)
    set s (string replace -ar '\x01' '\\u0001' -- $s)
    set s (string replace -ar '\x02' '\\u0002' -- $s)
    set s (string replace -ar '\x03' '\\u0003' -- $s)
    set s (string replace -ar '\x04' '\\u0004' -- $s)
    set s (string replace -ar '\x05' '\\u0005' -- $s)
    set s (string replace -ar '\x06' '\\u0006' -- $s)
    set s (string replace -ar '\x07' '\\u0007' -- $s)
    set s (string replace -ar '\x08' '\\u0008' -- $s)
    set s (string replace -ar '\x0b' '\\u000b' -- $s)
    set s (string replace -ar '\x0c' '\\u000c' -- $s)
    set s (string replace -ar '\x0e' '\\u000e' -- $s)
    set s (string replace -ar '\x0f' '\\u000f' -- $s)
    set s (string replace -ar '\x10' '\\u0010' -- $s)
    set s (string replace -ar '\x11' '\\u0011' -- $s)
    set s (string replace -ar '\x12' '\\u0012' -- $s)
    set s (string replace -ar '\x13' '\\u0013' -- $s)
    set s (string replace -ar '\x14' '\\u0014' -- $s)
    set s (string replace -ar '\x15' '\\u0015' -- $s)
    set s (string replace -ar '\x16' '\\u0016' -- $s)
    set s (string replace -ar '\x17' '\\u0017' -- $s)
    set s (string replace -ar '\x18' '\\u0018' -- $s)
    set s (string replace -ar '\x19' '\\u0019' -- $s)
    set s (string replace -ar '\x1a' '\\u001a' -- $s)
    set s (string replace -ar '\x1b' '\\u001b' -- $s)
    set s (string replace -ar '\x1c' '\\u001c' -- $s)
    set s (string replace -ar '\x1d' '\\u001d' -- $s)
    set s (string replace -ar '\x1e' '\\u001e' -- $s)
    set s (string replace -ar '\x1f' '\\u001f' -- $s)
    printf '%s' $s
end

function __tai_now_ms
    # GNU date supports %3N; BSD/macOS date does not. Fall back to seconds*1000.
    set -l ms (date +%s%3N 2>/dev/null)
    if test -z "$ms"; or string match -q '*N*' -- "$ms"
        set ms (date +%s)"000"
    end
    printf '%s' $ms
end

function __tai_preexec --on-event fish_preexec
    # fish_preexec passes the command line as $argv[1].
    set -g __TAI_CMD_LINE $argv[1]
    set -g __TAI_CMD_START (__tai_now_ms)
    set -g __TAI_CMD_ACTIVE 1
    set -l cmd_esc (__tai_json_escape $argv[1])
    __tai_osc6973 "{\"hook\":\"preexec\",\"command\":\"$cmd_esc\"}"
    __tai_osc133 C
end

function __tai_postexec --on-event fish_postexec
    set -g __TAI_LAST_STATUS $status
end

function __tai_prompt_start --on-event fish_prompt
    if set -q __TAI_CMD_ACTIVE
        set -l ec $__TAI_LAST_STATUS
        if test -z "$ec"
            set ec 0
        end
        set -l end (__tai_now_ms)
        set -l duration_ms 0
        if test -n "$__TAI_CMD_START"; and test "$__TAI_CMD_START" -gt 0 2>/dev/null
            set duration_ms (math $end - $__TAI_CMD_START)
        end
        set -l cwd_esc (__tai_json_escape "$PWD")
        set -l cmd_esc (__tai_json_escape "$__TAI_CMD_LINE")
        set -l signal "null"
        if test "$ec" -gt 128 2>/dev/null; and test "$ec" -lt 165 2>/dev/null
            set signal "\"SIG"(math $ec - 128)"\""
        end
        __tai_osc6973 "{\"hook\":\"precmd\",\"exit\":$ec,\"signal\":$signal,\"duration_ms\":$duration_ms,\"command\":\"$cmd_esc\",\"cwd\":\"$cwd_esc\"}"

        __tai_osc133 "D;$ec"
        set -e __TAI_CMD_ACTIVE
        set -e __TAI_CMD_LINE
        set -e __TAI_CMD_START
    end
    __tai_osc133 A
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
