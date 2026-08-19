#!/usr/bin/env bash
# Capture a fixture inside a UTS/mount/PID namespace.
#
# TAI spawns a login shell, so /etc/profile and /etc/profile.d run on every
# capture. On this class of system they stamp the real user, hostname,
# machine-id and boot-id into the prompt via OSC 3008, print a distro MOTD, and
# — through htop's process table — the operator's home directory. Fixtures are
# committed unredacted and base64 payloads cannot be hand-edited without
# desyncing chunk boundaries from content, so every one of those values has to
# be false at capture time rather than removed afterwards.
#
# Nothing here touches the host: all masking is bind mounts inside a namespace
# that dies with the capture.
set -euo pipefail

printf '0f0f0f0f0f0f4f0f8f0f0f0f0f0f0f0f\n' > /tmp/fake-machine-id
printf 'devbox\n' > /tmp/fake-hostname
printf '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b\n' > /tmp/fake-boot-id
: > /tmp/empty-profile-script

exec unshare --uts --mount --pid --fork --mount-proc -r bash -s -- "$@" <<'INNER'
set -uo pipefail

hostname devbox
export HOSTNAME=devbox USER=devuser LOGNAME=devuser

mask() { [ -e "$2" ] && mount --bind "$1" "$2" || true; }

mask /tmp/fake-machine-id /etc/machine-id
mask /tmp/fake-hostname   /etc/hostname
mount --bind /tmp/fake-boot-id /proc/sys/kernel/random/boot_id 2>/dev/null || true

# /etc/profile prefers `hostnamectl --transient`, which asks the host's systemd
# over D-Bus and so reports the real hostname despite the UTS namespace. Failing
# it makes /etc/profile fall through to `hostname`, which is namespaced.
mask /bin/false /usr/bin/hostnamectl
# TAI runs the shell under `systemd-run --user --scope` when available, which
# hands it to the host systemd and escapes this namespace entirely.
mask /bin/false /usr/bin/systemd-run

# Distro MOTD: pure noise at the head of every recording.
for f in user-motd.sh verify_motd.sh 70-systemd-shell-extra.sh bazzite-neofetch.sh; do
  mask /tmp/empty-profile-script "/etc/profile.d/$f"
done

exec node scripts/capture-fixture.mjs "$@"
INNER
