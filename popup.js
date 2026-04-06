const dom = {
  domainLabel: document.getElementById('domainLabel'),
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
  cookieItemTemplate: document.getElementById('cookieItemTemplate')
};

let currentUrl = '';
let currentDomain = '';
let currentStoreId = '';
let allCookies = [];

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.style.color = isError ? '#c62828' : '#666';
}

function normalizePath(path) {
  if (!path || !path.trim()) {
    return '/';
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function getCookieUrl({ protocol, domain, path }) {
  return `${protocol}//${domain}${normalizePath(path)}`;
}

function getCookieRemovalUrl(cookie) {
  const protocol = cookie.secure ? 'https:' : new URL(currentUrl).protocol;
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  return getCookieUrl({ protocol, domain, path: cookie.path });
}

function getCookieSearchText(cookie) {
  return `${cookie.name} ${cookie.value} ${cookie.path} ${cookie.domain}`.toLowerCase();
}

function isCookieForActiveHost(cookie, activeHost) {
  const host = activeHost.toLowerCase();
  const cookieDomain = cookie.domain.replace(/^\./, '').toLowerCase();

  if (cookie.hostOnly) {
    return cookieDomain === host;
  }

  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function getFilteredCookies() {
  const query = dom.searchInput.value.trim().toLowerCase();
  if (!query) {
    return allCookies;
  }

  return allCookies.filter((cookie) => getCookieSearchText(cookie).includes(query));
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
    expirationDate: cookie.expirationDate
  };
}

function getImportCookieList(parsedJson) {
  if (Array.isArray(parsedJson)) {
    return parsedJson;
  }

  if (parsedJson && typeof parsedJson === 'object' && Array.isArray(parsedJson.cookies)) {
    return parsedJson.cookies;
  }

  throw new Error('JSON must be an array of cookies or an object containing a "cookies" array.');
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    throw new Error('No active tab with a URL was found.');
  }

  const url = new URL(tab.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('This extension only supports http/https pages.');
  }

  return { url: tab.url, domain: url.hostname, cookieStoreId: tab.cookieStoreId || undefined };
}

function formatCookieMeta(cookie) {
  const expiration = cookie.expirationDate
    ? new Date(cookie.expirationDate * 1000).toLocaleString()
    : 'Session';
  return [
    `Domain: ${cookie.domain}`,
    `Secure: ${cookie.secure}`,
    `HttpOnly: ${cookie.httpOnly}`,
    `SameSite: ${cookie.sameSite || 'unspecified'}`,
    `Expires: ${expiration}`
  ].join(' • ');
}

function renderCookies(cookies) {
  dom.cookieList.textContent = '';

  if (cookies.length === 0) {
    const item = document.createElement('li');
    item.textContent = allCookies.length === 0
      ? 'No cookies found for this domain.'
      : 'No cookies match your search.';
    dom.cookieList.appendChild(item);
    return;
  }

  for (const cookie of cookies) {
    const fragment = dom.cookieItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector('.cookie-item');
    const nameInput = fragment.querySelector('.cookie-name');
    const valueInput = fragment.querySelector('.cookie-value');
    const pathInput = fragment.querySelector('.cookie-path');
    const meta = fragment.querySelector('.cookie-meta');
    const saveBtn = fragment.querySelector('.save-btn');
    const deleteBtn = fragment.querySelector('.delete-btn');

    nameInput.value = cookie.name;
    valueInput.value = cookie.value;
    pathInput.value = cookie.path;
    meta.textContent = formatCookieMeta(cookie);

    saveBtn.addEventListener('click', async () => {
      await upsertCookie({
        original: cookie,
        name: nameInput.value,
        value: valueInput.value,
        path: pathInput.value
      });
    });

    deleteBtn.addEventListener('click', async () => {
      await deleteCookie(cookie);
    });

    item.dataset.cookieKey = `${cookie.storeId}|${cookie.domain}|${cookie.name}|${cookie.path}`;
    dom.cookieList.appendChild(fragment);
  }
}

async function loadCookies() {
  try {
    setStatus('Loading cookies...');
    const tab = await getCurrentTab();
    
    currentUrl = tab.url;
    currentDomain = tab.domain;
    currentStoreId = tab.cookieStoreId || '';
    dom.domainLabel.textContent = `Domain: ${currentDomain}`;

    // THE FIX: Only fetch cookies for this specific domain
    const query = {
      domain: currentDomain // The API now only returns what you need
    };
    
    if (currentStoreId) {
      query.storeId = currentStoreId;
    }

    const hostScopedCookies = await chrome.cookies.getAll(query);
    
    // Sorting logic remains the same
    hostScopedCookies.sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      return byName === 0 ? a.path.localeCompare(b.path) : byName;
    });

    allCookies = hostScopedCookies;
    renderCookies(getFilteredCookies());
    setStatus(`Loaded ${hostScopedCookies.length} cookie(s).`);
  } catch (error) {
    // Error handling...
  }
}

