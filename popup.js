const dom = {
  domainLabel: document.getElementById('domainLabel'),
  cookieCount: document.getElementById('cookieCount'),
  secureCount: document.getElementById('secureCount'),
  sessionCount: document.getElementById('sessionCount'),
  status: document.getElementById('status'),
  cookieList: document.getElementById('cookieList'),
  refreshBtn: document.getElementById('refreshBtn'),
  deleteAllBtn: document.getElementById('deleteAllBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  importJsonBtn: document.getElementById('importJsonBtn'),
  jsonTextarea: document.getElementById('jsonTextarea'),
  searchInput: document.getElementById('searchInput'),
  addCookieForm: document.getElementById('addCookieForm'),
  newName: document.getElementById('newName'),
  newValue: document.getElementById('newValue'),
  newPath: document.getElementById('newPath'),
  newSecure: document.getElementById('newSecure'),
  newHttpOnly: document.getElementById('newHttpOnly'),
  newSameSite: document.getElementById('newSameSite'),
  newExpiration: document.getElementById('newExpiration'),
  cookieItemTemplate: document.getElementById('cookieItemTemplate')
};

let currentUrl = '';
let currentDomain = '';
let currentStoreId = '';
let currentPartitionKey = null;
let allCookies = [];

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle('error', isError);
}

function normalizePath(path) {
  const value = String(path || '').trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function getCookieUrl({ protocol, domain, path }) {
  return `${protocol}//${domain}${normalizePath(path)}`;
}

function getCookieRemovalUrl(cookie) {
  const protocol = cookie.secure ? 'https:' : new URL(currentUrl).protocol;
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return getCookieUrl({ protocol, domain, path: cookie.path });
}

function cookiePartitionKey(cookie) {
  return cookie.partitionKey || null;
}

function cookieIdentity(cookie) {
  return [
    cookie.storeId || '',
    cookie.domain || '',
    cookie.path || '/',
    cookie.name || '',
    JSON.stringify(cookiePartitionKey(cookie))
  ].join('|');
}

function getCookieSearchText(cookie) {
  return `${cookie.name} ${cookie.value} ${cookie.path} ${cookie.domain} ${cookie.sameSite}`.toLowerCase();
}

function isCookieForActiveHost(cookie, activeHost) {
  const host = activeHost.toLowerCase();
  const cookieDomain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  if (!cookieDomain) return false;
  if (cookie.hostOnly) return cookieDomain === host;
  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function getFilteredCookies() {
  const query = dom.searchInput.value.trim().toLowerCase();
  return query ? allCookies.filter((cookie) => getCookieSearchText(cookie).includes(query)) : allCookies;
}

function validateCookieAttributes({ name, secure, sameSite, path, hostOnly = true, domain, partitionKey }) {
  const normalizedName = String(name || '').trim();
  const normalizedPath = normalizePath(path);
  const sameSiteValue = sameSite || 'unspecified';

  if (!normalizedName) throw new Error('Cookie name cannot be empty.');
  if (normalizedName.startsWith('__Secure-') && !secure) {
    throw new Error('__Secure- cookies must have Secure enabled.');
  }
  if (normalizedName.startsWith('__Host-')) {
    if (!secure || normalizedPath !== '/' || !hostOnly || domain) {
      throw new Error('__Host- cookies require Secure, Path=/, and no Domain attribute.');
    }
  }
  if (sameSiteValue === 'no_restriction' && !secure) {
    throw new Error('SameSite=None cookies must have Secure enabled.');
  }
  if (partitionKey && !secure) {
    throw new Error('Partitioned cookies must have Secure enabled.');
  }
}

function buildPartitionDetails(partitionKey) {
  return partitionKey ? { partitionKey } : {};
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) throw new Error('No active tab with a URL was found.');
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('This extension only supports http/https pages.');
  }
  let partitionKey = null;
  if (chrome.cookies.getPartitionKey && tab.id != null) {
    try {
      partitionKey = (await chrome.cookies.getPartitionKey({ tabId: tab.id })).partitionKey || null;
    } catch (_error) {
      partitionKey = null;
    }
  }
  return {
    url: tab.url,
    domain: url.hostname,
    cookieStoreId: tab.cookieStoreId || undefined,
    partitionKey
  };
}

function toExportableCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId,
    partitionKey: cookie.partitionKey || undefined
  };
}

function getImportCookieList(parsedJson) {
  if (Array.isArray(parsedJson)) return parsedJson;
  if (parsedJson && typeof parsedJson === 'object' && Array.isArray(parsedJson.cookies)) return parsedJson.cookies;
  throw new Error('JSON must be an array of cookies or an object containing a "cookies" array.');
}

function isImportDomainAllowed(sourceDomain) {
  const source = String(sourceDomain || '').replace(/^\./, '').toLowerCase();
  const active = currentDomain.toLowerCase();
  return source === active || active.endsWith(`.${source}`);
}

function formatCookieMeta(cookie) {
  const expiration = cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session';
  const partitioned = cookie.partitionKey ? ' • Partitioned' : '';
  return `${cookie.domain} • ${cookie.path} • ${cookie.sameSite || 'unspecified'} • ${cookie.secure ? 'Secure' : 'Not secure'} • ${cookie.httpOnly ? 'HttpOnly' : 'JS-accessible'} • ${expiration}${partitioned}`;
}

function updateStats() {
  dom.cookieCount.textContent = String(allCookies.length);
  dom.secureCount.textContent = String(allCookies.filter((cookie) => cookie.secure).length);
  dom.sessionCount.textContent = String(allCookies.filter((cookie) => cookie.session).length);
}

function renderCookies(cookies) {
  dom.cookieList.textContent = '';
  updateStats();
  if (cookies.length === 0) {
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = allCookies.length === 0 ? 'No cookies found for this site.' : 'No cookies match your search.';
    dom.cookieList.appendChild(item);
    return;
  }

  for (const cookie of cookies) {
    const fragment = dom.cookieItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector('.cookie-item');
    const nameInput = fragment.querySelector('.cookie-name');
    const valueInput = fragment.querySelector('.cookie-value');
    const pathInput = fragment.querySelector('.cookie-path');
    const secureInput = fragment.querySelector('.cookie-secure');
    const httpOnlyInput = fragment.querySelector('.cookie-http-only');
    const sameSiteInput = fragment.querySelector('.cookie-same-site');
    const expirationInput = fragment.querySelector('.cookie-expiration');
    const meta = fragment.querySelector('.cookie-meta');
    const saveBtn = fragment.querySelector('.save-btn');
    const deleteBtn = fragment.querySelector('.delete-btn');

    nameInput.value = cookie.name;
    valueInput.value = cookie.value;
    pathInput.value = cookie.path;
    secureInput.checked = cookie.secure;
    httpOnlyInput.checked = cookie.httpOnly;
    sameSiteInput.value = cookie.sameSite || 'unspecified';
    expirationInput.value = cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toISOString().slice(0, 16) : '';
    meta.textContent = formatCookieMeta(cookie);
    item.dataset.cookieKey = cookieIdentity(cookie);

    saveBtn.addEventListener('click', async () => {
      const expirationDate = expirationInput.value ? Math.floor(new Date(expirationInput.value).getTime() / 1000) : undefined;
      await upsertCookie({
        original: cookie,
        name: nameInput.value,
        value: valueInput.value,
        path: pathInput.value,
        secure: secureInput.checked,
        httpOnly: httpOnlyInput.checked,
        sameSite: sameSiteInput.value,
        expirationDate
      });
    });
    deleteBtn.addEventListener('click', () => deleteCookie(cookie));
    dom.cookieList.appendChild(fragment);
  }
}

async function getCookiesForCurrentTab(query) {
  const base = { ...query };
  const unpartitioned = await chrome.cookies.getAll(base);
  const results = [...unpartitioned];
  if (currentPartitionKey && chrome.cookies.getAll) {
    try {
      results.push(...await chrome.cookies.getAll({ ...base, partitionKey: currentPartitionKey }));
    } catch (_error) {
      // Older browsers may expose getAll without partitionKey support.
    }
  }
  const unique = new Map();
  for (const cookie of results) unique.set(cookieIdentity(cookie), cookie);
  return [...unique.values()];
}

