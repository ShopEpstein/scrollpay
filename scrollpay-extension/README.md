# ScrollPay Chrome Extension

Earn XP for every ad impression while browsing. XP = entries in a periodic
prize draw. (No per-user crypto payouts — see "Prize Draw" below.)

## File Structure

```
scrollpay-extension/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — all Firebase calls
├── content.js             # Floating widget injected on all pages
├── widget.css             # Widget styles (fully scoped to #scrollpay-widget)
├── popup.html/js/css      # Extension popup (balance, settings, referral)
├── onboarding.html/js/css # 4-screen onboarding flow
├── privacy.html           # Privacy policy
├── firestore.rules        # Firestore security rules
└── icons/                 # 16, 48, 128px PNG icons
```

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Project: `scrollpay-1ce29` (already configured in background.js)
3. Enable Firestore Database
4. Apply `firestore.rules` from this folder
5. Seed an ad with the script in `seed/` (`node seed.js`), or add a doc to the
   `sp_ads` collection manually:

```json
{
  "brandName": "ScrollPay",
  "brandLogo": "",
  "headline": "Invite friends. Earn 50 XP per install.",
  "ctaText": "Share now",
  "ctaUrl": "https://scrollpay.app",
  "pointsPerImpression": 5,
  "active": true,
  "totalBudget": 10000,
  "budgetUsed": 0,
  "impressions": 0,
  "clicks": 0
}
```

## Prize Draw

Users earn XP; 1 XP = 1 entry in a periodic (e.g. weekly) prize draw. There are
no per-user crypto payouts, so no Lightning/OpenNode integration is needed.

For now the draw is **manual**: periodically export `sp_users`, weight each user
by `totalSats` (the XP field), pick a random winner, and contact them via the
email collected at onboarding. Automating this (draw periods, winner selection,
results UI) is a future step.

> Note: XP is stored internally under the existing `totalSats` / `satsToday`
> Firestore fields to avoid a data migration. The UI labels them "XP".

## Chrome Web Store Submission

1. Zip the extension folder: `zip -r scrollpay.zip scrollpay-extension/`
2. Go to [Chrome Developer Console](https://chrome.google.com/webstore/devconsole)
3. Pay $5 one-time developer fee
4. Upload zip → New Item
5. Category: **Productivity**
6. Description:
   > ScrollPay rewards you with XP for ads you see while browsing — 5 XP per impression, 25 XP per click. Your XP becomes entries in our prize draw. Privacy-safe — we never read your page content. Works on Twitter, Reddit, YouTube, Instagram, TikTok, and everywhere else.
7. Take screenshots of widget on Twitter and Reddit
8. Privacy policy URL: link to your hosted `privacy.html`

## XP System

| Action | XP |
|--------|------|
| Ad impression (2+ sec) | 5 |
| Ad click | 25 |
| Referral install | 50 |
| Daily cap | 5,000 |
| 1 XP | 1 prize-draw entry |

## Technical Notes

- Manifest V3 compliant
- No eval(), no remote code execution
- Content script never calls Firebase directly (messages background.js)
- All state in chrome.storage.local
- Widget CSS fully scoped to `#scrollpay-widget`
- MutationObserver not used (IntersectionObserver for visibility)
- All async in try/catch
