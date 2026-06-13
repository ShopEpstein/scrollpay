# ScrollPay — Project Status & Handoff

_Last updated: 2026-06-13_

## What ScrollPay is
A Manifest V3 Chrome extension that shows a floating ad widget on web pages and
awards the user **XP** per ad impression/click. XP = entries in a periodic
(weekly) **prize draw** — there are NO per-user crypto payouts. Backend is
Firebase Firestore.

> **Model pivot (2026-06-13):** originally "earn real Bitcoin via Lightning".
> Switched to XP + prize draw to remove the per-user payout pipeline, Lightning
> wallet funding, and money-transmission burden. The UI says "XP" everywhere;
> the Lightning-address and withdrawal flows were removed.
>
> **Internal naming:** XP is stored under the existing `totalSats` / `satsToday`
> Firestore fields (and `satsAwarded` on impressions) to avoid a data migration.
> Code still uses those names internally; only the UI labels them "XP".

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

Plus, at repo root:
- `docs/` — marketing landing page (`index.html` + `privacy.html` + icon),
  built for GitHub Pages hosting. The "Add to Chrome" buttons are placeholders
  until the Web Store listing exists (search `TODO: replace href`).
- `LAUNCH.md` — path-to-live checklist (GitHub Pages hosting, Chrome Web Store
  submission steps, and ready-to-paste store listing copy).

## Backend state (LIVE)
- Firebase project: **`scrollpay-1ce29`** (config baked into `background.js`).
- **Cloud Firestore** enabled (NOT Realtime Database — the extension uses Firestore).
- Security rules published from `firestore.rules`.
- One ad seeded: `sp_ads/staccana` with `active: true`.
- Firestore collections used: `sp_ads`, `sp_users`, `sp_impressions`.

## What works right now
- Loads as an unpacked extension and runs.
- Talks to the live Firestore project; reads active ads; writes users + XP.
- **Continuous earning:** the widget rotates ads and accrues XP every second the
  user is actively browsing (tab visible + interacted within ~4s). XP is batched
  locally and flushed via `AWARD_XP` (≤50/write) every ~10s and on tab hide.
  Clicks award 25, referrals 50. Daily cap 5000, enforced server-side in
  `awardXp`. Tunables are at the top of `content.js`.
- Popup shows XP total and "N entries in the next draw"; onboarding collects an
  optional email (to contact draw winners).
- Note: the old one-shot `RECORD_IMPRESSION` path still exists in `background.js`
  but is no longer used by `content.js` (replaced by continuous `AWARD_XP`).

## What is NOT done (gaps before this is a real product)
1. **The prize draw is manual.** No code picks a winner. Process for now:
   export `sp_users`, weight by `totalSats` (the XP field), pick a random
   winner, contact them by the onboarding email. Automating the draw (periods,
   winner selection, results UI) is a future step — not required to launch.
2. **Not verified end-to-end.** Nobody has loaded it unpacked and confirmed the
   widget renders and Firestore writes happen. This is the immediate next step.
3. **Not published** to the Chrome Web Store (no dev account, no review).
4. **Ad content is placeholder** — Staccana headline/`ctaUrl` are guesses.

## Known issues / tech debt
- **Minting is only partially mitigated — and continuous earning raises the
  stakes.** Awarding happens client-side with no auth (random `anon_*` ids), so
  rules can't fully stop self-awarding. The continuous model means a scripted
  client could farm up to the 5000/day cap without real browsing. Activity
  gating (visibility + recent interaction) and the daily cap limit casual abuse,
  but the real fix is server-side awarding before the prize has meaningful
  value. Current rules block pre-loaded balances, enforce monotonic balances,
  and cap a single write to <=50 XP. See `firestore.rules`.
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
   page, confirm the Staccana widget renders, the popup shows XP + draw entries,
   and `sp_users`/`sp_impressions` populate in Firestore. Check the
   service-worker console for errors.
2. **Run a small real-world test** — a handful of users for a week — to see if
   people keep the widget on and engage. Validate the behavior before investing
   in automation.
3. **Decide the prize + draw cadence** and state it in the popup/onboarding
   (currently placeholder copy: "weekly"). Run the first draw manually.
4. **Move XP-awarding server-side** (Cloud Function / Worker) to close the
   minting hole — important before the draw involves anything valuable — and to
   make ad stat counters work.
5. **Automate the draw** (optional): draw periods, winner selection, results UI.
6. Prep Chrome Web Store submission (Firebase SDK is already vendored locally).

## How to seed more ads
From `scrollpay-extension/seed/`: save a service-account key as
`serviceAccountKey.json` (gitignored), `npm install`, edit the `ADS` array in
`seed.js`, then `node seed.js`. Re-running updates content without resetting
counters.
