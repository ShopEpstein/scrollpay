// ScrollPay Popup Script

const USER_KEY = 'scrollpay_user_id';
const IMPRESSIONS_KEY = 'scrollpay_recent_impressions';

// XP is stored internally under the legacy `totalSats`/`satsToday` fields.
// 1 XP = 1 entry in the prize draw.

function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false });
        } else {
          resolve(response || { success: false });
        }
      });
    } catch (e) {
      resolve({ success: false });
    }
  });
}

async function loadUserData() {
  const result = await chrome.storage.local.get([USER_KEY, IMPRESSIONS_KEY]);
  const userId = result[USER_KEY];
  const recentImpressions = result[IMPRESSIONS_KEY] || [];

  if (!userId) {
    document.getElementById('total-xp').textContent = '0';
    document.getElementById('xp-today').textContent = '0';
    document.getElementById('impressions-today').textContent = '0';
    document.getElementById('draw-entries').textContent = '0';
    document.getElementById('referral-link').textContent = 'Complete onboarding first';
    return;
  }

  // Load balance from background
  const response = await sendToBackground({ type: 'GET_BALANCE', userId });
  const data = response.data;

  if (data) {
    const totalXp = data.totalSats || 0;
    document.getElementById('total-xp').textContent = totalXp.toLocaleString();
    document.getElementById('xp-today').textContent = (data.satsToday || 0).toLocaleString();
    document.getElementById('impressions-today').textContent = (data.impressionsToday || 0).toLocaleString();

    // Every XP = one entry in the next draw.
    document.getElementById('draw-entries').textContent = totalXp.toLocaleString();

    // Referral link
    if (data.refCode) {
      document.getElementById('referral-link').textContent = `scrollpay.app/r/${data.refCode}`;
    }

    // Downline stats
    document.getElementById('referral-count').textContent = (data.referralCount || 0).toLocaleString();
    document.getElementById('downline-size').textContent = (data.downlineSize || 0).toLocaleString();
    document.getElementById('downline-xp').textContent = (data.downlineXp || 0).toLocaleString();

    // Early adopter badge + referral note
    const signupNumber = data.signupNumber || 999999;
    const isEarlyAdopter = signupNumber <= 500;
    const badge = document.getElementById('early-adopter-badge');
    if (isEarlyAdopter) {
      badge.style.display = 'block';
      badge.textContent = signupNumber <= 100
        ? `⚡ Founding Member #${signupNumber} — 1.5× referral XP`
        : `⚡ Early Adopter #${signupNumber} — 1.5× referral XP`;
    }

    const noteEl = document.getElementById('referral-note');
    if (isEarlyAdopter) {
      noteEl.textContent = 'Mine 150 XP per direct recruit (+L2: 38 XP, +L3: 15 XP) — early adopter bonus active';
    } else {
      noteEl.textContent = 'Mine 100 XP per direct recruit (+L2: 25 XP, +L3: 10 XP)';
    }
  }

  // Nickname display
  if (data.nickname) {
    document.getElementById('nickname-value').textContent = data.nickname;
    document.getElementById('nickname-display').style.display = 'block';
    document.getElementById('nickname-set-form').style.display = 'none';
  }

  // Load recent ads from local storage
  renderRecentAds(recentImpressions);
}

function renderRecentAds(impressions) {
  const list = document.getElementById('recent-ads-list');
  if (!impressions || impressions.length === 0) {
    list.innerHTML = '<div class="empty-state">No ads seen yet — start browsing!</div>';
    return;
  }

  const last5 = impressions.slice(-5).reverse();
  list.innerHTML = last5.map(imp => `
    <div class="recent-ad-item">
      <span class="recent-ad-name">${escapeHtml(imp.brandName || 'Ad')}</span>
      <span class="recent-ad-sats">+${imp.satsAwarded || 5} XP</span>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Copy referral link
document.getElementById('copy-ref-btn').addEventListener('click', async () => {
  const linkText = document.getElementById('referral-link').textContent;
  if (!linkText || linkText === 'Loading...' || linkText === 'Complete onboarding first') return;

  try {
    await navigator.clipboard.writeText(linkText);
    const btn = document.getElementById('copy-ref-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  } catch (e) {
    console.error('Copy failed:', e);
  }
});

// Sell XP button — opens market page pre-filled with refCode
document.getElementById('sell-xp-btn').addEventListener('click', async () => {
  const result = await chrome.storage.local.get([USER_KEY]);
  const userId = result[USER_KEY];
  let url = 'https://scrollpay.app/market';
  if (userId) {
    const res = await sendToBackground({ type: 'GET_BALANCE', userId });
    if (res?.data?.refCode) url += '?ref=' + encodeURIComponent(res.data.refCode);
  }
  chrome.tabs.create({ url });
});

// Nickname save
document.getElementById('nickname-save-btn').addEventListener('click', async () => {
  const input = document.getElementById('nickname-input');
  const errEl = document.getElementById('nickname-error');
  const btn = document.getElementById('nickname-save-btn');
  const nickname = input.value.trim().toLowerCase();

  errEl.style.display = 'none';
  if (!/^[a-z0-9_]{3,20}$/.test(nickname)) {
    errEl.textContent = 'Lowercase letters, numbers, underscores only (3–20 chars).';
    errEl.style.display = 'block';
    return;
  }

  const result = await chrome.storage.local.get([USER_KEY]);
  const userId = result[USER_KEY];
  if (!userId) return;

  btn.disabled = true;
  btn.textContent = '…';
  const res = await sendToBackground({ type: 'SET_NICKNAME', userId, nickname });
  btn.disabled = false;
  btn.textContent = 'Set';

  if (res.success) {
    document.getElementById('nickname-value').textContent = nickname;
    document.getElementById('nickname-display').style.display = 'block';
    document.getElementById('nickname-set-form').style.display = 'none';
  } else {
    errEl.textContent = res.error || 'Could not set handle.';
    errEl.style.display = 'block';
  }
});

// Init
loadUserData();
