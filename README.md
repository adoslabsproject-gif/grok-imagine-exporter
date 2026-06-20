# Grok Imagine Exporter

A Chrome & Firefox extension (Manifest V3) to **bulk-export** your generated images and videos from [Grok Imagine](https://grok.com/imagine) — straight to your Downloads folder, in one click.

No console copy-pasting, no manual cookie extraction: the extension uses your **already-active session**.

## Features

- **Gallery panel** with thumbnails — browse your generations, click a photo to reveal its videos, select exactly what you want.
- **Extension chains** — when a video was extended (e.g. 10s → 20s → 30s), only the **final/longest** clip is shown and downloaded; the redundant intermediate clips are skipped automatically.
- **One-click ZIP** — download everything (or your selection) as a single archive, streamed straight to disk (handles GBs without filling memory, Chrome).
- **Built-in player** — preview videos right in the gallery.
- **Delete** — remove a photo/video (single or in bulk) from your Grok account.
- **Bulk buttons** — grab all generated videos or all generated images at once.

## How it works

- Lists your assets through the site's official API (`/rest/assets`, paginated) and resolves nested videos via `/rest/media/post/get` and `/rest/media/post/bulk-get`.
- Loads previews and files through authenticated `fetch`, bypassing the third-party-cookie/CORS limits of normal page scripts (thanks to `host_permissions`).
- Works on everything you generated — no need to "favorite" items first.

## Install

### Chrome / Edge / Brave / Opera
1. Download `grok-imagine-exporter-chrome.zip` from the [latest release](../../releases) and unzip it (or clone this repo).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder.
5. Pin the icon to the toolbar.

### Firefox
1. Download `grok-imagine-exporter-firefox.zip` from the [latest release](../../releases).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick the `manifest.json` inside the unzipped folder.
3. For a permanent install, sign/publish it through [addons.mozilla.org](https://addons.mozilla.org/developers).

> Note: building from source for Firefox uses `manifest.firefox.json` (run `bash package.sh` to produce both browser packages).

## Usage

1. Open **grok.com** and log in.
2. Click the extension icon → **Open gallery**.
3. Click a photo to see its videos, select what you want, then **Download selected (ZIP)** — or use **All videos / All images (ZIP)**.

> Tip (Chrome): turn off *"Ask where to save each file before downloading"* in `chrome://settings/downloads` for a fully silent export.

## Limitations

- Prompter images that were never saved become downloadable only after you save/favorite them on the site.
- The extension only accesses **your own account** content (it relies on your session).

## License

MIT — see [LICENSE](LICENSE). Use it, modify it, redistribute it freely.

## Disclaimer

A tool to export **your own content**. Respect Grok/xAI's Terms of Service and your local laws. Not affiliated with xAI.
