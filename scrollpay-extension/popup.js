// ScrollPay Popup Script

const USER_KEY = 'scrollpay_user_id';
const IMPRESSIONS_KEY = 'scrollpay_recent_impressions';

// Cached refCode so the send-button handler can access it without re-fetching
let _cachedRefCode = null;

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
    loadLeaderboard(null);
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

    // Cache refCode and load support messages
    _cachedRefCode = data.refCode || null;
    loadMessages(_cachedRefCode);

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

  // Leaderboard (fire after user data loads so we can highlight the user's row)
  loadLeaderboard(data.nickname || null);
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

// Leaderboard
const POPUP_MEDALS = ['🥇', '🥈', '🥉'];

async function loadLeaderboard(myHandle) {
  const list = document.getElementById('leaderboard-list');
  try {
    const res = await fetch('https://scrollpay.app/api/leaderboard');
    const data = await res.json();
    const leaders = (data.leaders || []).slice(0, 10);
    if (leaders.length === 0) {
      list.innerHTML = '<div class="empty-state">No miners yet!</div>';
      return;
    }
    list.innerHTML = leaders.map((l, i) => {
      const isMe = myHandle && l.handle === myHandle;
      const medal = i < 3 ? POPUP_MEDALS[i] : l.rank;
      return `<div class="lb-row${isMe ? ' lb-me' : ''}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-handle${l.hasNickname ? (isMe ? ' me' : '') : ' anon'}">${escapeHtml(l.handle)}</span>
        <span class="lb-xp">₿ ${l.xp.toLocaleString()}</span>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Could not load.</div>';
  }
}

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

// Gift XP
document.getElementById('gift-xp-btn').addEventListener('click', async () => {
  const toEl  = document.getElementById('gift-to');
  const amtEl = document.getElementById('gift-amount');
  const msgEl = document.getElementById('gift-msg');
  const btn   = document.getElementById('gift-xp-btn');

  const to     = toEl.value.trim();
  const amount = parseInt(amtEl.value, 10);

  msgEl.style.display = 'none';

  if (!to) { showGiftMsg('Enter a handle or referral code.', false); return; }
  if (!amount || amount < 10) { showGiftMsg('Minimum transfer is 10 XP.', false); return; }

  const stored = await chrome.storage.local.get([USER_KEY]);
  const userId = stored[USER_KEY];
  if (!userId) { showGiftMsg('Not logged in.', false); return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  const res = await sendToBackground({ type: 'TRANSFER_XP', userId, to, amount });

  btn.disabled = false;
  btn.textContent = 'Send XP';

  if (res.success) {
    toEl.value  = '';
    amtEl.value = '';
    showGiftMsg(`✓ Sent ${res.amount} XP to ${res.toHandle}!`, true);
    loadUserData();
  } else {
    showGiftMsg(res.error || 'Transfer failed.', false);
  }

  function showGiftMsg(text, ok) {
    msgEl.textContent = text;
    msgEl.className = 'gift-msg ' + (ok ? 'gift-msg-ok' : 'gift-msg-err');
    msgEl.style.display = 'block';
  }
});

// Share invite link
function getRefLink() {
  const linkText = document.getElementById('referral-link').textContent;
  if (!linkText || linkText === 'Loading...' || linkText === 'Complete onboarding first') {
    return 'https://scrollpay.app';
  }
  return linkText.startsWith('http') ? linkText : `https://${linkText}`;
}

document.getElementById('share-native-btn').addEventListener('click', () => {
  const url = getRefLink();
  if (navigator.share) {
    navigator.share({ title: 'ScrollPay — mine Bitcoin while you browse', text: 'Join me on ScrollPay and earn XP:', url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('share-native-btn');
      btn.textContent = '✓ Link copied!';
      setTimeout(() => { btn.textContent = '↑ Share invite link'; }, 2000);
    }).catch(() => {});
  }
});

document.getElementById('share-copy-btn').addEventListener('click', () => {
  const url = getRefLink();
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('share-copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {});
});

// ── Inbox / Support Messages ──────────────────────────────────
const MSG_API = 'https://scrollpay.app/api/inbox';

async function loadMessages(refCode) {
  const section = document.getElementById('messages-section');
  const list = document.getElementById('msg-list');
  if (!refCode) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  try {
    const res = await fetch(`${MSG_API}?refCode=${encodeURIComponent(refCode)}`);
    const data = await res.json();
    const msgs = data.messages || [];
    if (!msgs.length) {
      list.innerHTML = '<div class="msg-empty">No messages yet — ask us anything!</div>';
      return;
    }
    list.innerHTML = msgs.map(m => {
      const cls = m.from === 'admin' ? 'from-admin' : 'from-user';
      const who = m.from === 'admin' ? 'ScrollPay' : 'You';
      const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      return `<div>
        <div class="msg-bubble ${cls}">${escMsg(m.text)}</div>
        <div class="msg-time" style="text-align:${m.from==='admin'?'right':'left'}">${who} · ${time}</div>
      </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  } catch (_) {}
}

function escMsg(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.getElementById('msg-send-btn').addEventListener('click', async () => {
  const refCode = _cachedRefCode;
  const input = document.getElementById('msg-input');
  const status = document.getElementById('msg-status');
  const text = input.value.trim();
  if (!refCode || !text) return;
  const btn = document.getElementById('msg-send-btn');
  btn.disabled = true;
  try {
    const res = await fetch(MSG_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refCode, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    input.value = '';
    status.textContent = '✓ Sent!';
    status.className = 'msg-status ok';
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
    await loadMessages(refCode);
  } catch (err) {
    status.textContent = err.message;
    status.className = 'msg-status err';
    status.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

// Init
loadUserData();
