# Cookie Editor Chrome Extension

A lightweight Chrome Extension (Manifest V3) for viewing, editing, creating, and deleting cookies for the current active tab's domain.

## Features

- View cookies for the current tab host context (across all cookie paths, excluding deeper subdomains)
- Edit cookie name, value, and path
- Create new cookies (including empty-value cookies)
- Delete existing cookies
- Filter cookies by name, value, path, or domain with instant search
- Delete all currently listed cookies with one confirmation flow
- Refresh cookie list on demand

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Click the extension icon and open **Cookie Editor**.

## Notes

- This extension works on `http://` and `https://` tabs.
- Cookie behavior still follows browser security rules (e.g. host/path restrictions, secure contexts).
- Cookies are read/written in the active tab's cookie store to support regular and incognito windows separately.
