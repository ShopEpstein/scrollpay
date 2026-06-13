# ScrollPay — Path to Live

Goal: make installation **easy** — one click from the landing page. The only
way to do that for a Chrome extension is the **Chrome Web Store** (self-hosted
installs require developer mode and are not user-friendly). So the plan is:
publish to the Web Store, then point the landing-page "Add to Chrome" button at
the listing.

## A. Landing page (built — needs hosting)
The marketing site lives in `docs/` (`index.html` + `privacy.html` + icon).

**Host it free with GitHub Pages:**
1. GitHub → repo **Settings → Pages**.
2. Source: **Deploy from a branch** → Branch `main`, folder **/docs** → Save.
3. After ~1 min it's live at `https://shopepstein.github.io/scrollpay/`.
4. (Optional) Custom domain: if you own `scrollpay.app`, set it in Settings →
   Pages → Custom domain, and add the DNS records GitHub shows.

The privacy policy is then at `…/privacy.html` — that public URL is required by
the Web Store.

## B. Chrome Web Store submission (your actions)
1. **Developer account** — https://chrome.google.com/webstore/devconsole, pay
   the one-time **$5** fee.
2. **Build the upload zip** — zip the *contents* of `scrollpay-extension/` (the
   folder with `manifest.json` at the top level), excluding `seed/`:
   ```
   cd scrollpay-extension && zip -r ../scrollpay-upload.zip . -x "seed/*"
   ```
3. **New item** → upload the zip.
4. **Listing fields** — copy is ready below.
5. **Privacy** — paste the hosted privacy-policy URL from step A; declare the
   permissions usage (`<all_urls>` is needed to show the widget on any site;
   we do not read page content).
6. **Screenshots** — capture the widget on Twitter/Reddit and a shot of the
   popup (XP + draw entries). 1280×800 or 640×400.
7. **Submit for review.** Expect scrutiny: "rewards for viewing ads" + broad
   host permissions is a flagged category. Be ready for questions or a rejection
   round; respond with the privacy-safe design (no content reading, domain-only).

## C. After approval
1. Copy the published listing URL.
2. In `docs/index.html`, replace the two placeholder `href="#"` install links
   (search for `TODO: replace href`) with the store URL. Re-deploy (just push).

## Store listing copy (ready to paste)
- **Name:** ScrollPay — Earn XP While You Browse
- **Summary (132 char max):** Earn XP for ads you see while browsing and use it
  to enter weekly prize draws. Privacy-safe — we never read your pages.
- **Category:** Productivity
- **Description:**
  > ScrollPay rewards you with XP for the browsing you already do. A small,
  > dismissible widget shows you the occasional ad — see it or tap it, and you
  > earn XP. Every XP is an entry in our weekly prize draw, so the more you
  > browse, the better your odds of winning.
  >
  > • 5 XP per ad you see, 25 XP for ones you tap, 50 XP per friend you refer
  > • 1 XP = 1 entry in the weekly prize draw
  > • Works on Twitter/X, Reddit, YouTube, Instagram, TikTok, and everywhere else
  >
  > Private by design: we never read your page content, URLs, or anything you
  > type — only which site you're on and whether an ad was shown. We never sell
  > your data.

## Interim: pilot before approval
Web Store review takes time. To test with real users now, have them install the
unpacked build (developer mode, "Load unpacked" → `scrollpay-extension/`). Not
pretty, but it validates engagement while the listing is in review.