async function loadCookies() {
  try {
    setStatus('Loading cookies...');
    const tab = await getCurrentTab();
    currentUrl = tab.url;
    currentDomain = tab.domain;
    currentStoreId = tab.cookieStoreId || '';
    currentPartitionKey = tab.partitionKey;
    dom.domainLabel.textContent = currentPartitionKey ? `${currentDomain} • partition-aware` : currentDomain;

    const query = currentStoreId ? { storeId: currentStoreId } : {};
    const cookies = await getCookiesForCurrentTab(query);
    allCookies = cookies.filter((cookie) => isCookieForActiveHost(cookie, currentDomain));
    allCookies.sort((a, b) => `${a.name}|${a.path}`.localeCompare(`${b.name}|${b.path}`));
    renderCookies(getFilteredCookies());
    setStatus(`Loaded ${allCookies.length} cookie(s).`);
  } catch (error) {
    allCookies = [];
    renderCookies([]);
    setStatus(error.message || 'Unable to load cookies.', true);
  }
}

async function upsertCookie({ original, name, value, path, secure, httpOnly, sameSite, expirationDate }) {
  try {
    const trimmedName = String(name || '').trim();
    const normalizedPath = normalizePath(path);
    const effectiveSecure = original ? Boolean(secure) : Boolean(secure);
    const effectiveHttpOnly = original ? Boolean(httpOnly) : Boolean(httpOnly);
    const effectiveSameSite = sameSite || 'unspecified';
    const effectivePartitionKey = original?.partitionKey || currentPartitionKey || null;
    const hostOnly = original ? Boolean(original.hostOnly) : true;
    const domain = original && !original.hostOnly ? original.domain : undefined;

    validateCookieAttributes({
      name: trimmedName,
      secure: effectiveSecure,
      sameSite: effectiveSameSite,
      path: normalizedPath,
      hostOnly,
      domain,
      partitionKey: effectivePartitionKey
    });

    const protocol = effectiveSecure ? 'https:' : new URL(currentUrl).protocol;
    const domainForUrl = original?.domain ? original.domain.replace(/^\./, '') : currentDomain;
    const cookieUrl = getCookieUrl({ protocol, domain: domainForUrl, path: normalizedPath });
    const setDetails = {
      url: cookieUrl,
      name: trimmedName,
      value: String(value ?? ''),
      path: normalizedPath,
      secure: effectiveSecure,
      httpOnly: effectiveHttpOnly,
      sameSite: effectiveSameSite,
      storeId: original?.storeId || currentStoreId || undefined,
      ...buildPartitionDetails(effectivePartitionKey)
    };
    if (domain) setDetails.domain = domain;
    if (expirationDate != null && Number.isFinite(expirationDate)) setDetails.expirationDate = expirationDate;

    // Set first. If the replacement is rejected, the original cookie remains intact.
    const savedCookie = await chrome.cookies.set(setDetails);
    if (!savedCookie) throw new Error('Browser rejected the cookie update.');

    if (original && cookieIdentity(original) !== cookieIdentity(savedCookie)) {
      await chrome.cookies.remove({
        url: getCookieRemovalUrl(original),
        name: original.name,
        storeId: original.storeId,
        ...buildPartitionDetails(original.partitionKey)
      });
    }

    setStatus(`Saved cookie "${trimmedName}".`);
    await loadCookies();
    return true;
  } catch (error) {
    setStatus(error.message || 'Unable to save cookie.', true);
    return false;
  }
}

async function deleteCookie(cookie) {
  try {
    const removed = await chrome.cookies.remove({
      url: getCookieRemovalUrl(cookie),
      name: cookie.name,
      storeId: cookie.storeId,
      ...buildPartitionDetails(cookie.partitionKey)
    });
    if (!removed) throw new Error('Cookie was not found or could not be removed.');
    setStatus(`Deleted cookie "${cookie.name}".`);
    await loadCookies();
  } catch (error) {
    setStatus(error.message || 'Unable to delete cookie.', true);
  }
}

