const dom = {
  domainLabel: document.getElementById('domainLabel'),
  status: document.getElementById('status'),
  cookieList: document.getElementById('cookieList'),
  refreshBtn: document.getElementById('refreshBtn'),
  addCookieForm: document.getElementById('addCookieForm'),
  newName: document.getElementById('newName'),
  newValue: document.getElementById('newValue'),
  newPath: document.getElementById('newPath'),
  cookieItemTemplate: document.getElementById('cookieItemTemplate')
};

let currentUrl = '';
let currentDomain = '';

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

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    throw new Error('No active tab with a URL was found.');
  }

  const url = new URL(tab.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('This extension only supports http/https pages.');
  }

  return { url: tab.url, domain: url.hostname };
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
    item.textContent = 'No cookies found for this domain.';
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

    item.dataset.cookieKey = `${cookie.name}|${cookie.path}`;
    dom.cookieList.appendChild(fragment);
  }
}

async function loadCookies() {
  try {
    setStatus('Loading cookies...');
    const tab = await getCurrentTab();
    currentUrl = tab.url;
    currentDomain = tab.domain;
    dom.domainLabel.textContent = `Domain: ${currentDomain}`;

    const cookies = await chrome.cookies.getAll({ url: currentUrl });
    cookies.sort((a, b) => a.name.localeCompare(b.name));
    renderCookies(cookies);
    setStatus(`Loaded ${cookies.length} cookie(s).`);
  } catch (error) {
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
    const domain = original?.domain
      ? original.domain.startsWith('.')
        ? original.domain.slice(1)
        : original.domain
      : currentDomain;
    const cookieUrl = getCookieUrl({ protocol, domain, path: normalizedPath });

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
      path: normalizedPath
    };

    if (original) {
      setDetails.domain = original.domain;
      setDetails.httpOnly = original.httpOnly;
      setDetails.secure = original.secure;
      setDetails.sameSite = original.sameSite;
      setDetails.expirationDate = original.expirationDate;
      setDetails.storeId = original.storeId;
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

dom.refreshBtn.addEventListener('click', loadCookies);

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