async function upsertCookie({ original, name, value, path }) {
  try {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Cookie name cannot be empty.');
    }

    const normalizedPath = normalizePath(path);
    const protocol = original?.secure ? 'https:' : new URL(currentUrl).protocol;
    let domainForUrl = currentDomain;

    if (original?.domain) {
      if (original.domain.startsWith('.')) {
        const scopedDomain = original.domain.slice(1);
        domainForUrl = currentDomain === scopedDomain || currentDomain.endsWith(`.${scopedDomain}`)
          ? currentDomain
          : scopedDomain;
      } else {
        domainForUrl = original.domain;
      }
    }

    const cookieUrl = getCookieUrl({ protocol, domain: domainForUrl, path: normalizedPath });

    if (original && (original.name !== trimmedName || original.path !== normalizedPath)) {
      await chrome.cookies.remove({
        url: getCookieRemovalUrl(original),
        name: original.name,
        storeId: original.storeId
      });
    }

    const setDetails = {
      url: cookieUrl,
      name: trimmedName,
      value,
      path: normalizedPath,
      storeId: original?.storeId || currentStoreId || undefined
    };

    if (original) {
      if (!original.hostOnly) {
        setDetails.domain = original.domain;
      }
      setDetails.httpOnly = original.httpOnly;
      setDetails.secure = original.secure;
      setDetails.sameSite = original.sameSite;
      setDetails.expirationDate = original.expirationDate;
    }

    await chrome.cookies.set(setDetails);

    setStatus(`Saved cookie "${trimmedName}".`);
    await loadCookies();
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  }
}

async function deleteCookie(cookie) {
  try {
    await chrome.cookies.remove({
      url: getCookieRemovalUrl(cookie),
      name: cookie.name,
      storeId: cookie.storeId
    });

    setStatus(`Deleted cookie "${cookie.name}".`);
    await loadCookies();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteAllCookies() {
  const visibleCookies = getFilteredCookies();

  if (visibleCookies.length === 0) {
    setStatus('There are no visible cookies to delete.', true);
    return;
  }

  const shouldDelete = window.confirm(
    `Delete all ${visibleCookies.length} cookies shown for ${currentDomain}? This cannot be undone.`
  );

  if (!shouldDelete) {
    return;
  }

  setStatus(`Deleting ${visibleCookies.length} cookie(s)...`);

  let deletedCount = 0;
  for (const cookie of visibleCookies) {
    try {
      const deleted = await chrome.cookies.remove({
        url: getCookieRemovalUrl(cookie),
        name: cookie.name,
        storeId: cookie.storeId
      });
      if (deleted) {
        deletedCount += 1;
      }
    } catch (_error) {
      // Continue deleting remaining cookies even if one fails.
    }
  }

  setStatus(`Deleted ${deletedCount} cookie(s).`);
  await loadCookies();
}

async function exportCookiesAsJsonText() {
  if (allCookies.length === 0) {
    setStatus('No cookies available to export for this domain.', true);
    return;
  }

  const exportPayload = {
    domain: currentDomain,
    exportedAt: new Date().toISOString(),
    cookies: allCookies.map(toExportableCookie)
  };

  dom.jsonTextarea.value = JSON.stringify(exportPayload, null, 2);
  dom.jsonTextarea.focus();
  dom.jsonTextarea.select();
  setStatus(`Exported ${allCookies.length} cookie(s) to JSON text.`);
}

async function importCookiesFromJsonText() {
  try {
    const rawText = dom.jsonTextarea.value.trim();
    if (!rawText) {
      throw new Error('Paste JSON text before importing.');
    }

    const parsedJson = JSON.parse(rawText);
    const cookiesToImport = getImportCookieList(parsedJson);
    if (cookiesToImport.length === 0) {
      throw new Error('JSON contains no cookies to import.');
    }

    setStatus(`Importing ${cookiesToImport.length} cookie(s)...`);

    let importedCount = 0;
    for (const cookie of cookiesToImport) {
      if (!cookie || typeof cookie !== 'object') {
        continue;
      }

      const name = typeof cookie.name === 'string' ? cookie.name.trim() : '';
      if (!name) {
        continue;
      }

      const value = cookie.value == null ? '' : String(cookie.value);
      const path = normalizePath(typeof cookie.path === 'string' ? cookie.path : '/');
      const sourceDomain = typeof cookie.domain === 'string' && cookie.domain.trim()
        ? cookie.domain.trim()
        : currentDomain;
      const originalForUpsert = {
        name,
        path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: typeof cookie.sameSite === 'string' ? cookie.sameSite : undefined,
        expirationDate: typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)
          ? cookie.expirationDate
          : undefined,
        hostOnly: Boolean(cookie.hostOnly),
        domain: sourceDomain,
        storeId: currentStoreId || undefined
      };

      const saved = await upsertCookie({
        original: originalForUpsert,
        name,
        value,
        path
      });

      if (saved) {
        importedCount += 1;
      }
    }

    if (importedCount === 0) {
      throw new Error('No valid cookies were found in the provided JSON.');
    }

    setStatus(`Imported ${importedCount} cookie(s).`);
    await loadCookies();
  } catch (error) {
    setStatus(error.message, true);
  }
}

dom.refreshBtn.addEventListener('click', loadCookies);
dom.deleteAllBtn.addEventListener('click', deleteAllCookies);
dom.exportJsonBtn.addEventListener('click', exportCookiesAsJsonText);
dom.importJsonBtn.addEventListener('click', importCookiesFromJsonText);
dom.searchInput.addEventListener('input', () => {
  renderCookies(getFilteredCookies());
});

dom.addCookieForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saved = await upsertCookie({
    name: dom.newName.value,
    value: dom.newValue.value,
    path: dom.newPath.value
  });

  if (saved) {
    dom.addCookieForm.reset();
    dom.newPath.value = '/';
  }
});

loadCookies();
