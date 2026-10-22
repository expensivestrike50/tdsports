#!/bin/bash
# Run TDsports as macOS background services (launchd): they start at login and restart
# automatically if they stop.
#
#   tools/services.sh install    install and start all three services
#   tools/services.sh status     show whether each service is running
#   tools/services.sh restart    restart all three
#   tools/services.sh logs       tail the logs
#   tools/services.sh uninstall  stop and remove the services
#
# Services:
#   com.popouts.app          the app + JSON API http://localhost:8000 (API at /api/v1)
#   com.popouts.workstation  agent workstation  http://localhost:8781
#   com.popouts.tom          Agent Tom (live scores every 30s, health checks, audits)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/popouts"
DOMAIN="gui/$(id -u)"
LABELS=(com.popouts.app com.popouts.workstation com.popouts.tom)

plist() { # label, then program arguments
  local label="$1"; shift
  local args=""
  for a in "$@"; do args+="    <string>$a</string>"$'\n'; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
</dict>
</plist>
EOF
}

case "${1:-status}" in
  install)
    mkdir -p "$AGENTS" "$LOGS"
    plist com.popouts.app "$PY" -u "$ROOT/tools/serve.py" 8000
    plist com.popouts.workstation "$PY" -m http.server 8781 --bind 127.0.0.1 --directory "$ROOT/workstation"
    plist com.popouts.tom "$PY" -u "$ROOT/tools/agent-tom.py"
    for l in "${LABELS[@]}"; do
      launchctl bootout "$DOMAIN/$l" 2>/dev/null || true
      launchctl bootstrap "$DOMAIN" "$AGENTS/$l.plist"
    done
    echo "Installed. App: http://localhost:8000 · Workstation: http://localhost:8781 · Logs: $LOGS"
    ;;
  uninstall)
    for l in "${LABELS[@]}"; do
      launchctl bootout "$DOMAIN/$l" 2>/dev/null || true
      rm -f "$AGENTS/$l.plist"
    done
    echo "Removed."
    ;;
  restart)
    for l in "${LABELS[@]}"; do launchctl kickstart -k "$DOMAIN/$l"; done
    echo "Restarted."
    ;;
  status)
    for l in "${LABELS[@]}"; do
      if info="$(launchctl print "$DOMAIN/$l" 2>/dev/null)"; then
        state="$(echo "$info" | awk -F'= ' '/^\tstate =/ {print $2; exit}')"
        pid="$(echo "$info" | awk -F'= ' '/^\tpid =/ {print $2; exit}')"
        echo "$l: ${state:-unknown}${pid:+ (pid $pid)}"
      else
        echo "$l: not installed"
      fi
    done
    ;;
  logs)
    tail -n 30 -f "$LOGS"/*.log
    ;;
  *)
    echo "Usage: $0 install|status|restart|logs|uninstall" >&2
    exit 1
    ;;
esac
