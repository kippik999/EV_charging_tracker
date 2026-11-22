# EV Tracker

Personal EV charging log and dashboard. It's an installable web app (PWA): it works offline, and all data stays in the phone's browser storage.

## Put it on your phone (GitHub Pages, no git needed)

1. Sign in at github.com and create a new **public** repository, for example `ev-tracker`. (Pages is free for public repos. Your charge data is never uploaded, only the app code.)
2. In the repo, click **Add file → Upload files**. Drag in **everything inside this `ev-tracker` folder** (`index.html`, `manifest.webmanifest`, `sw.js`, and the `css`, `js` and `icons` folders), then click **Commit changes**. You can leave out `tests` and `README.md`.
3. Go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute the site is at `https://<your-username>.github.io/ev-tracker/`. Open it in **Chrome on Android**, then tap **⋮ → Install app** (or "Add to Home screen").
5. In the app: **Settings → Import from Fuelio**, and pick the CSV from Fuelio (Fuelio → Settings → Backup → Export CSV).

## Updating the app later

Upload the changed files again. Also edit `sw.js` and bump `VERSION` (for example `ev-tracker-v2`). The phone picks up the new version the next time the app is opened twice.

## Backups

Data lives only on the phone. Use **Settings → Export backup (JSON)** now and then, and **Restore backup** on a new phone. Uninstalling the app or clearing Chrome's site data deletes the charges.

## How the numbers are calculated

- Charges are ordered by **odometer**. Each charge's kWh is counted against the distance driven since the previous charge. The first charge has no known distance, so it's left out of kWh/100 km and $/100 km, but it still counts in totals.
- **Free charges without a kWh value**: `(SoC end − SoC start) × battery ÷ efficiency`. Efficiency is the median from your paid charges with SoC entered (once there are 3 or more), and the default (90%) until then. Estimated values are shown with "≈".
- **AC/DC for imported Fuelio charges** is guessed from the price: at or above the cutoff in Settings ($0.55/kWh) means DC. Change the cutoff and tap "Re-apply DC cutoff" to update imported charges you haven't edited yourself.

## Testing on the PC

`powershell -ExecutionPolicy Bypass -File ..\serve.ps1` (from the workspace), then open:
- `http://localhost:8080/ev-tracker/`: the app
- `http://localhost:8080/ev-tracker/tests/test.html`: unit tests, including checks against the Fuelio export in `Input/`
- `http://localhost:8080/ev-tracker/tests/ui.html`: the app with in-memory storage preloaded with the Fuelio export
