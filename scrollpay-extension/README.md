# ScrollPay Chrome Extension

Earn Bitcoin (sats via Lightning Network) for every ad impression while browsing.

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
2. Project: `growthmonster` (already configured in background.js)
3. Enable Firestore Database
4. Apply `firestore.rules` from this folder
5. Create initial ad document in `sp_ads` collection:

```json
{
  "brandName": "ScrollPay",
  "brandLogo": "",
  "headline": "Invite friends. Earn 50 sats per install.",
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

## Payout Setup (OpenNode)

Withdrawals are triggered from `https://scrollpay.app/withdraw` — you need to build:
1. A Firebase Cloud Function that listens for withdrawal requests
2. Calls OpenNode API: `POST https://api.opennode.com/v1/withdrawals`
3. Requires `Authorization: Bearer YOUR_OPENNODE_API_KEY`

## Chrome Web Store Submission

1. Zip the extension folder: `zip -r scrollpay.zip scrollpay-extension/`
2. Go to [Chrome Developer Console](https://chrome.google.com/webstore/devconsole)
3. Pay $5 one-time developer fee
4. Upload zip → New Item
5. Category: **Productivity**
6. Description:
   > ScrollPay pays you in real Bitcoin (via Lightning Network) for ads you see while browsing. 5 sats per impression, 25 sats per click. Privacy-safe — we never read your page content. Works on Twitter, Reddit, YouTube, Instagram, TikTok, and everywhere else.
7. Take screenshots of widget on Twitter and Reddit
8. Privacy policy URL: link to your hosted `privacy.html`

## Points System

| Action | Sats |
|--------|------|
| Ad impression (2+ sec) | 5 |
| Ad click | 25 |
| Referral install | 50 |
| Daily cap | 5,000 |
| Payout minimum | 1,000 |

## Technical Notes

- Manifest V3 compliant
- No eval(), no remote code execution
- Content script never calls Firebase directly (messages background.js)
- All state in chrome.storage.local
- Widget CSS fully scoped to `#scrollpay-widget`
- MutationObserver not used (IntersectionObserver for visibility)
- All async in try/catch
