// ScrollPay Content Script — Floating Ad Widget
// Never reads page content. Only tracks domain, impressions, clicks.

(function () {
  'use strict';

  const WIDGET_ID = 'scrollpay-widget';
  const DISMISS_KEY = 'scrollpay_dismissed_until';
  const USER_KEY = 'scrollpay_user_id';
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
  const IMPRESSION_DELAY_MS = 2000; // 2 seconds visible = impression

  let currentAd = null;
  let impressionTimer = null;
  let impressionRecorded = false;
  let currentImpressionId = null;
  let userId = null;

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

  // --- Dismiss logic ---
  async function isDismissed() {
    const result = await chrome.storage.local.get([DISMISS_KEY]);
    const dismissedUntil = result[DISMISS_KEY] || 0;
    return Date.now() < dismissedUntil;
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

    widget.innerHTML = `
      <div id="sp-drag-handle" aria-label="Drag to move">
        <span class="sp-drag-dots">⠿⠿⠿</span>
        <span class="sp-brand">SCROLLPAY</span>
        <span class="sp-status"><span class="sp-dot"></span> earning</span>
      </div>
      <div id="sp-ad-area">
        <div class="sp-ad-content">
          ${ad.brandLogo ? `<img class="sp-brand-logo" src="${escapeHtml(ad.brandLogo)}" alt="${escapeHtml(ad.brandName)}" />` : `<div class="sp-brand-initial">${escapeHtml(ad.brandName[0])}</div>`}
          <div class="sp-ad-text">
            <div class="sp-ad-headline">${escapeHtml(ad.headline)}</div>
            <button class="sp-cta-btn" id="sp-cta-btn">${escapeHtml(ad.ctaText)}</button>
          </div>
        </div>
      </div>
      <div id="sp-footer">
        <span class="sp-earnings" id="sp-earnings-label">🎟️ <span id="sp-sats-count">0</span> XP earned</span>
        <button class="sp-close-btn" id="sp-close-btn" aria-label="Close widget">✕</button>
      </div>
      <div id="sp-progress-bar">
        <div id="sp-progress-fill"></div>
      </div>
    `;

    return widget;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Impression tracking ---
  function startImpressionTimer() {
    if (impressionRecorded || impressionTimer) return;

    const fill = document.getElementById('sp-progress-fill');
    if (fill) {
      fill.style.transition = `width ${IMPRESSION_DELAY_MS}ms linear`;
      // Force reflow before applying transition
      fill.getBoundingClientRect();
      fill.style.width = '100%';
    }

    impressionTimer = setTimeout(async () => {
      if (impressionRecorded) return;
      impressionRecorded = true;

      const uid = await getUserId();
      if (!uid || !currentAd) return;

      const response = await sendToBackground({
        type: 'RECORD_IMPRESSION',
        userId: uid,
        adId: currentAd.id,
        domain: getDomain(),
        duration: IMPRESSION_DELAY_MS
      });

      if (response.success) {
        currentImpressionId = response.impressionId;
        updateSatsDisplay(currentAd.pointsPerImpression || 5);
      }
    }, IMPRESSION_DELAY_MS);
  }

  function stopImpressionTimer() {
    if (impressionTimer) {
      clearTimeout(impressionTimer);
      impressionTimer = null;
    }
    const fill = document.getElementById('sp-progress-fill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }
  }

  function updateSatsDisplay(amount) {
    const el = document.getElementById('sp-sats-count');
    if (el) {
      const current = parseInt(el.textContent || '0', 10);
      el.textContent = current + amount;
    }
  }

  // --- Visibility tracking ---
  let visibilityObserver = null;

  function setupVisibilityObserver(widget) {
    visibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          startImpressionTimer();
        } else {
          stopImpressionTimer();
        }
      });
    }, { threshold: 0.5 });

    visibilityObserver.observe(widget);
  }

  // --- Dragging ---
  function makeDraggable(widget) {
    const handle = document.getElementById('sp-drag-handle');
    if (!handle) return;

    let dragging = false;
    let startX, startY, startRight, startBottom;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = widget.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startBottom = window.innerHeight - rect.bottom;

      widget.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newRight = startRight - dx;
      let newBottom = startBottom - dy;

      // Clamp to viewport
      newRight = Math.max(0, Math.min(newRight, window.innerWidth - widget.offsetWidth));
      newBottom = Math.max(0, Math.min(newBottom, window.innerHeight - widget.offsetHeight));

      widget.style.right = newRight + 'px';
      widget.style.bottom = newBottom + 'px';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  // --- Dismiss ---
  async function dismissWidget() {
    const widget = document.getElementById(WIDGET_ID);
    if (widget) {
      widget.classList.add('sp-hiding');
      stopImpressionTimer();
      if (visibilityObserver) {
        visibilityObserver.disconnect();
        visibilityObserver = null;
      }
      setTimeout(() => widget.remove(), 400);
    }
    await setDismissed();
  }

  // --- CTA click ---
  async function handleCtaClick() {
    if (!currentAd) return;
    const uid = await getUserId();

    if (uid) {
      await sendToBackground({
        type: 'RECORD_CLICK',
        userId: uid,
        adId: currentAd.id,
        impressionId: currentImpressionId
      });
      updateSatsDisplay(25);
    }

    window.open(currentAd.ctaUrl, '_blank', 'noopener,noreferrer');
  }

  // --- Init ---
  async function init() {
    // Don't inject twice
    if (document.getElementById(WIDGET_ID)) return;

    // Check dismiss cooldown
    if (await isDismissed()) return;

    // Get user ID
    const uid = await getUserId();
    if (!uid) return; // Not onboarded yet

    // Fetch ad
    const response = await sendToBackground({
      type: 'GET_AD',
      domain: getDomain()
    });

    if (!response || !response.ad) return;
    currentAd = response.ad;

    // Create widget
    const widget = createWidget(currentAd);
    document.body.appendChild(widget);

    // Wire up events
    const closeBtn = document.getElementById('sp-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', dismissWidget);

    const ctaBtn = document.getElementById('sp-cta-btn');
    if (ctaBtn) ctaBtn.addEventListener('click', handleCtaClick);

    makeDraggable(widget);
    setupVisibilityObserver(widget);

    // Slide in
    requestAnimationFrame(() => {
      widget.classList.add('sp-visible');
    });
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