async function deleteAllCookies() {
  const visibleCookies = getFilteredCookies();
  if (visibleCookies.length === 0) {
    setStatus('There are no visible cookies to delete.', true);
    return;
  }
  if (!window.confirm(`Delete all ${visibleCookies.length} visible cookies for ${currentDomain}? This cannot be undone.`)) return;

  let deletedCount = 0;
  for (const cookie of visibleCookies) {
    try {
      const removed = await chrome.cookies.remove({
        url: getCookieRemovalUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId,
        ...buildPartitionDetails(cookie.partitionKey)
      });
      if (removed) deletedCount += 1;
    } catch (_error) {
      // Continue so one restricted cookie does not block the rest.
    }
  }
  setStatus(`Deleted ${deletedCount} of ${visibleCookies.length} cookie(s).`);
  await loadCookies();
}

function exportCookiesAsJsonText() {
  if (allCookies.length === 0) {
    setStatus('No cookies available to export for this site.', true);
    return;
  }
  dom.jsonTextarea.value = JSON.stringify({
    domain: currentDomain,
    exportedAt: new Date().toISOString(),
    cookies: allCookies.map(toExportableCookie)
  }, null, 2);
  dom.jsonTextarea.focus();
  dom.jsonTextarea.select();
  setStatus(`Exported ${allCookies.length} cookie(s).`);
}

async function importCookiesFromJsonText() {
  try {
    const rawText = dom.jsonTextarea.value.trim();
    if (!rawText) throw new Error('Paste JSON text before importing.');
    const cookiesToImport = getImportCookieList(JSON.parse(rawText));
    if (cookiesToImport.length === 0) throw new Error('JSON contains no cookies to import.');

    let importedCount = 0;
    let skippedCount = 0;
    for (const cookie of cookiesToImport) {
      if (!cookie || typeof cookie !== 'object' || typeof cookie.name !== 'string' || !cookie.name.trim()) {
        skippedCount += 1;
        continue;
      }
      const sourceDomain = typeof cookie.domain === 'string' && cookie.domain.trim() ? cookie.domain.trim() : currentDomain;
      if (!isImportDomainAllowed(sourceDomain)) {
        skippedCount += 1;
        continue;
      }

      const hostOnly = cookie.hostOnly !== false;
      const partitionKey = cookie.partitionKey || currentPartitionKey || null;
      if (partitionKey && currentPartitionKey && JSON.stringify(partitionKey) !== JSON.stringify(currentPartitionKey)) {
        skippedCount += 1;
        continue;
      }

      const saved = await upsertCookie({
        original: {
          name: cookie.name.trim(),
          path: normalizePath(cookie.path),
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite || 'unspecified',
          expirationDate: cookie.expirationDate,
          hostOnly,
          domain: hostOnly ? currentDomain : sourceDomain,
          storeId: currentStoreId || undefined,
          partitionKey
        },
        name: cookie.name,
        value: cookie.value == null ? '' : String(cookie.value),
        path: cookie.path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'unspecified',
        expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : undefined
      });
      if (saved) importedCount += 1;
      else skippedCount += 1;
    }

    await loadCookies();
    if (!importedCount) throw new Error('No valid cookies were imported. Only cookies scoped to the active site are accepted.');
    setStatus(`Imported ${importedCount} cookie(s)${skippedCount ? `; skipped ${skippedCount}.` : '.'}`);
  } catch (error) {
    setStatus(error.message || 'Unable to import cookies.', true);
  }
}

dom.refreshBtn.addEventListener('click', loadCookies);
dom.deleteAllBtn.addEventListener('click', deleteAllCookies);
dom.exportJsonBtn.addEventListener('click', exportCookiesAsJsonText);
dom.importJsonBtn.addEventListener('click', importCookiesFromJsonText);
dom.searchInput.addEventListener('input', () => renderCookies(getFilteredCookies()));

dom.addCookieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saved = await upsertCookie({
    name: dom.newName.value,
    value: dom.newValue.value,
    path: dom.newPath.value,
    secure: dom.newSecure.checked,
    httpOnly: dom.newHttpOnly.checked,
    sameSite: dom.newSameSite.value,
    expirationDate: dom.newExpiration.value ? Math.floor(new Date(dom.newExpiration.value).getTime() / 1000) : undefined
  });
  if (saved) {
    dom.addCookieForm.reset();
    dom.newPath.value = '/';
    dom.newSameSite.value = 'unspecified';
  }
});

loadCookies();
