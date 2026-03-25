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
        path: pathInput.value || '/'
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
    if (!name.trim()) {
      throw new Error('Cookie name cannot be empty.');
    }

    const cookieUrl = `${new URL(currentUrl).protocol}//${currentDomain}${path.startsWith('/') ? path : `/${path}`}`;

    if (original && (original.name !== name || original.path !== path)) {
      await chrome.cookies.remove({ url: currentUrl, name: original.name });
    }

    await chrome.cookies.set({
      url: cookieUrl,
      name,
      value,
      path,
      secure: original?.secure ?? false,
      sameSite: original?.sameSite ?? 'lax',
      expirationDate: original?.expirationDate
    });

    setStatus(`Saved cookie "${name}".`);
    await loadCookies();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteCookie(cookie) {
  try {
    await chrome.cookies.remove({
      url: `${new URL(currentUrl).protocol}//${currentDomain}${cookie.path}`,
      name: cookie.name
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
    path: dom.newPath.value || '/'
  });
  dom.addCookieForm.reset();
  dom.newPath.value = '/';
});

loadCookies();
