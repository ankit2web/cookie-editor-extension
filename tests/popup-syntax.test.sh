#!/usr/bin/env bash
set -euo pipefail

node --check popup.js
python -m json.tool manifest.json >/dev/null
python - <<'PY'
from pathlib import Path
html = Path('popup-v2.html').read_text()
required = ['popup-v2.css', 'popup.js', 'addCookieForm', 'cookieItemTemplate']
missing = [item for item in required if item not in html]
if missing:
    raise SystemExit(f'Missing popup dependencies: {missing}')
print('popup structure: PASS')
PY

echo 'popup syntax: PASS'
echo 'manifest JSON: PASS'
