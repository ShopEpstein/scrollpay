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

// Init
loadUserData();
