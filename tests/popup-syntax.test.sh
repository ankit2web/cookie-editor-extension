#!/usr/bin/env bash
set -euo pipefail

node --check popup.js
python -m json.tool manifest.json >/dev/null
python - <<'PY'
from pathlib import Path
html = Path('popup-v2.html').read_text()
js = Path('popup.js').read_text()
required = ['popup-v2.css', 'popup.js', 'addCookieForm', 'cookieItemTemplate']
missing = [item for item in required if item not in html]
if missing:
    raise SystemExit(f'Missing popup dependencies: {missing}')

# Regression guards for bugs found in review. These are source-level guards;
# browser integration tests are still needed for real Chrome cookie behavior.
cookie_regressions = {
    'new/unpartitioned cookies must not inherit the active tab partition':
        'const effectivePartitionKey = original?.partitionKey || requestedPartitionKey || null;' in js
        and 'cookie.partitionKey || currentPartitionKey || null' not in js
        and 'requestedPartitionKey: currentPartitionKey' not in js,
    'unchanged expiration input must preserve the exact original timestamp':
        'const expirationWasEdited = expirationInput.value !== originalExpirationInputValue;' in js
        and ': cookie.expirationDate;' in js,
    'datetime-local values must be formatted in local time':
        all(part in js for part in ['date.getFullYear()', 'date.getMonth()', 'date.getDate()', 'date.getHours()', 'date.getMinutes()']),
    'cookie imports must not pass synthetic originals for cleanup':
        'original: {' not in js[js.index('async function importCookiesFromJsonText'):js.index('dom.refreshBtn')],
}
failed = [name for name, passed in cookie_regressions.items() if not passed]
if failed:
    raise SystemExit('Cookie regression guards failed: ' + '; '.join(failed))
print('popup structure: PASS')
print('cookie regression guards: PASS')
PY

echo 'popup syntax: PASS'
echo 'manifest JSON: PASS'
