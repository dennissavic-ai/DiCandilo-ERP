# DiCandilo ERP — Desktop App

Electron wrapper that loads the hosted DiCandilo ERP web app in a native window.
All data lives in the shared cloud database — the installer is just a shell.

## Setup

```bash
cd apps/desktop
npm install
```

## Development (points to localhost:4000)

Start the web app first, then:

```bash
npm run dev
```

## Building Installers

### macOS (.dmg)
Must be run on a Mac:
```bash
npm run build:mac
```
Output: `dist-electron/DiCandilo ERP-1.0.0.dmg`

### Windows (.exe)
Must be run on Windows or in CI:
```bash
npm run build:win
```
Output: `dist-electron/DiCandilo ERP Setup 1.0.0.exe`

## CI/CD Builds (recommended)

Push a version tag to trigger automated builds via GitHub Actions:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build both installers and attach them to a GitHub Release automatically.

## Configuration

| Environment Variable | Description |
|---|---|
| `ERP_URL` | Override the production URL (defaults to `https://sucasa.services`) |
| `ELECTRON_ENV` | Set to `development` to load `localhost:4000` |

## Client Subdomains

When onboarding a client on their own subdomain (e.g. `client.sucasa.services`),
build a custom installer with:

```bash
ERP_URL=https://client.sucasa.services npm run build:mac
ERP_URL=https://client.sucasa.services npm run build:win
```

## Required GitHub Secrets

Add these in **Settings → Secrets → Actions**:

| Secret | Description |
|---|---|
| `ERP_PRODUCTION_URL` | Override URL (optional — defaults to `https://sucasa.services`) |

### Optional (code signing — removes security warnings)
| Secret | Description |
|---|---|
| `MAC_CERTIFICATE` | Base64-encoded .p12 Apple Developer certificate |
| `MAC_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `WIN_CERTIFICATE` | Base64-encoded Windows code signing cert |
| `WIN_CERTIFICATE_PASSWORD` | Certificate password |

## Icons

Place icon files in `assets/`:
- `icon.icns` — macOS
- `icon.ico` — Windows
- `icon.png` — Linux / fallback (512×512 recommended)
