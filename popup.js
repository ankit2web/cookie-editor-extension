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

function getCookieProtocol(cookie) {
  if (cookie?.secure) {
    return 'https:';
  }

  return new URL(currentUrl).protocol;
}

function cookieToUrl({ domain, path, secure }) {
  const protocol = secure ? 'https:' : new URL(currentUrl).protocol;
  const host = domain.startsWith('.') ? domain.slice(1) : domain;
  return `${protocol}//${host}${normalizePath(path)}`;
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
    `HostOnly: ${cookie.hostOnly}`,
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

    const cookies = await chrome.cookies.getAll({ domain: currentDomain });
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
    const normalizedPath = normalizePath(path);

    if (!trimmedName) {
      throw new Error('Cookie name cannot be empty.');
    }

    if (!currentUrl || !currentDomain) {
      throw new Error('Current tab context is not ready yet.');
    }

    if (original && (original.name !== trimmedName || original.path !== normalizedPath)) {
      await chrome.cookies.remove({
        url: cookieToUrl({ domain: original.domain, path: original.path, secure: original.secure }),
        name: original.name,
        storeId: original.storeId
      });
    }

    await chrome.cookies.set({
      url: `${getCookieProtocol(original)}//${currentDomain}${normalizedPath}`,
      name: trimmedName,
      value,
      path: normalizedPath,
      storeId: original?.storeId,
      secure: original?.secure ?? false,
      httpOnly: original?.httpOnly ?? false,
      sameSite: original?.sameSite ?? 'lax',
      expirationDate: original?.session ? undefined : original?.expirationDate
    });

    setStatus(`Saved cookie "${trimmedName}".`);
    await loadCookies();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteCookie(cookie) {
  try {
    await chrome.cookies.remove({
      url: cookieToUrl({ domain: cookie.domain, path: cookie.path, secure: cookie.secure }),
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

  await upsertCookie({
    name: dom.newName.value,
    value: dom.newValue.value,
    path: dom.newPath.value
  });

  dom.addCookieForm.reset();
  dom.newPath.value = '/';
});

loadCookies();
