# DevDock website

DevDock's landing and download page: one static page (Vite + plain TypeScript, no framework),
no cookies, analytics or third-party scripts. It's independent of the app: its own
`package.json`, built and tested on its own. The look is the family of
[www.aryangarg.com](https://www.aryangarg.com/) so it can live on a subdomain of it
(`devdock.aryangarg.com`): the same zinc palette, Geist / Geist Mono type and Doto dot-matrix
section titles (self-hosted in `public/fonts/`, SIL OFL), the railed centre column with hatched
dividers, and Light/Dark that follow the system until the toggle is pressed.

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
npm test                                   # Vitest: OS/CPU detection, file names and links, manifest, install steps, palette + contrast
npm run build && PW_CHANNEL=chrome npx playwright test site axe   # in a browser: downloads, dialog, tabs, theme; axe WCAG 2.2 AA in Light and Dark
SHOTS_DIR=/tmp/devdock-shots PW_CHANNEL=chrome npx playwright test screens   # light/dark × desktop/phone screenshots
```

`PW_CHANNEL=chrome` uses your installed Google Chrome; without it, run
`npx playwright install chromium` once. The browser tests answer GitHub download links locally,
so nothing is downloaded from GitHub.

## How downloads work

Installers are named without the version — `DevDock-arm64.dmg`, `DevDock-x64.dmg`,
`DevDock-Setup.exe`, `DevDock-Portable.exe` (`artifactName` in `../electron-builder.yml`) — so
every download link is `https://github.com/code08-ind/devdock/releases/latest/download/<name>`,
which GitHub redirects to the newest **published** release. The links never change.

- **`releases.json`**: the Vercel build (`npm run build:site`) first runs
  `scripts/releases-json.mjs`, which asks the GitHub API for the latest published release and,
  if all four installers are attached, writes `public/releases.json` with the version and
  exact sizes. When it's present the page shows downloads with that version. It never fails
  the build: no release, a missing installer, no network or a rate limit just means no file
  (set `GITHUB_TOKEN` in Vercel to raise the API limit if it ever matters).
- **`src/config.ts`** applies without `releases.json`. Shipped with `available: false`: the
  page says **Downloads coming soon** and links to no installer. Never point the page at a
  release that doesn't exist.

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
2. **Host the site on Vercel** (once). Import the GitHub repository as a Vercel project and set
   **Root Directory** to `website`. `website/vercel.json` sets the rest: `npm ci`,
   `npm run build:site`, output `dist`, no framework preset, and security headers
   (`frame-ancestors 'none'`, `nosniff`, `no-referrer`; the page's own CSP is a `<meta>` added
   by `vite.config.ts`). Pushes to `main` then deploy production; other branches get preview
   URLs. To serve it on the subdomain, see **Custom domain** below (the build uses relative
   URLs, so nothing in the code changes).
3. **After each new release**, redeploy the latest production deployment in Vercel (or push any
   commit) so the page shows the new version and sizes. The download links already point at the
   new files.

## Custom domain: `devdock.aryangarg.com`

The owner does this once, after the Vercel project exists. Nothing in the repo changes.

1. In Vercel, open the DevDock project → **Settings → Domains** → **Add Domain**, type
   `devdock.aryangarg.com` and add it to **Production**. Vercel then shows the DNS record it
   expects (and "Invalid Configuration" until it sees it).
2. At the DNS provider of `aryangarg.com` add one record:

   | Type  | Name / Host | Value / Target         | TTL            |
   | ----- | ----------- | ---------------------- | -------------- |
   | CNAME | `devdock`   | `cname.vercel-dns.com` | Auto (or 3600) |

   Use exactly the target Vercel shows in step 1 if it differs (Vercel sometimes gives a
   project-specific `…vercel-dns-0xx.com` name). Don't add an A record for the subdomain and
   don't touch the records of `www`/the apex, so www.aryangarg.com is unaffected.

   - If `aryangarg.com` itself is already on Vercel **with Vercel's nameservers**, there's
     nothing to add at a registrar: adding the domain in step 1 creates the record.
   - If it's behind **Cloudflare**, set the record to **DNS only** (grey cloud) so Vercel can
     issue the certificate.

3. Wait until Vercel shows **Valid Configuration** (minutes, sometimes up to an hour). It issues
   the HTTPS certificate itself.
4. Optional: link to it from www.aryangarg.com's Work section, and add
   `devdock.aryangarg.com` as the "Open Live" link.

`vercel.json`'s headers and the page's CSP are all same-origin, so they work unchanged on the
subdomain.

## Files

| Path                        | What                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `index.html`                | All content (works without JavaScript; JS adds detection and tabs) |
| `src/style.css`             | aryangarg.com palette (Light/Dark), fonts, layout                  |
| `public/fonts/`             | Geist, Geist Mono, Doto (latin WOFF2, OFL; `LICENSE.txt`)          |
| `src/config.ts`             | Where installers live; the "coming soon" switch                    |
| `src/detect.ts`             | OS and CPU detection → installer                                   |
| `src/downloads.ts`          | File names, links, `releases.json`                                 |
| `vercel.json`               | Vercel build settings and response headers                         |
| `src/steps.ts`              | Install steps per installer, for the dialog                        |
| `public/theme.js`           | Applies the saved theme before first paint                         |
| `public/img/`               | WebP copies of `docs/screenshots` (`sh website/scripts/images.sh`) |
| `scripts/releases-json.mjs` | Latest GitHub release → `releases.json` (run by `build:site`)      |
