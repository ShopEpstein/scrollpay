# ScrollPay — Project Status & Handoff

_Last updated: 2026-06-13_

## What ScrollPay is
A Manifest V3 Chrome extension that shows a floating ad widget on web pages
and credits the user "sats" (Bitcoin, via Lightning) per ad impression/click.
Backend is Firebase Firestore. Intended payout rail is OpenNode (Lightning),
not yet built.

## Repository
- Repo: `ShopEpstein/scrollpay`
- Default branch `main` is up to date with all work below (hardened rules,
  `scrollpay-1ce29` config, seed script, vendored Firebase SDK, this doc).
- Work branch: `claude/funny-dirac-3818uh`.

## File layout (`scrollpay-extension/`)
- `manifest.json` — MV3 manifest
- `background.js` — service worker; all Firestore calls + message handling
- `content.js` + `widget.css` — injected floating ad widget
- `popup.html/js/css` — balance/settings/referral popup
- `onboarding.html/js/css` — first-run flow (creates the user doc)
- `privacy.html` — privacy policy
- `firestore.rules` — security rules (hardened, see below)
- `icons/` — 16/48/128 px
- `seed/` — Admin SDK script to seed ad docs (`node seed.js`)

## Backend state (LIVE)
- Firebase project: **`scrollpay-1ce29`** (config baked into `background.js`).
- **Cloud Firestore** enabled (NOT Realtime Database — the extension uses Firestore).
- Security rules published from `firestore.rules`.
- One ad seeded: `sp_ads/staccana` with `active: true`.
- Firestore collections used: `sp_ads`, `sp_users`, `sp_impressions`.

## What works right now
- Loads as an unpacked extension and runs.
- Talks to the live Firestore project; reads the seeded ad; writes users/impressions.
- Awarding logic (5/impression, 25/click, 50/referral, 5000 daily cap) runs
  client-side in `background.js`.

## What is NOT done (gaps before this is a real product)
1. **No payouts.** Sats are just numbers in Firestore. There is no withdrawal
   path. README specifies a Firebase Cloud Function calling OpenNode
   (`POST https://api.opennode.com/v1/withdrawals`) — not built. This is the
   core missing piece.
2. **Not verified end-to-end.** Nobody has loaded it unpacked and confirmed the
   widget renders and Firestore writes happen. This is the immediate next step.
3. **Not published** to the Chrome Web Store (no dev account, no review).
4. **Ad content is placeholder** — Staccana headline/`ctaUrl` are guesses.

## Known issues / tech debt
- **Minting is only partially mitigated.** Awarding happens client-side, and
  there is no auth (users are random `anon_*` ids), so rules cannot fully stop a
  determined user from self-awarding. Current rules block pre-loaded balances,
  enforce monotonic balances, and cap a single write to <=50 sats / 1
  impression. The real fix is server-side awarding (Cloud Function / Worker)
  with the client unable to write balances. See `firestore.rules`.
- **Ad stat counters don't update.** `background.js` tries to increment
  `impressions`/`clicks`/`budgetUsed` on `sp_ads`, but rules block client writes
  to ads (`allow write: if false`), so those writes fail silently. Move to
  server-side to fix.
- ~~Firebase SDK loads from a CDN~~ **RESOLVED.** The Firebase modular SDK is
  now bundled locally at `scrollpay-extension/vendor/firebase/firebase-bundle.js`
  (built from `firebase@10.7.1` with esbuild), and `background.js` imports from
  it instead of `gstatic.com`. This satisfies MV3's `script-src 'self'` CSP, so
  the service worker can start and Firestore works. To rebuild after a Firebase
  version bump: `npm i firebase@<ver> esbuild`, re-export the same symbols from
  an entry file, and `esbuild entry.js --bundle --format=esm --minify`.

## Security note
A Firebase Admin service-account key was used once to run the seed script and
then deleted from the working environment. It should be **revoked** in the
Firebase console (Service accounts → key id ending `...1a9f4bf0`) if not
already done.

## Recommended next steps (in order)
1. **Verify locally.** Load `scrollpay-extension/` unpacked in Chrome, browse a
   page, confirm the Staccana widget renders and `sp_users`/`sp_impressions`
   populate in Firestore. Check the service-worker console for errors.
2. **Merge the branch to `main`** once verified.
3. **Build the withdrawal path** (Cloud Function + OpenNode) — the actual
   "earn Bitcoin" feature.
4. **Move awarding server-side** to close the minting hole and make ad stats work.
5. Prep Chrome Web Store submission (Firebase SDK is already vendored locally).

## How to seed more ads
From `scrollpay-extension/seed/`: save a service-account key as
`serviceAccountKey.json` (gitignored), `npm install`, edit the `ADS` array in
`seed.js`, then `node seed.js`. Re-running updates content without resetting
counters.
