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
import re
upsert = js[js.index('async function upsertCookie'):js.index('async function deleteCookie')]
tab_lookup = js[js.index('async function getCurrentTab'):js.index('function toExportableCookie')]
expiration_input_assignment = re.search(r'expirationInput\\.value\\s*=\\s*[^;\\n]*toISOString', js)
partition_assignment = re.search(r'const effectivePartitionKey\\s*=\\s*([^;]+);', upsert)
cookie_regressions = {
    'new cookies must not inherit the active tab partition':
        partition_assignment is not None
        and 'currentPartitionKey' not in partition_assignment.group(1)
        and 'original' in partition_assignment.group(1)
        and 'requestedPartitionKey' in partition_assignment.group(1),
    'unchanged expiration input must preserve the exact original timestamp':
        'const expirationWasEdited = expirationInput.value !== originalExpirationInputValue;' in js
        and ': cookie.expirationDate;' in js,
    'datetime-local values must be formatted in local time':
        'function formatLocalDateTime(timestampSeconds)' in js
        and 'const originalExpirationInputValue = cookie.expirationDate ? formatLocalDateTime(cookie.expirationDate) : \'\';' in js
        and expiration_input_assignment is None,
    'cookie imports must not pass synthetic originals for cleanup':
        'original: {' not in js[js.index('async function importCookiesFromJsonText'):js.index('dom.refreshBtn')],
    'active tab cookie store must be resolved from store tab IDs':
        'chrome.cookies.getAllCookieStores()' in tab_lookup
        and 'stores.find((candidate) => candidate.tabIds.includes(tab.id))' in tab_lookup
        and 'storeId: store.id' in tab_lookup
        and 'tab.cookieStoreId' not in tab_lookup,
    'cookie reads and imports must use the resolved store explicitly':
        'const base = { ...query, storeId: currentStoreId };' in js
        and 'storeId: currentStoreId' in js
        and 'storeId: requestedStore,' in js,
}
failed = [name for name, passed in cookie_regressions.items() if not passed]
if failed:
    raise SystemExit('Cookie regression guards failed: ' + '; '.join(failed))
print('popup structure: PASS')
print('cookie regression guards: PASS')
PY

echo 'popup syntax: PASS'
echo 'manifest JSON: PASS'
