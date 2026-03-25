# Cookie Editor Chrome Extension

A lightweight Chrome Extension (Manifest V3) for viewing, editing, creating, and deleting cookies for the current active tab's domain.

## Features

- View all cookies for the current tab domain
- Edit cookie name, value, and path
- Create new cookies
- Delete existing cookies
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
