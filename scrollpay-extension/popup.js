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
  const result = await chrome.storage.local.get([USER_KEY, IMPRESSIONS_KEY, LINKED_EMAIL_KEY]);
  const userId       = result[USER_KEY];
  const linkedEmail  = result[LINKED_EMAIL_KEY];
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
  loadReceived(userId);

  if (data) {
    const totalXp = data.totalSats || 0;
    document.getElementById('total-xp').textContent = totalXp.toLocaleString();
    document.getElementById('xp-today').textContent = (data.satsToday || 0).toLocaleString();
    document.getElementById('impressions-today').textContent = (data.impressionsToday || 0).toLocaleString();

    // Every XP = one entry in the next draw.
    document.getElementById('draw-entries').textContent = totalXp.toLocaleString();

    // XP wallet breakdown (mined / listed / available)
    fetch(`https://scrollpay.app/api/xp-balance?userId=${encodeURIComponent(userId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(w => {
        if (!w) return;
        document.getElementById('wallet-mined').textContent     = (w.minedXp    || 0).toLocaleString() + ' XP';
        document.getElementById('wallet-listed').textContent    = (w.listedXp   || 0).toLocaleString() + ' XP';
        document.getElementById('wallet-available').textContent = (w.availableXp || 0).toLocaleString() + ' XP';
        document.getElementById('wallet-breakdown').style.display = 'block';
      })
      .catch(() => {});

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

  // Nickname display / force-handle nudge
  if (data.nickname) {
    document.getElementById('nickname-value').textContent = data.nickname;
    document.getElementById('nickname-display').style.display = 'block';
    document.getElementById('nickname-set-form').style.display = 'none';
    document.getElementById('handle-nudge').style.display = 'none';
  } else {
    // Highlight handle input and show nudge
    document.getElementById('handle-nudge').style.display = 'block';
    const nicknameInput = document.getElementById('nickname-input');
    if (nicknameInput) {
      nicknameInput.style.borderColor = '#f97316';
      nicknameInput.style.boxShadow = '0 0 0 2px #fed7aa';
    }
  }

  // Load recent ads from local storage
  renderRecentAds(recentImpressions);

  // Leaderboard (fire after user data loads so we can highlight the user's row)
  loadLeaderboard(data.nickname || null);

  // Profile section — only show if user has set a handle
  if (data.nickname) loadProfile(userId, data.nickname);
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
let _lbMyHandle = '';
let _lbDaily = true;

async function loadLeaderboard(myHandle, daily) {
  if (myHandle !== undefined) _lbMyHandle = myHandle;
  if (daily !== undefined) _lbDaily = daily;
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const url = _lbDaily
      ? 'https://scrollpay.app/api/leaderboard?daily=1'
      : 'https://scrollpay.app/api/leaderboard';
    const res = await fetch(url);
    const data = await res.json();
    const leaders = data.leaders || [];
    if (leaders.length === 0) {
      list.innerHTML = _lbDaily
        ? '<div class="empty-state">No mining activity in the last 24h.</div>'
        : '<div class="empty-state">No miners yet!</div>';
      return;
    }
    const myIdx = _lbMyHandle ? leaders.findIndex(l => l.handle === _lbMyHandle) : -1;
    const rows = leaders.map((l, i) => {
      const isMe = _lbMyHandle && l.handle === _lbMyHandle;
      const medal = i < 3 ? POPUP_MEDALS[i] : l.rank;
      const handleEl = l.hasNickname
        ? `<a href="https://scrollpay.app/profile/${encodeURIComponent(l.handle)}" target="_blank" class="lb-handle${isMe ? ' me' : ''}" style="text-decoration:none;color:inherit;">${escapeHtml(l.handle)}</a>`
        : `<span class="lb-handle anon">${escapeHtml(l.handle)}</span>`;
      return `<div class="lb-row${isMe ? ' lb-me' : ''}">
        <span class="lb-rank">${medal}</span>
        ${handleEl}
        <span class="lb-xp">₿ ${l.xp.toLocaleString()}</span>
      </div>`;
    });
    // If user is outside top 20, append a separator + their row
    if (myIdx === -1 && _lbMyHandle) {
      rows.push(`<div class="lb-row lb-me" style="margin-top:4px;border-top:1px dashed #f3f4f6;">
        <span class="lb-rank">—</span>
        <span class="lb-handle me">${escapeHtml(_lbMyHandle)}</span>
        <span class="lb-xp" style="color:#9ca3af">not ranked yet</span>
      </div>`);
    }
    list.innerHTML = rows.join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Could not load.</div>';
  }
}


document.getElementById('lb-tab-today').addEventListener('click', () => {
  document.getElementById('lb-tab-today').classList.add('active');
  document.getElementById('lb-tab-alltime').classList.remove('active');
  loadLeaderboard(undefined, true);
});

document.getElementById('lb-tab-alltime').addEventListener('click', () => {
  document.getElementById('lb-tab-alltime').classList.add('active');
  document.getElementById('lb-tab-today').classList.remove('active');
  loadLeaderboard(undefined, false);
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
    const isTaken = (res.error || '').includes('already taken');
    errEl.textContent = isTaken
      ? 'Handle already taken. If this is your handle from scrollpay.app, sign in below using your website email & password to recover it.'
      : (res.error || 'Could not set handle.');
    errEl.style.display = 'block';
  }
});

// Gift XP
document.getElementById('gift-xp-btn').addEventListener('click', async () => {
  const toEl   = document.getElementById('gift-to');
  const amtEl  = document.getElementById('gift-amount');
  const noteEl = document.getElementById('gift-note');
  const msgEl  = document.getElementById('gift-msg');
  const btn    = document.getElementById('gift-xp-btn');

  const to     = toEl.value.trim();
  const amount = parseInt(amtEl.value, 10);
  const note   = noteEl.value.trim();

  msgEl.style.display = 'none';

  if (!to) { showGiftMsg('Enter a handle or referral code.', false); return; }
  if (!amount || amount < 10) { showGiftMsg('Minimum transfer is 10 XP.', false); return; }

  const stored = await chrome.storage.local.get([USER_KEY]);
  const userId = stored[USER_KEY];
  if (!userId) { showGiftMsg('Not logged in.', false); return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';

  const res = await sendToBackground({ type: 'TRANSFER_XP', userId, to, amount, note });

  btn.disabled = false;
  btn.textContent = 'Send XP';

  if (res.success) {
    toEl.value   = '';
    amtEl.value  = '';
    noteEl.value = '';
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

// Load received XP transfers (with messages)
async function loadReceived(userId) {
  const section = document.getElementById('received-section');
  const list = document.getElementById('received-list');
  const res = await sendToBackground({ type: 'GET_TRANSFERS', userId });
  const transfers = res.transfers || [];
  if (!transfers.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = transfers.slice(0, 5).map(t => {
    const from = escapeHtml(t.fromHandle || 'Someone');
    const note = t.note ? `<div class="received-note">${escapeHtml(t.note)}</div>` : '';
    const time = t.createdAt ? new Date(t.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    return `<div class="received-item">
      <div class="received-top">
        <span class="received-from">${from}</span>
        <span class="received-xp">+${t.amount} XP</span>
      </div>
      ${note}
      ${time ? `<div class="received-time">${time}</div>` : ''}
    </div>`;
  }).join('');
}

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

// ── Link Website Account ─────────────────────────────────────

const FB_API_KEY = 'AIzaSyCeJ0Egs5CZjzRDXCMoEL54GbvRR-14Z14';
const LINKED_EMAIL_KEY = 'scrollpay_linked_email';

async function firebaseSignIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message;
    if (msg === 'INVALID_LOGIN_CREDENTIALS' || msg === 'EMAIL_NOT_FOUND' || msg === 'INVALID_PASSWORD') {
      throw new Error('Incorrect email or password.');
    }
    throw new Error(msg);
  }
  return { uid: data.localId, email: data.email };
}

async function firebaseSendPasswordReset(email) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
}

async function loadLinkAccountSection() {
  const result = await chrome.storage.local.get([LINKED_EMAIL_KEY]);
  const linkedEmail = result[LINKED_EMAIL_KEY];
  if (linkedEmail) {
    document.getElementById('linked-account-view').style.display = 'block';
    document.getElementById('link-account-form').style.display = 'none';
    document.getElementById('linked-email-display').textContent = '✓ ' + linkedEmail;
  }
}

document.getElementById('btn-link-account').addEventListener('click', async () => {
  const email = document.getElementById('link-email').value.trim();
  const password = document.getElementById('link-password').value;
  const statusEl = document.getElementById('link-status');
  const btn = document.getElementById('btn-link-account');

  if (!email || !password) {
    statusEl.textContent = 'Please enter your email and password.';
    statusEl.style.color = '#dc2626';
    statusEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting…';
  statusEl.style.display = 'none';

  try {
    const stored = await chrome.storage.local.get([USER_KEY]);
    const oldUid = stored[USER_KEY] || null;

    const { uid, email: confirmedEmail } = await firebaseSignIn(email, password);

    // If the extension was using an anonymous/different UID, migrate handle + XP
    if (oldUid && oldUid !== uid) {
      statusEl.textContent = 'Syncing your account…';
      statusEl.style.color = '#f7931a';
      statusEl.style.display = 'block';
      await sendToBackground({ type: 'RECONCILE_PROFILES', oldUid, newUid: uid });
    }

    await chrome.storage.local.set({ [USER_KEY]: uid, [LINKED_EMAIL_KEY]: confirmedEmail });
    statusEl.textContent = '✓ Connected! Reloading…';
    statusEl.style.color = '#16a34a';
    statusEl.style.display = 'block';
    setTimeout(() => window.location.reload(), 1000);
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.style.color = '#dc2626';
    statusEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign in & Connect';
  }
});

document.getElementById('btn-forgot-pw').addEventListener('click', async () => {
  const email = document.getElementById('link-email').value.trim();
  const statusEl = document.getElementById('link-status');
  if (!email) {
    statusEl.textContent = 'Enter your email above first.';
    statusEl.style.color = '#d97706';
    statusEl.style.display = 'block';
    return;
  }
  try {
    await firebaseSendPasswordReset(email);
    statusEl.textContent = '✓ Reset email sent — check your inbox.';
    statusEl.style.color = '#16a34a';
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.style.color = '#dc2626';
  }
  statusEl.style.display = 'block';
});

document.getElementById('btn-unlink').addEventListener('click', async () => {
  await chrome.storage.local.remove([LINKED_EMAIL_KEY]);
  document.getElementById('linked-account-view').style.display = 'none';
  document.getElementById('link-account-form').style.display = 'block';
});

// ── Profile ──────────────────────────────────────────────────
const PROFILE_API = 'https://scrollpay.app/api/profile';

async function loadProfile(userId, handle) {
  const section = document.getElementById('profile-section');
  if (!userId || !handle) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  // Link to public profile
  const linkEl = document.getElementById('profile-public-link');
  if (linkEl) {
    linkEl.href = `https://scrollpay.app/profile/${encodeURIComponent(handle)}`;
    document.getElementById('profile-view-row').style.display = 'block';
  }

  // Fetch current profile to pre-fill fields
  try {
    const res = await fetch(`${PROFILE_API}?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) return;
    const data = await res.json();
    const p = data.profile || {};
    const bioEl = document.getElementById('profile-bio');
    if (bioEl) {
      bioEl.value = p.bio || '';
      document.getElementById('bio-chars').textContent = (p.bio || '').length;
    }
    document.getElementById('profile-twitter').value   = p.twitter   ? '@' + p.twitter   : '';
    document.getElementById('profile-instagram').value = p.instagram ? '@' + p.instagram : '';
    document.getElementById('profile-telegram').value  = p.telegram  ? '@' + p.telegram  : '';
    document.getElementById('profile-website').value   = p.website   || '';
  } catch (_) {}
}

document.getElementById('profile-bio')?.addEventListener('input', function () {
  document.getElementById('bio-chars').textContent = this.value.length;
});

document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get([USER_KEY]);
  const userId = stored[USER_KEY];
  if (!userId) return;

  const btn = document.getElementById('save-profile-btn');
  const statusEl = document.getElementById('profile-save-status');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  statusEl.style.display = 'none';

  const strip = s => s.replace(/^@/, '').trim();

  try {
    const res = await fetch(PROFILE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        bio:       document.getElementById('profile-bio').value.trim(),
        twitter:   strip(document.getElementById('profile-twitter').value),
        instagram: strip(document.getElementById('profile-instagram').value),
        telegram:  strip(document.getElementById('profile-telegram').value),
        website:   document.getElementById('profile-website').value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');
    statusEl.textContent = '✓ Profile saved!';
    statusEl.style.color = '#16a34a';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = '#dc2626';
  }
  statusEl.style.display = 'block';
  btn.disabled = false;
  btn.textContent = 'Save Profile';
});

// Init
loadUserData();
loadLinkAccountSection();
