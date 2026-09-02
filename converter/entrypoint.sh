#!/bin/sh
set -eu

PROFILE=/tmp/panelstock-libreoffice-profile
mkdir -p "$PROFILE"
libreoffice --headless --nologo --nodefault --nofirststartwizard --norestore \
  "-env:UserInstallation=file://$PROFILE" \
  '--accept=socket,host=127.0.0.1,port=2002;urp;StarOffice.ServiceManager' \
  >/tmp/libreoffice.log 2>&1 &
office_pid=$!
trap 'kill "$office_pid" 2>/dev/null || true' EXIT INT TERM

python3 - <<'PY'
import socket
import time

for _ in range(60):
    try:
        with socket.create_connection(("127.0.0.1", 2002), timeout=1):
            break
    except OSError:
        time.sleep(0.5)
else:
    raise SystemExit("LibreOffice did not become ready")
PY

exec python3 /app/server.py
