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

## Store publishing CI/CD

This repository includes a GitHub Actions workflow at `.github/workflows/publish-extension.yml` that validates `manifest.json`, packages the extension once, and publishes that same package to both Microsoft Edge Add-ons and Mozilla Add-ons.

The workflow triggers automatically whenever a change to the version string inside `manifest.json` is pushed to the `main` branch. It will automatically handle generating a new GitHub Release with the bundled extension package, before pushing that asset out to the web stores via API. It can also be started manually from the **Actions** tab with `workflow_dispatch`.

Configure these repository secrets before publishing:

- `EDGE_PRODUCT_ID` — Microsoft Edge Add-ons product ID for an existing listing.
- `EDGE_API_KEY` — Microsoft Edge Add-ons API key.
- `EDGE_CLIENT_ID` — Microsoft Edge Add-ons API client ID.
- `AMO_SIGN_KEY` — Mozilla Add-ons API key/issuer.
- `AMO_SIGN_SECRET` — Mozilla Add-ons API secret.

The Edge publishing action updates an existing Edge Add-ons listing. Create the first listing manually in Partner Center, then use this workflow for subsequent releases.
