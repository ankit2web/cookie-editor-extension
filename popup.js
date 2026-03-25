const dom = {
  domainLabel: document.getElementById('domainLabel'),
  status: document.getElementById('status'),
  cookieList: document.getElementById('cookieList'),
  refreshBtn: document.getElementById('refreshBtn'),
  deleteAllBtn: document.getElementById('deleteAllBtn'),
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

function getFilteredCookies() {
  const query = dom.searchInput.value.trim().toLowerCase();
  if (!query) {
    return allCookies;
  }

  return allCookies.filter((cookie) => getCookieSearchText(cookie).includes(query));
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

    const query = { domain: currentDomain };
    if (currentStoreId) {
      query.storeId = currentStoreId;
    }

    const cookies = await chrome.cookies.getAll(query);
    cookies.sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      return byName === 0 ? a.path.localeCompare(b.path) : byName;
    });
    allCookies = cookies;
    renderCookies(getFilteredCookies());
    setStatus(`Loaded ${cookies.length} cookie(s).`);
  } catch (error) {
    allCookies = [];
    renderCookies([]);
    dom.domainLabel.textContent = 'Unable to determine current domain.';
    setStatus(error.message, true);
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
  if (allCookies.length === 0) {
    setStatus('There are no cookies to delete.', true);
    return;
  }

  const shouldDelete = window.confirm(
    `Delete all ${allCookies.length} cookies shown for ${currentDomain}? This cannot be undone.`
  );

  if (!shouldDelete) {
    return;
  }

  setStatus(`Deleting ${allCookies.length} cookie(s)...`);

  let deletedCount = 0;
  for (const cookie of allCookies) {
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

dom.refreshBtn.addEventListener('click', loadCookies);
dom.deleteAllBtn.addEventListener('click', deleteAllCookies);
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
