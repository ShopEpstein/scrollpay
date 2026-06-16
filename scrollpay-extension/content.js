// ScrollPay Content Script — Floating Ad Widget
// Never reads page content. Only tracks domain, impressions, clicks.
//
// Earning model: while the tab is visible AND the user has interacted recently
// (i.e. they're actively scrolling/doomscrolling), XP accrues every second and
// the ad rotates. XP is accumulated locally and flushed to the background in
// small batches so we never hit Firestore every second.

(function () {
  'use strict';

  const WIDGET_ID = 'scrollpay-widget';
  const DISMISS_KEY = 'scrollpay_dismissed_until';
  const USER_KEY = 'scrollpay_user_id';
  const WIDGET_SIZE_KEY = 'scrollpay_widget_size';
  const REF_CODE_KEY = 'scrollpay_ref_code';
  const PENDING_REF_KEY = 'scrollpay_pending_ref';
  const COOLDOWN_MS = 10 * 60 * 1000;   // close button hides widget for 10 min

  // Capture referral code when the user visits the landing page
  // (runs even before the widget is initialised / user is onboarded)
  ;(function captureRefFromUrl() {
    const h = window.location.hostname;
    if (h === 'scrollpay.app' || h === 'scrollpay-ten.vercel.app') {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) chrome.storage.local.set({ [PENDING_REF_KEY]: ref.toUpperCase() });
    }
  })();

  // Continuous-earning tunables
  const XP_PER_TICK = 1;                // base XP earned per active second (scaled by size)
  const ACCRUAL_TICK_MS = 1000;         // accrual cadence (1s)
  const ACTIVITY_WINDOW_MS = 4000;      // must have interacted within this to earn
  const AD_ROTATE_MS = 7000;            // rotate the displayed ad every 7s
  const FLUSH_MS = 10000;               // push accrued XP to Firestore every 10s
  const MAX_FLUSH = 50;                 // per-write ceiling (matches firestore.rules)

  // Size → XP multiplier mapping. Larger widget = more visible = more XP.
  const SIZE_CONFIGS = {
    sm:  { multiplier: 0.5,  label: 'S',  title: 'Small (0.5× XP)'  },
    md:  { multiplier: 1.0,  label: 'M',  title: 'Medium (1× XP)'   },
    lg:  { multiplier: 1.5,  label: 'L',  title: 'Large (1.5× XP)'  },
    xl:  { multiplier: 2.0,  label: 'XL', title: 'X-Large (2× XP)'  }
  };

  let adList = [];
  let adIndex = 0;
  let currentAd = null;
  let userId = null;

  let displayedXp = 0;     // session counter shown in the widget
  let pendingXp = 0;       // accrued integer XP not yet sent to the backend
  let fracXp = 0.0;        // fractional XP remainder carried between ticks
  let xpMultiplier = 1.0;  // current size multiplier
  let capped = false;      // hit the daily cap
  let lastActivityAt = Date.now();

  let tickTimer = null;
  let rotateTimer = null;
  let flushTimer = null;

  // --- Utility ---
  function getDomain() {
    return window.location.hostname;
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false });
          }
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }

  async function getUserId() {
    if (userId) return userId;
    const result = await chrome.storage.local.get([USER_KEY]);
    userId = result[USER_KEY] || null;
    return userId;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Dismiss logic ---
  async function isDismissed() {
    const result = await chrome.storage.local.get([DISMISS_KEY]);
    return Date.now() < (result[DISMISS_KEY] || 0);
  }

  async function setDismissed() {
    await chrome.storage.local.set({ [DISMISS_KEY]: Date.now() + COOLDOWN_MS });
  }

  // --- Widget creation ---
  function createWidget(ad) {
    const widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.setAttribute('role', 'complementary');
    widget.setAttribute('aria-label', 'ScrollPay ad widget');

    const sizeBtns = Object.entries(SIZE_CONFIGS).map(([key, cfg]) =>
      `<button class="sp-size-btn" data-size="${key}" title="${cfg.title}">${cfg.label}</button>`
    ).join('');

    widget.innerHTML = `
      <div id="sp-drag-handle" aria-label="Drag to move">
        <span class="sp-drag-dots">⠿⠿⠿</span>
        <div class="sp-brand-wrap">
          <span class="sp-brand">SCROLLPAY</span>
          <span class="sp-miner-name" id="sp-miner-name"></span>
        </div>
        <span class="sp-status"><span class="sp-dot"></span> <span id="sp-status-text">mining</span></span>
      </div>
      <div id="sp-ad-area">
        <div id="sp-video-container" style="display:none"></div>
        <div class="sp-ad-content">
          <span id="sp-brand-mark"></span>
          <div class="sp-ad-text">
            <div class="sp-ad-headline" id="sp-ad-headline"></div>
            <button class="sp-cta-btn" id="sp-cta-btn"></button>
          </div>
        </div>
      </div>
      <div id="sp-footer">
        <span class="sp-earnings" id="sp-earnings-label">₿ <span id="sp-sats-count">0</span> XP mined</span>
        <div class="sp-footer-controls">
          <div class="sp-size-controls" role="group" aria-label="Widget size">${sizeBtns}</div>
          <button class="sp-share-btn" id="sp-share-btn" aria-label="Copy referral link" title="Copy referral link">🔗</button>
          <button class="sp-close-btn" id="sp-close-btn" aria-label="Close widget">✕</button>
        </div>
      </div>
      <div id="sp-progress-bar">
        <div id="sp-progress-fill"></div>
      </div>
    `;

    return widget;
  }

  // Update the widget's ad content in place (no re-injection).
  function renderAd(ad) {
    currentAd = ad;

    // Video thumbnail (YouTube)
    const vc = document.getElementById('sp-video-container');
    if (vc) {
      if (ad.videoId) {
        vc.style.display = 'block';
        vc.innerHTML = `<div class="sp-video-thumb" id="sp-video-thumb">
          <img class="sp-video-img" src="https://img.youtube.com/vi/${escapeHtml(ad.videoId)}/hqdefault.jpg" alt="${escapeHtml(ad.brandName)}" />
          <div class="sp-play-btn">▶</div>
        </div>`;
        const thumb = document.getElementById('sp-video-thumb');
        if (thumb) thumb.addEventListener('click', handleVideoClick);
      } else {
        vc.style.display = 'none';
        vc.innerHTML = '';
      }
    }

    const mark = document.getElementById('sp-brand-mark');
    if (mark) {
      mark.innerHTML = ad.brandLogo
        ? `<img class="sp-brand-logo" src="${escapeHtml(ad.brandLogo)}" alt="${escapeHtml(ad.brandName)}" />`
        : `<span class="sp-brand-initial">${escapeHtml((ad.brandName || '?')[0])}</span>`;
    }
    const headline = document.getElementById('sp-ad-headline');
    if (headline) headline.textContent = ad.headline || '';
    const cta = document.getElementById('sp-cta-btn');
    if (cta) cta.textContent = ad.ctaText || 'Learn more';
  }

  async function handleVideoClick() {
    if (!currentAd || !currentAd.videoId) return;
    const uid = await getUserId();
    if (uid) {
      const res = await sendToBackground({ type: 'RECORD_CLICK', userId: uid, adId: currentAd.id });
      if (res && res.success) {
        displayedXp += (res.satsAwarded || 25);
        setXpDisplay(displayedXp);
      }
    }
    window.open(`https://www.youtube.com/watch?v=${currentAd.videoId}`, '_blank', 'noopener,noreferrer');
  }

  function rotateAd() {
    if (document.visibilityState !== 'visible' || adList.length === 0) return;
    adIndex = (adIndex + 1) % adList.length;
    renderAd(adList[adIndex]);
    restartProgressBar();
  }

  function restartProgressBar() {
    const fill = document.getElementById('sp-progress-fill');
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    fill.getBoundingClientRect(); // reflow
    fill.style.transition = `width ${AD_ROTATE_MS}ms linear`;
    fill.style.width = '100%';
  }

  function setStatus(text) {
    const el = document.getElementById('sp-status-text');
    if (el) el.textContent = text;
  }

  function setXpDisplay(value) {
    const el = document.getElementById('sp-sats-count');
    if (el) el.textContent = value;
  }

  // --- Earning loop ---
  function isEarning() {
    return !capped
      && document.visibilityState === 'visible'
      && (Date.now() - lastActivityAt) < ACTIVITY_WINDOW_MS;
  }

  function tick() {
    if (isEarning()) {
      // Accumulate fractional XP so non-integer multipliers stay accurate over time.
      fracXp += XP_PER_TICK * xpMultiplier;
      const whole = Math.floor(fracXp);
      if (whole > 0) {
        fracXp -= whole;
        displayedXp += whole;
        pendingXp += whole;
        setXpDisplay(displayedXp);
      }
      const rateLabel = xpMultiplier !== 1.0 ? `mining ${xpMultiplier}×` : 'mining';
      setStatus(rateLabel);
    } else if (capped) {
      setStatus('daily max');
    } else {
      setStatus('paused');
    }
  }

  // --- Widget sizing ---
  function setWidgetSize(size) {
    if (!SIZE_CONFIGS[size]) size = 'md';
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    Object.keys(SIZE_CONFIGS).forEach(k => widget.classList.remove('sp-size-' + k));
    widget.classList.add('sp-size-' + size);

    xpMultiplier = SIZE_CONFIGS[size].multiplier;

    document.querySelectorAll('.sp-size-btn').forEach(btn => {
      btn.classList.toggle('sp-size-active', btn.dataset.size === size);
    });

    chrome.storage.local.set({ [WIDGET_SIZE_KEY]: size });
  }

  async function flush() {
    if (pendingXp <= 0) return;
    const uid = await getUserId();
    if (!uid) return;

    const amount = Math.min(pendingXp, MAX_FLUSH);
    pendingXp -= amount;

    const res = await sendToBackground({ type: 'AWARD_XP', userId: uid, amount });
    if (res && res.capped) {
      capped = true;
      setStatus('daily max');
    }
  }

  function markActive() {
    lastActivityAt = Date.now();
  }

  function setupActivityTracking() {
    const opts = { passive: true, capture: true };
    ['scroll', 'wheel', 'keydown', 'mousemove', 'touchmove', 'pointermove']
      .forEach(evt => window.addEventListener(evt, markActive, opts));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  function startLoops() {
    tickTimer = setInterval(tick, ACCRUAL_TICK_MS);
    rotateTimer = setInterval(rotateAd, AD_ROTATE_MS);
    flushTimer = setInterval(flush, FLUSH_MS);
  }

  function stopLoops() {
    [tickTimer, rotateTimer, flushTimer].forEach(t => t && clearInterval(t));
    tickTimer = rotateTimer = flushTimer = null;
  }

  // --- Dragging ---
  function makeDraggable(widget) {
    const handle = document.getElementById('sp-drag-handle');
    if (!handle) return;

    let dragging = false;
    let startX, startY, startRight, startBottom;

    function dragStart(clientX, clientY) {
      dragging = true;
      startX = clientX;
      startY = clientY;
      const rect = widget.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;
      // Must use setProperty with 'important' — the widget CSS uses !important
      // on these properties, which defeats plain style.right = '...' assignment.
      widget.style.setProperty('transition', 'none', 'important');
    }

    function dragMove(clientX, clientY) {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const newRight  = Math.max(0, Math.min(startRight  - dx, window.innerWidth  - widget.offsetWidth));
      const newBottom = Math.max(0, Math.min(startBottom - dy, window.innerHeight - widget.offsetHeight));
      widget.style.setProperty('right',  newRight  + 'px', 'important');
      widget.style.setProperty('bottom', newBottom + 'px', 'important');
    }

    function dragEnd() {
      if (!dragging) return;
      dragging = false;
      widget.style.removeProperty('transition');
    }

    // Mouse
    handle.addEventListener('mousedown', (e) => {
      dragStart(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => dragMove(e.clientX, e.clientY));
    document.addEventListener('mouseup', dragEnd);

    // Touch (trackpads, touchscreens)
    handle.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      dragStart(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      dragMove(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchend', dragEnd);
  }

  // --- Dismiss ---
  async function dismissWidget() {
    const widget = document.getElementById(WIDGET_ID);
    stopLoops();
    await flush(); // bank whatever was earned before closing
    if (widget) {
      widget.classList.add('sp-hiding');
      setTimeout(() => widget.remove(), 400);
    }
    await setDismissed();
  }

  // --- Share button ---
  async function handleShareClick() {
    const btn = document.getElementById('sp-share-btn');
    try {
      const stored = await chrome.storage.local.get([REF_CODE_KEY]);
      const refCode = stored[REF_CODE_KEY];
      if (!refCode) return;
      await navigator.clipboard.writeText(`https://scrollpay.app/r/${refCode}`);
      if (btn) {
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '🔗'; }, 2000);
      }
    } catch (e) {
      console.error('[ScrollPay] Share failed:', e);
    }
  }

  // --- CTA click ---
  async function handleCtaClick() {
    if (!currentAd) return;
    const uid = await getUserId();

    if (uid) {
      const res = await sendToBackground({
        type: 'RECORD_CLICK',
        userId: uid,
        adId: currentAd.id
      });
      if (res && res.success) {
        displayedXp += (res.satsAwarded || 25);
        setXpDisplay(displayedXp);
      }
    }

    window.open(currentAd.ctaUrl, '_blank', 'noopener,noreferrer');
  }

  // --- Init ---
  async function init() {
    if (document.getElementById(WIDGET_ID)) return;       // don't inject twice
    if (await isDismissed()) return;

    const uid = await getUserId();
    if (!uid) return;                                      // not onboarded yet

    const response = await sendToBackground({ type: 'GET_AD', domain: getDomain() });
    if (!response || (!response.ads && !response.ad)) return;

    adList = (response.ads && response.ads.length) ? response.ads : [response.ad];
    adIndex = 0;

    const widget = createWidget(adList[0]);
    document.body.appendChild(widget);
    renderAd(adList[0]);
    restartProgressBar();

    // Show miner handle in widget header if set
    sendToBackground({ type: 'GET_BALANCE', userId: uid }).then(balRes => {
      const nick = balRes?.data?.nickname;
      if (nick) {
        const nameEl = document.getElementById('sp-miner-name');
        if (nameEl) {
          nameEl.textContent = nick;
          nameEl.style.setProperty('display', 'block', 'important');
        }
      }
    }).catch(() => {});

    const closeBtn = document.getElementById('sp-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', dismissWidget);
    const ctaBtn = document.getElementById('sp-cta-btn');
    if (ctaBtn) ctaBtn.addEventListener('click', handleCtaClick);
    const shareBtn = document.getElementById('sp-share-btn');
    if (shareBtn) shareBtn.addEventListener('click', handleShareClick);

    // Load and apply saved widget size
    const sizeResult = await chrome.storage.local.get([WIDGET_SIZE_KEY]);
    setWidgetSize(sizeResult[WIDGET_SIZE_KEY] || 'md');

    // Wire size buttons (stopPropagation so they don't trigger drag)
    document.querySelectorAll('.sp-size-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setWidgetSize(btn.dataset.size);
      });
    });

    makeDraggable(widget);
    setupActivityTracking();
    startLoops();

    // Pause ad rotation while the user hovers so they can read/click comfortably
    widget.addEventListener('mouseenter', () => {
      if (rotateTimer) {
        clearInterval(rotateTimer);
        rotateTimer = null;
      }
      const fill = document.getElementById('sp-progress-fill');
      if (fill) fill.style.animationPlayState = 'paused', fill.style.transition = 'none';
    });
    widget.addEventListener('mouseleave', () => {
      if (!rotateTimer) rotateTimer = setInterval(rotateAd, AD_ROTATE_MS);
      restartProgressBar();
    });

    requestAnimationFrame(() => widget.classList.add('sp-visible'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
