// ScrollPay Popup Script

const USER_KEY = 'scrollpay_user_id';
const IMPRESSIONS_KEY = 'scrollpay_recent_impressions';
const PAYOUT_THRESHOLD = 1000;

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
    document.getElementById('total-sats').textContent = '0';
    document.getElementById('sats-today').textContent = '0';
    document.getElementById('impressions-today').textContent = '0';
    document.getElementById('referral-link').textContent = 'Complete onboarding first';
    return;
  }

  // Load balance from background
  const response = await sendToBackground({ type: 'GET_BALANCE', userId });
  const data = response.data;

  if (data) {
    document.getElementById('total-sats').textContent = (data.totalSats || 0).toLocaleString();
    document.getElementById('sats-today').textContent = (data.satsToday || 0).toLocaleString();
    document.getElementById('impressions-today').textContent = (data.impressionsToday || 0).toLocaleString();

    // Withdraw button
    const withdrawBtn = document.getElementById('withdraw-btn');
    if (data.totalSats >= PAYOUT_THRESHOLD) {
      withdrawBtn.disabled = false;
    }

    // Lightning address
    if (data.lightningAddress) {
      document.getElementById('lightning-input').value = data.lightningAddress;
    }

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
      <span class="recent-ad-sats">+${imp.satsAwarded || 5} sats</span>
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

// Save lightning address
document.getElementById('save-lightning-btn').addEventListener('click', async () => {
  const input = document.getElementById('lightning-input');
  const address = input.value.trim();
  if (!address) return;

  const result = await chrome.storage.local.get([USER_KEY]);
  const userId = result[USER_KEY];
  if (!userId) return;

  const btn = document.getElementById('save-lightning-btn');
  btn.textContent = 'Saving...';

  const response = await sendToBackground({
    type: 'UPDATE_LIGHTNING',
    userId,
    lightningAddress: address
  });

  btn.textContent = response.success ? 'Saved ✓' : 'Error';
  setTimeout(() => { btn.textContent = 'Save'; }, 2000);
});

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

// Withdraw button
document.getElementById('withdraw-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://scrollpay.app/withdraw' });
});

// Init
loadUserData();
