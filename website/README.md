# DevDock website

DevDock's landing and download page: one static page (Vite + plain TypeScript, no framework),
system fonts, no cookies, analytics or third-party scripts. It's independent of the app: its own
`package.json`, built and tested on its own. The look follows `../docs/UI-THEMES.md` (same tokens
and five themes as the app).

## Preview locally

```sh
cd website
npm install
npm run dev        # http://localhost:5173, hot reload
npm run build      # typecheck + build into website/dist
npm run preview    # serves website/dist at http://localhost:4173 (what gets published)
```

## Test

```sh
npm test                                   # Vitest: OS/CPU detection, file names and links, manifest, install steps
npm run build && PW_CHANNEL=chrome npx playwright test site   # page in a browser: downloads, dialog, tabs, theme
SHOTS_DIR=/tmp/devdock-shots PW_CHANNEL=chrome npx playwright test screens   # light/dark × desktop/phone screenshots
```

`PW_CHANNEL=chrome` uses your installed Google Chrome; without it, run
`npx playwright install chromium` once. The browser tests answer GitHub download links locally,
so nothing is downloaded from GitHub.

## How downloads work

Everything comes from `src/config.ts`:

- `available: false` (as shipped): the page says **Downloads coming soon** and links to no
  installer. Never point the page at a release that doesn't exist.
- `naming: 'versioned'` uses today's electron-builder file names (`DevDock-0.1.0-arm64.dmg`, …)
  and links to that version's tag (`/releases/download/v0.1.0/…`), so `version` must be bumped
  for each release.
- `naming: 'versionless'` uses `DevDock-arm64.dmg`, `DevDock-x64.dmg`, `DevDock-Setup.exe`,
  `DevDock-Portable.exe` and links to `/releases/latest/download/…`, which always serves the
  newest published release. This needs the `artifactName` change proposed in
  `docs/DECISIONS.md` (P7-D).
- **`releases.json`** (preferred): the Pages workflow asks the GitHub API for the latest
  _published_ release and writes `public/releases.json` with exact file names, links and sizes
  (`scripts/releases-json.mjs`). When it's present the page uses it and ignores the config, so
  the site is always in step with the release and works with either naming. If the latest
  release lacks one of the four installers, no file is written and the config applies.

The visitor's system is detected in `src/detect.ts`: `navigator.userAgentData` with the
`architecture` client hint where the browser offers it (Chrome, Edge), the user agent otherwise.
Safari and Firefox can't tell Apple silicon from Intel (every Mac user agent says "Intel"), so
Macs default to Apple silicon and the page always offers "Intel Mac?". Windows on Arm gets the
x64 build (it runs under emulation). Linux and phones see all installers and a note.

A download is a plain link to the GitHub asset: the browser's own download starts, and the
page opens the "Thanks for downloading DevDock" dialog with the steps for that installer
(`src/steps.ts`), including the one-time Gatekeeper / SmartScreen step and the note about
company-managed computers.

## Publishing (the owner decides when)

Nothing here runs by itself.

1. **Release the app.** Bump `version` in the root `package.json`, add the `CHANGELOG.md`
   section, then tag: `git tag v0.1.0 && git push origin v0.1.0`. The **Release** workflow
   (`.github/workflows/release.yml`) checks the tag matches `package.json`, builds the DMGs on
   macOS and the Setup + portable on Windows, and attaches them with `SHA256SUMS.txt` to a
   **draft** release. Review it on GitHub and press **Publish release**. Drafts and
   pre-releases aren't "latest", so the site ignores them.
2. **Publish the site.** Once: repository Settings → Pages → Source: **GitHub Actions**. Then
   Actions → **Website** → **Run workflow**. It writes `releases.json` from the latest published
   release, runs the unit tests, builds and deploys to
   `https://code08-ind.github.io/devdock/` (the build uses relative URLs, so a custom domain
   works too: add it in Settings → Pages).
3. **After each new release**, run the Website workflow again so the page picks up the new
   files (or switch to version-less names, after which links never change).

If you publish the site without the workflow (any static host), set `available: true` and the
right `version` in `src/config.ts` first, or the page keeps saying "Downloads coming soon".

## Files

| Path                        | What                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `index.html`                | All content (works without JavaScript; JS adds detection and tabs) |
| `src/style.css`             | Tokens and themes from UI-THEMES, layout                           |
| `src/config.ts`             | Where installers live; the "coming soon" switch                    |
| `src/detect.ts`             | OS and CPU detection → installer                                   |
| `src/downloads.ts`          | File names, links, `releases.json`                                 |
| `src/steps.ts`              | Install steps per installer, for the dialog                        |
| `public/theme.js`           | Applies the saved theme before first paint                         |
| `public/img/`               | WebP copies of `docs/screenshots` (`sh website/scripts/images.sh`) |
| `scripts/releases-json.mjs` | GitHub API release → `releases.json`                               |
