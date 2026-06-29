import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCeJ0Egs5CZjzRDXCMoEL54GbvRR-14Z14",
  authDomain: "scrollpay-1ce29.firebaseapp.com",
  projectId: "scrollpay-1ce29",
  storageBucket: "scrollpay-1ce29.firebasestorage.app",
  messagingSenderId: "710989126022",
  appId: "1:710989126022:web:50324119c803af284f7407"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_EMAIL = 'contactfire757@gmail.com';
function isAdmin() { return auth.currentUser?.email === ADMIN_EMAIL; }

const CAMPAIGN_COST_XP = 50000;

// In-progress campaign data collected across steps
const draft = { brand: {}, ad: {}, budget: {} };

let advertiserXpBalance = null; // loaded lazily when wizard opens

// ── View switching ──────────────────────────────────────────────

function showView(id) {
  ['view-auth', 'view-dashboard', 'view-create'].forEach(v => {
    const el = document.getElementById(v);
    const show = v === id;
    el.style.display = show ? '' : 'none';
    el.classList.toggle('hidden', !show);
  });
  const nav = document.getElementById('main-nav');
  const showNav = id !== 'view-auth';
  nav.style.display = showNav ? '' : 'none';
  nav.classList.toggle('hidden', !showNav);
}

// ── Auth ────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  if (user) {
    const isAdminUser = user.email === ADMIN_EMAIL;
    document.getElementById('nav-email').textContent =
      user.email + (isAdminUser ? ' ⚡ Admin' : '');
    showView('view-dashboard');
    if (isAdminUser) {
      document.getElementById('admin-tab-nav').style.display = 'block';
      document.getElementById('advertiser-panel').style.display = 'none';
      switchAdminTab('inbox');
      loadStats(); loadXpMarket(); loadFulfilledListings(); loadInbox(); loadPartners(); loadMiners(); loadSweepOrders(); loadRaffleEntries();
    } else {
      loadCampaigns();
    }
  } else {
    showView('view-auth');
  }
});

// ── Theme switcher ──────────────────────────────────────────────

const THEMES = {
  default:   { label: 'Default', emoji: '☀️' },
  dark:      { label: 'Dark',    emoji: '🌙' },
  matrix:    { label: 'Matrix',  emoji: '🟩' },
  stacverse: { label: 'Stacverse', emoji: '🪐' },
};

function applyTheme(name) {
  const t = THEMES[name] || THEMES.default;
  document.documentElement.setAttribute('data-theme', name === 'default' ? '' : name);
  localStorage.setItem('sp_theme', name);
  const btn = document.getElementById('theme-toggle-btn');
  const label = document.getElementById('theme-label');
  if (btn) btn.firstChild.textContent = t.emoji + ' ';
  if (label) label.textContent = t.label;
  document.querySelectorAll('.theme-opt').forEach(o => {
    o.classList.toggle('active', o.dataset.theme === name);
  });
}

(function initTheme() {
  const saved = localStorage.getItem('sp_theme') || 'default';
  applyTheme(saved);
})();

document.getElementById('theme-toggle-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('theme-dropdown').classList.toggle('open');
});

document.getElementById('theme-dropdown')?.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.theme);
    document.getElementById('theme-dropdown').classList.remove('open');
  });
});

document.addEventListener('click', () => {
  document.getElementById('theme-dropdown')?.classList.remove('open');
});

// ── Auth ─────────────────────────────────────────────────────────

let authMode = 'login';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    authMode = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('auth-submit').textContent =
      authMode === 'login' ? 'Sign in' : 'Create account';
    hide('auth-error');
  });
});

document.getElementById('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const btn = document.getElementById('auth-submit');

  btn.disabled = true;
  btn.textContent = 'Please wait…';
  hide('auth-error');

  try {
    if (authMode === 'login') {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    showError('auth-error', friendlyAuthError(err.code));
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  }
});

document.getElementById('signout-btn').addEventListener('click', () => signOut(auth));

// ── Admin tabs ───────────────────────────────────────────────────

const ADMIN_TAB_MAP = {
  inbox:     { show: ['inbox-section'] },
  stats:     { show: ['stats-section'] },
  miners:    { show: ['miners-section'] },
  market:    { show: ['xp-market-section', 'fulfilled-section'] },
  campaigns: { show: ['advertiser-panel'] },
  partners:  { show: ['partners-section'] },
  sweep:     { show: ['sweep-section'] },
  raffle:    { show: ['raffle-section'] },
  audit:     { show: ['audit-section'] },
  payouts:   { show: ['payouts-section'] },
  broadcast: { show: ['broadcast-section'] },
  fraud:     { show: ['fraud-section'] },
};
const ALL_ADMIN_SECTIONS = ['stats-section', 'xp-market-section', 'fulfilled-section',
  'inbox-section', 'partners-section', 'miners-section', 'sweep-section', 'raffle-section',
  'payouts-section', 'broadcast-section', 'fraud-section', 'advertiser-panel'];

function switchAdminTab(tabName) {
  ALL_ADMIN_SECTIONS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const tab = ADMIN_TAB_MAP[tabName];
  if (tab) {
    tab.show.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
  }
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  // Load campaigns if switching to that tab and not yet loaded
  if (tabName === 'campaigns' && !campaignsLoaded) { loadCampaigns(); campaignsLoaded = true; }
  // Auto-load payout report when tab is opened
  if (tabName === 'payouts') { loadPayoutReport(); }
  // Auto-load fraud dashboard when tab is opened
  if (tabName === 'fraud') { loadFraud(); }
}
let campaignsLoaded = false;

document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
});

function friendlyAuthError(code) {
  return ({
    'auth/user-not-found':        'No account found with that email.',
    'auth/wrong-password':        'Incorrect password.',
    'auth/invalid-credential':    'Invalid email or password.',
    'auth/email-already-in-use':  'An account with that email already exists.',
    'auth/weak-password':         'Password must be at least 6 characters.',
    'auth/invalid-email':         'Please enter a valid email address.',
    'auth/too-many-requests':     'Too many attempts — try again later.',
    'auth/operation-not-allowed': 'Email sign-in is not enabled yet. Enable it in the Firebase console → Authentication → Sign-in method.',
  })[code] || `Sign-in failed (${code}). Please try again.`;
}

// ── Dashboard ───────────────────────────────────────────────────

async function loadCampaigns() {
  const container = document.getElementById('campaigns-container');
  container.innerHTML = '<div class="loading">Loading campaigns…</div>';

  try {
    let rows = [];
    const adminMode = isAdmin();

    if (adminMode) {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin-campaigns', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      rows = data.campaigns || [];
    } else {
      const snap = await getDocs(query(
        collection(db, 'sp_ads'),
        where('ownerId', '==', auth.currentUser.uid)
      ));
      snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    }

    if (rows.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📢</div>
          <h3>No campaigns yet</h3>
          <p>Launch your first campaign and start reaching users as they browse.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="campaigns-table">
        <thead>
          <tr>
            <th>Campaign</th>
            ${adminMode ? '<th>Owner</th>' : ''}
            <th>Impressions</th>
            <th>Clicks</th>
            <th>CTR</th>
            <th>Budget used</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows.map(c => campaignRow(c, adminMode)).join('')}</tbody>
      </table>`;

    container.querySelectorAll('.toggle-btn:not(.edit-btn):not(.approve-btn):not(.reject-btn)').forEach(btn => {
      btn.addEventListener('click', () =>
        toggleCampaign(btn.dataset.id, btn.dataset.active === 'true')
      );
    });
    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id, rows));
    });
    container.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', () => approveCampaign(btn.dataset.id));
    });
    container.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', () => rejectCampaign(btn.dataset.id));
    });
    container.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Cancel this campaign? It will stop serving immediately.')) {
          cancelCampaign(btn.dataset.id);
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="err-msg" style="padding:20px">Failed to load: ${esc(err.message)}</div>`;
  }
}

function campaignStatusCell(c, adminMode) {
  const status = c.status || (c.active ? 'approved' : 'pending');

  if (status === 'pending') {
    if (adminMode) {
      return `
        <span class="camp-status pending">⏳ Pending</span>
        <div style="margin-top:6px;display:flex;gap:5px">
          <button class="approve-btn" data-id="${c.id}" style="padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✓ Approve</button>
          <button class="reject-btn" data-id="${c.id}" style="padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✗ Reject</button>
          <button class="toggle-btn paused edit-btn" data-id="${c.id}" style="padding:4px 10px;font-size:11px">✏️</button>
        </div>`;
    }
    return `<span class="camp-status pending">⏳ Pending review</span>`;
  }

  if (status === 'rejected') {
    const reason = c.rejectionReason ? ` — ${esc(c.rejectionReason)}` : '';
    if (adminMode) {
      return `
        <span class="camp-status rejected">✗ Rejected</span>
        ${reason ? `<div style="font-size:11px;color:#6b7280;margin-top:3px">${reason}</div>` : ''}
        <div style="margin-top:6px">
          <button class="approve-btn" data-id="${c.id}" style="padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✓ Approve</button>
          <button class="toggle-btn paused edit-btn" data-id="${c.id}" style="padding:4px 6px;font-size:11px;margin-left:4px">✏️</button>
        </div>`;
    }
    return `<span class="camp-status rejected">✗ Rejected${reason}</span>`;
  }

  if (status === 'cancelled') {
    if (adminMode) {
      return `
        <span class="camp-status rejected">✗ Cancelled</span>
        <div style="margin-top:6px">
          <button class="approve-btn" data-id="${c.id}" style="padding:4px 10px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">↩ Restore</button>
        </div>`;
    }
    return `<span class="camp-status rejected">✗ Cancelled</span>`;
  }

  // approved — show live/pause toggle + admin quick actions
  return `
    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
      <button class="toggle-btn ${c.active ? 'live' : 'paused'}"
              data-id="${c.id}" data-active="${!!c.active}">
        ${c.active ? '● Live' : '○ Paused'}
      </button>
      ${adminMode ? `
        <button class="toggle-btn paused edit-btn" data-id="${c.id}" title="Edit" style="padding:4px 8px;font-size:11px;">✏️</button>
        <button class="cancel-btn" data-id="${c.id}" title="Cancel campaign" style="padding:4px 8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">✗ Cancel</button>
      ` : ''}
    </div>`;
}

function campaignRow(c, adminMode = false) {
  const imp = c.impressions || 0;
  const clk = c.clicks || 0;
  const ctr = imp > 0 ? ((clk / imp) * 100).toFixed(1) + '%' : '—';
  const used = c.budgetUsed || 0;
  const total = c.totalBudgetXp || 0;
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return `
    <tr>
      <td>
        <div class="camp-name">${esc(c.brandName)}</div>
        <div class="camp-headline">${esc(c.headline)}</div>
      </td>
      ${adminMode ? `<td><div class="camp-owner" style="font-size:12px;color:#6b7280">${esc(c.ownerEmail || c.ownerId || '—')}</div></td>` : ''}
      <td>${imp.toLocaleString()}</td>
      <td>${clk.toLocaleString()}</td>
      <td>${ctr}</td>
      <td>
        <div class="budget-bar-wrap">
          <div class="budget-bar"><div class="budget-fill" style="width:${pct}%"></div></div>
          <div class="budget-text">${used.toLocaleString()} / ${total.toLocaleString()} XP</div>
        </div>
      </td>
      <td style="white-space:nowrap">${campaignStatusCell(c, adminMode)}</td>
    </tr>`;
}

async function toggleCampaign(adId, currentlyActive) {
  try {
    const token = await auth.currentUser.getIdToken();
    const [endpoint, method] = isAdmin()
      ? ['/api/admin-campaigns', 'PATCH']
      : ['/api/toggle-campaign', 'POST'];
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ adId, active: !currentlyActive }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }
    loadCampaigns();
  } catch (err) {
    alert('Failed to update campaign: ' + err.message);
  }
}

async function cancelCampaign(adId) {
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ adId, action: 'cancel' }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }
    loadCampaigns();
  } catch (err) {
    alert('Failed to cancel campaign: ' + err.message);
  }
}

async function approveCampaign(adId) {
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ adId, action: 'approve' }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }
    loadCampaigns();
  } catch (err) {
    alert('Failed to approve campaign: ' + err.message);
  }
}

async function rejectCampaign(adId) {
  const reason = prompt('Rejection reason (optional):');
  if (reason === null) return; // cancelled
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ adId, action: 'reject', rejectionReason: reason }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }
    loadCampaigns();
  } catch (err) {
    alert('Failed to reject campaign: ' + err.message);
  }
}

document.getElementById('new-campaign-btn').addEventListener('click', async () => {
  Object.assign(draft, { brand: {}, ad: {}, budget: {} });
  ['brand-name','brand-logo','brand-website','ad-headline','ad-cta','ad-url','ad-video-url','daily-budget','total-budget']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('headline-chars').textContent = '0';
  hide('campaign-summary');
  hide('launch-error');

  // Load advertiser XP balance (skip for admin)
  advertiserXpBalance = null;
  if (!isAdmin() && auth.currentUser) {
    try {
      const snap = await getDoc(doc(db, 'sp_users', auth.currentUser.uid));
      advertiserXpBalance = snap.exists() ? (snap.data().totalSats || 0) : 0;
    } catch (_) { advertiserXpBalance = null; }
  }

  showStep(1);
  showView('view-create');
});

document.getElementById('back-to-dashboard').addEventListener('click', () => {
  showView('view-dashboard');
  if (isAdmin()) {
    switchAdminTab('campaigns');
  } else {
    loadCampaigns();
  }
});

// ── Wizard ──────────────────────────────────────────────────────

function showStep(n) {
  [1, 2, 3].forEach(i =>
    document.getElementById(`step-${i}`).classList.toggle('hidden', i !== n)
  );
  document.querySelectorAll('.wp-step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
}

// Step 1
document.getElementById('step1-next').addEventListener('click', () => {
  const name = document.getElementById('brand-name').value.trim();
  if (!name) return alert('Please enter your brand name.');
  draft.brand = {
    name,
    logo: document.getElementById('brand-logo').value.trim(),
    website: document.getElementById('brand-website').value.trim()
  };
  updatePreview();
  showStep(2);
});

// Step 2 — live preview
document.getElementById('ad-headline').addEventListener('input', function () {
  document.getElementById('headline-chars').textContent = this.value.length;
  updatePreview();
});
document.getElementById('ad-cta').addEventListener('input', updatePreview);
document.getElementById('brand-logo').addEventListener('input', updatePreview);

function updatePreview() {
  const headline = document.getElementById('ad-headline').value || 'Your headline here';
  const cta = document.getElementById('ad-cta').value || 'CTA Text';
  const logo = document.getElementById('brand-logo').value.trim() || draft.brand.logo || '';
  const name = draft.brand.name || 'B';

  document.getElementById('preview-headline').textContent = headline;
  document.getElementById('preview-cta').textContent = cta;

  const logoEl = document.getElementById('preview-logo');
  if (logo) {
    logoEl.innerHTML = `<img src="${esc(logo)}" alt="${esc(name)}" onerror="this.style.display='none'" />`;
  } else {
    logoEl.textContent = name[0].toUpperCase();
  }
}

document.getElementById('step2-back').addEventListener('click', () => showStep(1));
function parseYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function updateVideoPreview() {
  const url = document.getElementById('ad-video-url')?.value.trim() || '';
  const id = parseYouTubeId(url);
  const container = document.getElementById('preview-video-container');
  const thumb = document.getElementById('preview-video-thumb');
  if (!container || !thumb) return;
  if (id) {
    thumb.src = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
    thumb.src = '';
  }
}

document.getElementById('ad-video-url')?.addEventListener('input', updateVideoPreview);

document.getElementById('step2-next').addEventListener('click', () => {
  const headline = document.getElementById('ad-headline').value.trim();
  const ctaText = document.getElementById('ad-cta').value.trim();
  const ctaUrl = document.getElementById('ad-url').value.trim();
  const videoUrl = document.getElementById('ad-video-url')?.value.trim() || '';
  if (!headline || !ctaText || !ctaUrl) return alert('Please fill in all ad fields.');
  draft.ad = { headline, ctaText, ctaUrl, videoUrl };
  updateSummary();
  showStep(3);
});

// Step 3
document.getElementById('step3-back').addEventListener('click', () => showStep(2));

['daily-budget', 'total-budget'].forEach(id =>
  document.getElementById(id).addEventListener('input', updateSummary)
);

function updateSummary() {
  const daily = parseInt(document.getElementById('daily-budget').value) || 0;
  const total = parseInt(document.getElementById('total-budget').value) || 0;
  const box = document.getElementById('campaign-summary');
  const launchBtn = document.getElementById('launch-btn');
  box.classList.remove('hidden');

  const bal = advertiserXpBalance;
  const hasEnough = isAdmin() || bal === null || bal >= CAMPAIGN_COST_XP;
  const balLine = bal !== null
    ? `<div class="summary-row" style="color:${hasEnough ? '#16a34a' : '#dc2626'};font-weight:700">
        <span>Your XP balance</span><span>${bal.toLocaleString()} XP</span>
       </div>`
    : '';

  box.innerHTML = `
    <div class="summary-title">Campaign summary</div>
    <div class="summary-row"><span>Brand</span><span>${esc(draft.brand.name || '—')}</span></div>
    <div class="summary-row"><span>Headline</span><span>"${esc(draft.ad.headline || '—')}"</span></div>
    <div class="summary-row"><span>CTA button</span><span>${esc(draft.ad.ctaText || '—')}</span></div>
    <div class="summary-row"><span>Destination</span><span>${esc(draft.ad.ctaUrl || '—')}</span></div>
    <div class="summary-row"><span>Daily budget</span><span>${daily ? daily.toLocaleString() + ' XP / day' : '—'}</span></div>
    <div class="summary-row"><span>Total budget</span><span>${total ? total.toLocaleString() + ' XP' : '—'}</span></div>
    <div style="border-top:1px solid #e5e7eb;margin:8px 0"></div>
    <div class="summary-row" style="font-weight:700"><span>Campaign fee</span><span>${CAMPAIGN_COST_XP.toLocaleString()} XP</span></div>
    ${balLine}
    ${!hasEnough ? `<div style="color:#dc2626;font-size:12px;margin-top:4px">⚠ Insufficient XP — earn more with the ScrollPay extension.</div>` : ''}`;

  if (launchBtn) launchBtn.disabled = !hasEnough;
}

document.getElementById('launch-btn').addEventListener('click', async () => {
  const daily = parseInt(document.getElementById('daily-budget').value);
  const total = parseInt(document.getElementById('total-budget').value);
  const btn = document.getElementById('launch-btn');

  hide('launch-error');

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/create-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        brandName: draft.brand.name,
        brandLogo: draft.brand.logo || '',
        brandWebsite: draft.brand.website || '',
        headline: draft.ad.headline,
        ctaText: draft.ad.ctaText,
        ctaUrl: draft.ad.ctaUrl,
        videoUrl: draft.ad.videoUrl || '',
        dailyBudgetXp: daily || 0,
        totalBudgetXp: total || 0,
      }),
    });

    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }

    showView('view-dashboard');
    loadCampaigns();
    // Show a review-pending notice on the dashboard
    const notice = document.createElement('div');
    notice.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:16px';
    notice.textContent = '⏳ Campaign submitted! It will go live after admin review (usually within 24 hours).';
    const container = document.getElementById('campaigns-container');
    container.parentNode.insertBefore(notice, container);
    setTimeout(() => notice.remove(), 8000);
  } catch (err) {
    showError('launch-error', 'Submission failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = '🚀 Submit for Review';
  }
});

// ── Edit campaign modal (admin only) ────────────────────────────

function openEditModal(adId, rows) {
  const c = rows.find(r => r.id === adId);
  if (!c) return;
  document.getElementById('edit-ad-id').value       = adId;
  document.getElementById('edit-brand-name').value  = c.brandName || '';
  document.getElementById('edit-headline').value    = c.headline || '';
  document.getElementById('edit-cta-text').value    = c.ctaText || '';
  document.getElementById('edit-cta-url').value     = c.ctaUrl || '';
  document.getElementById('edit-video-url').value   = c.videoUrl || (c.videoId ? `https://youtu.be/${c.videoId}` : '');
  document.getElementById('edit-brand-logo').value  = c.brandLogo || '';
  document.getElementById('edit-daily-budget').value = c.dailyBudgetXp || 0;
  document.getElementById('edit-total-budget').value = c.totalBudgetXp || 0;
  hide('edit-error');
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEditModal();
});

document.getElementById('edit-save').addEventListener('click', async () => {
  const adId = document.getElementById('edit-ad-id').value;
  const btn  = document.getElementById('edit-save');
  hide('edit-error');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        adId,
        brandName:    document.getElementById('edit-brand-name').value.trim(),
        headline:     document.getElementById('edit-headline').value.trim(),
        ctaText:      document.getElementById('edit-cta-text').value.trim(),
        ctaUrl:       document.getElementById('edit-cta-url').value.trim(),
        videoUrl:     document.getElementById('edit-video-url').value.trim(),
        brandLogo:    document.getElementById('edit-brand-logo').value.trim(),
        dailyBudgetXp: parseInt(document.getElementById('edit-daily-budget').value) || 0,
        totalBudgetXp: parseInt(document.getElementById('edit-total-budget').value) || 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeEditModal();
    loadCampaigns();
  } catch (err) {
    showError('edit-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
});

// ── Admin Stats (admin only) ────────────────────────────────────

async function loadStats() {
  ['sc-total','sc-today','sc-week','sc-xp','sc-override'].forEach(id => {
    document.getElementById(id).textContent = '…';
  });

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-stats', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load stats');

    document.getElementById('sc-total').textContent   = (data.totalUsers || 0).toLocaleString();
    document.getElementById('sc-today').textContent   = (data.activeToday || 0).toLocaleString();
    document.getElementById('sc-week').textContent    = (data.activeWeek || 0).toLocaleString();
    document.getElementById('sc-xp').textContent      = (data.totalXp || 0).toLocaleString();
    document.getElementById('sc-override').textContent = (data.totalOverrideXp || 0).toLocaleString();

    document.getElementById('recent-signups-container').innerHTML = miniTable(
      ['#', 'Email', 'Handle', 'Ref Code', 'XP', 'Impressions'],
      (data.recentSignups || []).map(u => [
        u.signupNumber,
        u.email ? `<a href="mailto:${esc(u.email)}" style="color:inherit">${esc(u.email)}</a>` : u.id.slice(0,10) + '…',
        u.nickname || '—',
        u.refCode  || '—',
        (u.totalSats || 0).toLocaleString(),
        (u.totalImpressions || 0).toLocaleString(),
      ])
    );

    document.getElementById('top-earners-container').innerHTML = miniTable(
      ['Email', 'Handle', 'Ref Code', 'XP', 'Override XP', 'Refs'],
      (data.topEarners || []).map(u => [
        u.email ? `<a href="mailto:${esc(u.email)}" style="color:inherit">${esc(u.email)}</a>` : u.id.slice(0,10) + '…',
        u.nickname || '—',
        u.refCode  || '—',
        (u.totalSats || 0).toLocaleString(),
        (u.overrideXp || 0).toLocaleString(),
        (u.referralCount || 0).toLocaleString(),
      ])
    );

    document.getElementById('top-referrers-container').innerHTML = miniTable(
      ['Email', 'Handle', 'Ref Code', 'Direct refs', 'Network size', 'Override XP earned'],
      (data.topReferrers || []).map(u => [
        u.email ? `<a href="mailto:${esc(u.email)}" style="color:inherit">${esc(u.email)}</a>` : u.id.slice(0,10) + '…',
        u.nickname || '—',
        u.refCode  || '—',
        (u.referralCount || 0).toLocaleString(),
        (u.downlineSize || 0).toLocaleString(),
        (u.overrideXp || 0).toLocaleString(),
      ])
    );
  } catch (err) {
    document.getElementById('stats-section').innerHTML +=
      `<div class="err-msg">Failed to load stats: ${esc(err.message)}</div>`;
  }
}

function miniTable(headers, rows) {
  if (rows.length === 0) return '<div style="color:#6b7280;font-size:13px;padding:12px 0;">No data yet.</div>';
  // Cells starting with '<' are treated as trusted HTML (admin-only view); others are escaped
  const cell = c => { const s = String(c); return `<td>${s.startsWith('<') ? s : esc(s)}</td>`; };
  return `
    <table class="mini-table">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function copyAddr(addr, btn) {
  navigator.clipboard.writeText(addr).then(() => {
    if (btn) { const p = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = p; }, 1500); }
  }).catch(() => prompt('Copy address:', addr));
}

document.getElementById('stats-refresh')?.addEventListener('click', loadStats);

// ── XP Marketplace (admin only) ─────────────────────────────────

let btcUsd = 0;
async function fetchBtcRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    const d = await r.json();
    btcUsd = d.bitcoin?.usd || 0;
  } catch (_) {}
}
function satsToUsdStr(sats) {
  if (!btcUsd || !sats) return '';
  const usd = sats * btcUsd / 1e8;
  return usd >= 1
    ? ' ≈ $' + usd.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : ' ≈ $' + usd.toFixed(4);
}

async function loadXpMarket() {
  const container = document.getElementById('xp-market-container');
  container.innerHTML = '<div class="loading">Loading sell requests…</div>';

  try {
    await fetchBtcRate();
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-xp?status=open', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');

    const listings = data.listings || [];
    if (listings.length === 0) {
      container.innerHTML = '<div style="color:#6b7280;padding:16px 0;">No open sell requests.</div>';
      return;
    }

    container.innerHTML = listings.map(l => {
      const sats = l.satsRequested || 0;
      const usdStr = satsToUsdStr(sats);
      const bal = l.balance !== null && l.balance !== undefined ? `${l.balance.toLocaleString()} XP` : '—';
      const addrSafe = esc(l.btcAddress || '—');
      const addrOnclick = l.btcAddress ? l.btcAddress.replace(/'/g, "\\'") : '';
      return `<div class="payout-card" style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div>
            ${l.userEmail ? `<a href="mailto:${esc(l.userEmail)}" style="color:#f7931a;font-size:13px;font-weight:600">${esc(l.userEmail)}</a>` : '<span style="color:#9ca3af;font-size:13px">—</span>'}
            ${l.nickname ? `<span style="font-size:12px;color:#374151;margin-left:8px;font-weight:600">${esc(l.nickname)}</span>` : ''}
            <span style="font-family:monospace;font-size:11px;color:#9ca3af;margin-left:6px">${esc(l.refCode || '')}</span>
          </div>
          <div style="font-size:11px;color:#9ca3af">Balance: <strong style="color:#374151">${bal}</strong></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
          <div style="background:#f9fafb;border-radius:8px;padding:8px 12px;">
            <div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Selling</div>
            <div style="font-size:18px;font-weight:800;color:#111;margin-top:2px">${(l.xpAmount || 0).toLocaleString()} XP</div>
            <div style="font-size:11px;color:#6b7280">${(l.pricePerXp || 0).toLocaleString()} sats/XP</div>
          </div>
          <div style="background:#fff7ed;border-radius:8px;padding:8px 12px;border:1px solid #fed7aa;">
            <div style="font-size:10px;color:#9a3412;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Pay out</div>
            <div style="font-size:18px;font-weight:800;color:#f7931a;margin-top:2px">${sats.toLocaleString()} sats</div>
            <div style="font-size:11px;color:#9a3412">${usdStr || 'fetching rate…'}</div>
          </div>
        </div>
        <div style="background:#f1f5f9;border-radius:8px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap">Send to</span>
          <span style="font-size:12px;font-family:monospace;word-break:break-all;flex:1;color:#0f172a">${addrSafe}</span>
          ${l.btcAddress ? `<button onclick="copyAddr('${addrOnclick}',this)" style="flex-shrink:0;padding:4px 10px;font-size:12px;cursor:pointer;border:1px solid #cbd5e1;border-radius:6px;background:#fff;white-space:nowrap">📋 Copy</button>` : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="toggle-btn live" data-listing-id="${l.id}" data-action="fulfill" style="flex:1">✓ Fulfill</button>
          <button class="toggle-btn paused" data-listing-id="${l.id}" data-action="cancel" style="flex:1">✕ Cancel</button>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-listing-id]').forEach(btn => {
      btn.addEventListener('click', () =>
        handleXpAction(btn.dataset.listingId, btn.dataset.action)
      );
    });
  } catch (err) {
    container.innerHTML = `<div class="err-msg" style="padding:16px">Failed to load: ${esc(err.message)}</div>`;
  }
}

async function handleXpAction(listingId, action) {
  let txHash = '', txChain = 'btc';
  if (action === 'fulfill') {
    txChain = prompt('Payment chain? (btc / sol / eth / usdc)', 'btc') || 'btc';
    txHash  = prompt('Transaction hash / ID (paste from explorer):') || '';
    if (!confirm(`Mark as fulfilled?\nChain: ${txChain.toUpperCase()}\nTx: ${txHash || '(none)'}\n\nThis will deduct XP from the user's balance.`)) return;
  } else {
    if (!confirm('Cancel this listing?')) return;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-xp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ listingId, action, txHash, txChain }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    loadXpMarket();
    loadFulfilledListings();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function loadFulfilledListings() {
  const container = document.getElementById('fulfilled-container');
  if (!container) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-xp?status=recent-fulfilled', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) return;
    const listings = data.listings || [];
    if (!listings.length) {
      container.innerHTML = '<div style="color:#6b7280;padding:12px 0;">No completed payouts yet.</div>';
      return;
    }
    container.innerHTML = listings.map(l => {
      const chain = (l.txChain || '').toUpperCase() || '—';
      const shortHash = l.txHash ? (l.txHash.length > 20 ? l.txHash.slice(0, 10) + '…' + l.txHash.slice(-8) : l.txHash) : '';
      const txLink = l.txUrl
        ? `<a href="${esc(l.txUrl)}" target="_blank" rel="noopener" style="font-family:monospace;font-size:11px;color:#f7931a">${esc(shortHash)}</a>`
        : '';
      const date = l.fulfilledAt?._seconds
        ? new Date(l.fulfilledAt._seconds * 1000).toLocaleDateString()
        : '—';
      const addTxBtn = `<button class="add-tx-btn" data-listing-id="${l.id}" style="margin-top:5px;padding:4px 10px;background:#f7931a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">${l.txHash ? '✏️ Edit tx' : '+ Add tx hash'}</button>`;
      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:8px;">
        <span style="font-size:18px">✓</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:#15803d;margin-bottom:2px">${(l.xpAmount||0).toLocaleString()} XP${chain !== '—' ? ' · ' + chain : ''}</div>
          ${txLink ? `<div style="margin-bottom:3px">${txLink}</div>` : ''}
          <div style="font-size:11px;color:#6b7280">${l.nickname ? esc(l.nickname) : (l.refCode ? esc(l.refCode) : '—')} · ${date}</div>
          ${addTxBtn}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.add-tx-btn').forEach(btn => {
      btn.addEventListener('click', () => addTxToListing(btn.dataset.listingId));
    });
  } catch (_) {}
}

async function addTxToListing(listingId) {
  const txChain = prompt('Chain? (btc / sol / eth / usdc)', 'sol') || 'sol';
  const txHash  = prompt('Transaction hash:');
  if (!txHash) return;
  const xpOverride = prompt('Correct the XP amount if needed (leave blank to keep as-is):');
  try {
    const token = await auth.currentUser.getIdToken();
    const body = { listingId, action: 'update-tx', txHash: txHash.trim(), txChain };
    if (xpOverride && parseInt(xpOverride) > 0) body.xpAmount = parseInt(xpOverride);
    const res = await fetch('/api/admin-xp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    loadFulfilledListings();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

document.getElementById('xp-market-refresh')?.addEventListener('click', () => { loadXpMarket(); loadFulfilledListings(); });

// ── Admin Inbox ─────────────────────────────────────────────────

async function loadInbox() {
  const container = document.getElementById('inbox-container');
  container.innerHTML = '<div class="loading">Loading messages…</div>';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-inbox', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load inbox');

    const threads = data.threads || [];

    // Count total unread
    let totalUnread = 0;
    threads.forEach(t => { totalUnread += t.unreadCount || 0; });
    const badge = document.getElementById('inbox-unread-badge');
    if (totalUnread > 0) {
      badge.textContent = totalUnread + ' unread';
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }

    if (threads.length === 0) {
      container.innerHTML = '<div style="color:#6b7280;padding:16px 0;">No messages yet.</div>';
      return;
    }

    container.innerHTML = threads.map(thread => {
      const unreadPill = thread.unreadCount > 0
        ? `<span style="background:#ef4444;color:#fff;border-radius:99px;padding:2px 8px;font-size:11px;font-weight:700;margin-left:6px;">${thread.unreadCount} new</span>`
        : '';
      const emailLink = thread.userEmail
        ? `<a href="mailto:${esc(thread.userEmail)}" style="color:#f7931a;font-weight:600;font-size:13px;">${esc(thread.userEmail)}</a>`
        : '<span style="color:#9ca3af;font-size:13px;">—</span>';
      const handleBadge = thread.userHandle
        ? `<span style="font-size:12px;color:#374151;font-weight:600;margin-left:8px;">${esc(thread.userHandle)}</span>`
        : '';
      const refBadge = `<span style="font-family:monospace;font-size:11px;color:#9ca3af;margin-left:6px;">${esc(thread.refCode)}</span>`;
      const subjectLine = thread.subject
        ? `<div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:4px;">📌 ${esc(thread.subject)}</div>`
        : '';

      const bubbles = thread.messages.map(m => {
        const isAdmin = m.from === 'admin';
        const bubbleStyle = isAdmin
          ? 'background:#f7931a;color:white;border-radius:12px 12px 2px 12px;padding:8px 12px;align-self:flex-end;max-width:80%;font-size:13px;'
          : 'background:#f3f4f6;border-radius:12px 12px 12px 2px;padding:8px 12px;align-self:flex-start;max-width:80%;font-size:13px;';
        const timeAlign = isAdmin ? 'right' : 'left';
        const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const who = isAdmin ? 'ScrollPay' : (thread.userHandle || 'User');
        return `<div>
          <div style="${bubbleStyle}">${esc(m.text)}</div>
          <div style="font-size:10px;color:#9ca3af;text-align:${timeAlign};margin-top:2px;">${esc(who)} · ${time}</div>
        </div>`;
      }).join('');

      const uid = esc(thread.userId);
      const ref = esc(thread.refCode);

      return `<div style="background:#fff;border:1.5px solid ${thread.unreadCount > 0 ? '#fed7aa' : '#e5e7eb'};border-radius:12px;padding:16px;margin-bottom:16px;">
        ${subjectLine}
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:12px;">
          ${emailLink}${handleBadge}${refBadge}${unreadPill}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;margin:12px 0;">
          ${bubbles}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <textarea data-uid="${uid}" data-ref="${ref}" placeholder="Reply…" style="flex:1;resize:none;height:60px;border:1.5px solid #e5e7eb;border-radius:8px;padding:8px;font-family:inherit;font-size:13px;outline:none;" onfocus="this.style.borderColor='#f7931a'" onblur="this.style.borderColor='#e5e7eb'"></textarea>
          <button onclick="sendAdminReply('${uid}','${ref}',this,this.previousElementSibling)" style="padding:0 18px;background:#f7931a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;align-self:flex-end;height:40px;" onmouseover="this.style.background='#e6851a'" onmouseout="this.style.background='#f7931a'">Send</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="err-msg" style="padding:16px">Failed to load inbox: ${esc(err.message)}</div>`;
  }
}

async function sendAdminReply(userId, refCode, btn, textarea) {
  const text = textarea.value.trim();
  if (!text) return;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ userId, refCode, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send');
    await loadInbox();
  } catch (err) {
    alert('Failed to send reply: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

document.getElementById('inbox-refresh')?.addEventListener('click', loadInbox);

// ── Admin Compose ────────────────────────────────────────────────

document.getElementById('compose-btn')?.addEventListener('click', () => {
  const panel = document.getElementById('inbox-compose');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) document.getElementById('compose-to').focus();
});

document.getElementById('compose-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('inbox-compose').style.display = 'none';
  ['compose-to', 'compose-subject', 'compose-text'].forEach(id => {
    document.getElementById(id).value = '';
  });
  const st = document.getElementById('compose-status');
  st.style.display = 'none';
});

document.getElementById('compose-send-btn')?.addEventListener('click', composeAdminMessage);
document.getElementById('compose-text')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) composeAdminMessage();
});

async function composeAdminMessage() {
  const to      = document.getElementById('compose-to').value.trim();
  const subject = document.getElementById('compose-subject').value.trim();
  const text    = document.getElementById('compose-text').value.trim();
  const btn     = document.getElementById('compose-send-btn');
  const status  = document.getElementById('compose-status');

  if (!to)   { status.textContent = 'Please enter a recipient.'; status.style.color = '#dc2626'; status.style.display = 'inline'; return; }
  if (!text) { status.textContent = 'Please enter a message.'; status.style.color = '#dc2626'; status.style.display = 'inline'; return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  status.style.display = 'none';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ action: 'compose', to, subject, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send');

    status.textContent = data.emailOnly ? '✓ Email sent (external address)' : '✓ Message sent!';
    status.style.color = '#16a34a';
    status.style.display = 'inline';
    document.getElementById('compose-to').value = '';
    document.getElementById('compose-subject').value = '';
    document.getElementById('compose-text').value = '';
    setTimeout(() => {
      document.getElementById('inbox-compose').style.display = 'none';
      status.style.display = 'none';
    }, 2000);
    loadInbox();
  } catch (err) {
    status.textContent = err.message;
    status.style.color = '#dc2626';
    status.style.display = 'inline';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send →';
  }
}

// ── SEO Partners (admin only) ────────────────────────────────────

let partnersData = [];

async function loadPartners() {
  const container = document.getElementById('partners-container');
  container.innerHTML = '<div class="loading">Loading partners…</div>';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-partners', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    partnersData = data.partners || [];
    renderPartnersTable();
  } catch (e) {
    container.innerHTML = '<p class="err-msg" style="display:block">Failed to load: ' + esc(e.message) + '</p>';
  }
}

function renderPartnersTable() {
  const container = document.getElementById('partners-container');
  if (partnersData.length === 0) {
    container.innerHTML = '<p style="color:#6b7280;font-size:14px;">No partners yet. Add the first one above.</p>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="border-bottom:2px solid #e5e7eb;">
        <th style="text-align:left;padding:8px 4px;">Name</th>
        <th style="text-align:left;padding:8px 4px;">Slug</th>
        <th style="text-align:left;padding:8px 4px;">Chain</th>
        <th style="text-align:center;padding:8px 4px;">Status</th>
        <th style="text-align:right;padding:8px 4px;">Actions</th>
      </tr></thead>
      <tbody>
        ${partnersData.map(p => `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:10px 4px;font-weight:600;">${esc(p.name)}</td>
            <td style="padding:10px 4px;color:#6b7280;">/partners/${esc(p.slug)}</td>
            <td style="padding:10px 4px;color:#6b7280;">${esc(p.chain || 'solana')}</td>
            <td style="padding:10px 4px;text-align:center;">
              <button class="toggle-btn ${p.active ? 'active' : 'paused'} partner-toggle-btn"
                data-id="${esc(p.id)}" data-active="${p.active}">
                ${p.active ? '● Live' : '○ Hidden'}
              </button>
            </td>
            <td style="padding:10px 4px;text-align:right;">
              <button class="toggle-btn paused partner-edit-btn" data-id="${esc(p.id)}" style="margin-right:4px;">✏️ Edit</button>
              <button class="toggle-btn paused partner-del-btn" data-id="${esc(p.id)}" style="background:#fee2e2;color:#dc2626;">🗑 Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.querySelectorAll('.partner-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const nowActive = btn.dataset.active === 'true';
      const token = await auth.currentUser.getIdToken();
      await fetch('/api/admin-partners', {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !nowActive }),
      });
      loadPartners();
    });
  });

  document.querySelectorAll('.partner-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = partnersData.find(x => x.id === btn.dataset.id);
      if (!p) return;
      openPartnerForm(p);
    });
  });

  document.querySelectorAll('.partner-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this partner page?')) return;
      const token = await auth.currentUser.getIdToken();
      await fetch('/api/admin-partners', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: btn.dataset.id }),
      });
      loadPartners();
    });
  });
}

function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 900 * 1024) {
    alert('Image is too large (max 900 KB). Try compressing it first.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('pf-logo').value = e.target.result;
    showLogoPreview(e.target.result);
  };
  reader.readAsDataURL(file);
}

function updateLogoPreview(url) {
  if (url && (url.startsWith('http') || url.startsWith('data:'))) {
    showLogoPreview(url);
  } else {
    document.getElementById('pf-logo-preview').style.display = 'none';
  }
}

function showLogoPreview(src) {
  const preview = document.getElementById('pf-logo-preview');
  const img = document.getElementById('pf-logo-img');
  img.src = src;
  preview.style.display = 'block';
}

function clearLogo() {
  document.getElementById('pf-logo').value = '';
  document.getElementById('pf-logo-file').value = '';
  document.getElementById('pf-logo-preview').style.display = 'none';
}

function openPartnerForm(p = null) {
  document.getElementById('partner-form-wrap').style.display = 'block';
  document.getElementById('partner-form-title').textContent = p ? 'Edit Partner' : 'Add Partner';
  document.getElementById('pf-id').value = p ? p.id : '';
  document.getElementById('pf-name').value = p ? p.name : '';
  document.getElementById('pf-slug').value = p ? p.slug : '';
  document.getElementById('pf-desc').value = p ? p.description : '';
  document.getElementById('pf-logo').value = p ? (p.logo || '') : '';
  document.getElementById('pf-logo-file').value = '';
  if (p?.logo) { showLogoPreview(p.logo); } else { document.getElementById('pf-logo-preview').style.display = 'none'; }
  document.getElementById('pf-website').value = p ? p.website : '';
  document.getElementById('pf-twitter').value = p ? p.twitter : '';
  document.getElementById('pf-telegram').value = p ? p.telegram : '';
  document.getElementById('pf-ca').value = p ? p.contractAddress : '';
  document.getElementById('pf-chain').value = p ? (p.chain || 'solana') : 'solana';
  document.getElementById('slug-preview').textContent = p ? p.slug : '';
  document.getElementById('partner-form-err').classList.add('hidden');
  document.getElementById('partner-form-wrap').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('new-partner-btn')?.addEventListener('click', () => openPartnerForm());
document.getElementById('partners-refresh')?.addEventListener('click', loadPartners);

document.getElementById('pf-slug')?.addEventListener('input', e => {
  document.getElementById('slug-preview').textContent = e.target.value || '';
});
document.getElementById('pf-name')?.addEventListener('input', e => {
  if (!document.getElementById('pf-id').value) {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    document.getElementById('pf-slug').value = slug;
    document.getElementById('slug-preview').textContent = slug;
  }
});

document.getElementById('pf-cancel')?.addEventListener('click', () => {
  document.getElementById('partner-form-wrap').style.display = 'none';
});

document.getElementById('pf-submit')?.addEventListener('click', async () => {
  const id = document.getElementById('pf-id').value;
  const name = document.getElementById('pf-name').value.trim();
  const slug = document.getElementById('pf-slug').value.trim();
  if (!name || !slug) {
    showError('partner-form-err', 'Name and slug are required.');
    return;
  }
  const body = {
    name, slug,
    description: document.getElementById('pf-desc').value.trim(),
    logo: document.getElementById('pf-logo').value.trim(),
    website: document.getElementById('pf-website').value.trim(),
    twitter: document.getElementById('pf-twitter').value.trim(),
    telegram: document.getElementById('pf-telegram').value.trim(),
    contractAddress: document.getElementById('pf-ca').value.trim(),
    chain: document.getElementById('pf-chain').value,
  };
  try {
    const token = await auth.currentUser.getIdToken();
    const method = id ? 'PATCH' : 'POST';
    if (id) body.id = id;
    const res = await fetch('/api/admin-partners', {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');
    document.getElementById('partner-form-wrap').style.display = 'none';
    loadPartners();
  } catch (e) {
    showError('partner-form-err', e.message);
  }
});

// ── Miners (admin only) ─────────────────────────────────────────

let allMiners = [];
let minerMsgTarget = null;

async function loadMiners() {
  const container = document.getElementById('miners-container');
  container.innerHTML = '<div class="loading">Loading miners…</div>';
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-users', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    allMiners = data.users || [];
    renderMinersTable(allMiners);
  } catch (err) {
    container.innerHTML = `<div class="err-msg">Failed to load: ${esc(err.message)}</div>`;
  }
}

let minerSort = 'signup';

function renderMinersTable(users) {
  const container = document.getElementById('miners-container');
  if (!users.length) {
    container.innerHTML = '<div style="color:#9ca3af;padding:16px">No miners found.</div>';
    return;
  }
  const sorted = [...users].sort((a, b) => {
    if (minerSort === 'fraud')  return (b.fraudScore || 0) - (a.fraudScore || 0);
    if (minerSort === 'xp')    return (b.totalSats || 0) - (a.totalSats || 0);
    if (minerSort === 'today') return (b.satsToday || 0) - (a.satsToday || 0);
    return (a.signupNumber || 999999) - (b.signupNumber || 999999);
  });
  const flagged = sorted.filter(u => (u.fraudScore || 0) >= 30).length;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
      <span style="font-size:12px;color:#6b7280;">${users.length.toLocaleString()} miners${flagged ? ` · <span style="color:#dc2626;font-weight:600;">⚠ ${flagged} flagged</span>` : ''}</span>
      <div style="display:flex;gap:6px;margin-left:auto;">
        ${['signup','xp','today','fraud'].map(s => `<button class="sort-miners-btn toggle-btn ${minerSort===s?'active':'paused'}" data-sort="${s}" style="font-size:11px;padding:3px 10px;">${s==='signup'?'# Order':s==='xp'?'Top XP':s==='today'?'Active Today':'⚠ Risk'}</button>`).join('')}
      </div>
    </div>
    <table class="campaigns-table">
      <thead><tr>
        <th>#</th>
        <th>Handle</th>
        <th>Email / ID</th>
        <th>Total XP</th>
        <th>Today</th>
        <th>Impr.</th>
        <th>Recruits</th>
        <th>Risk</th>
        <th></th>
      </tr></thead>
      <tbody>${sorted.map(u => minerRow(u)).join('')}</tbody>
    </table>`;

  container.querySelectorAll('.msg-miner-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      openMinerMessage(btn.dataset.id, btn.dataset.ref, btn.dataset.handle)
    );
  });
  container.querySelectorAll('.xp-fix-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      openXpFix(btn.dataset.id, btn.dataset.handle, parseInt(btn.dataset.xp))
    );
  });
  container.querySelectorAll('.pay-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const u = allMiners.find(m => m.id === btn.dataset.uid);
      if (u) showPaymentPopup(u, e.currentTarget);
    });
  });
  container.querySelectorAll('.freeze-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      toggleFreezeAccount(btn.dataset.id, btn.dataset.handle, btn.dataset.frozen === '1')
    );
  });
  container.querySelectorAll('.audit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('[data-tab="audit"]')?.click();
      const input = document.getElementById('audit-user-input');
      if (input) input.value = btn.dataset.id;
      runAudit(btn.dataset.id);
    });
  });
  container.querySelectorAll('.sort-miners-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      minerSort = btn.dataset.sort;
      renderMinersTable(allMiners);
    });
  });
  container.querySelectorAll('.merge-miner-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      openMergeDialog(btn.dataset.id, btn.dataset.handle, parseInt(btn.dataset.xp))
    );
  });
  container.querySelectorAll('.reset-pw-btn').forEach(btn => {
    btn.addEventListener('click', () =>
      sendLoginLink(btn.dataset.id, btn.dataset.handle)
    );
  });
}

function minerRow(u) {
  const lastActive = u.lastActiveAt
    ? new Date(u.lastActiveAt * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : '—';
  const display = esc(u.email || u.id || '—');
  const fs = u.fraudScore || 0;
  const riskBadge = fs >= 60
    ? `<span style="background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;">⚠ ${fs}</span>`
    : fs >= 30
      ? `<span style="background:#fef3c7;color:#b45309;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">! ${fs}</span>`
      : `<span style="color:#9ca3af;font-size:11px;">${fs}</span>`;
  const todayColor = u.satsToday > 200 ? '#dc2626' : u.satsToday > 0 ? '#16a34a' : 'inherit';
  const handle = esc(u.nickname || u.email || u.id);
  const frozenBg = u.frozen ? 'background:#eff6ff;' : fs >= 60 ? 'background:#fff5f5;' : fs >= 30 ? 'background:#fffbeb;' : '';
  const frozenBadge = u.frozen
    ? `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;" title="${esc(u.frozenReason || 'Under review')}">🔒 Frozen</span>`
    : '';
  return `<tr style="${frozenBg}">
    <td style="font-size:12px;color:#6b7280">${u.signupNumber || '—'}</td>
    <td><strong>${u.nickname ? esc(u.nickname) : '<span style="color:#9ca3af">—</span>'}</strong>${frozenBadge ? ' ' + frozenBadge : ''}</td>
    <td style="font-size:12px;color:#6b7280;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}</td>
    <td>${(u.totalSats || 0).toLocaleString()}</td>
    <td style="color:${todayColor};font-weight:${u.satsToday>200?'700':'400'}">${(u.satsToday || 0).toLocaleString()}</td>
    <td style="font-size:12px;color:#6b7280">${(u.totalImpressions || 0).toLocaleString()}</td>
    <td>${(u.referralCount || 0).toLocaleString()}</td>
    <td>${riskBadge}</td>
    <td style="white-space:nowrap;">
      <button class="msg-miner-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              data-ref="${esc(u.refCode)}"
              data-handle="${handle}"
              style="font-size:11px;padding:3px 8px;">💬</button>
      <button class="xp-fix-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              data-handle="${handle}"
              data-xp="${u.totalSats || 0}"
              style="font-size:11px;padding:3px 8px;background:#fee2e2;color:#dc2626;border-color:#fca5a5;">⚙ XP</button>
      <button class="pay-info-btn btn-ghost-sm"
              data-uid="${esc(u.id)}"
              style="font-size:11px;padding:3px 8px;"
              title="Payment methods">💳</button>
      <button class="merge-miner-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              data-handle="${handle}"
              data-xp="${u.totalSats || 0}"
              style="font-size:11px;padding:3px 8px;background:#ede9fe;color:#6d28d9;border-color:#c4b5fd;"
              title="Merge another account into this one">⇄ Merge</button>
      <button class="reset-pw-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              data-handle="${handle}"
              style="font-size:11px;padding:3px 8px;"
              title="Send password reset / login link">🔑</button>
      <button class="freeze-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              data-handle="${handle}"
              data-frozen="${u.frozen ? '1' : '0'}"
              style="font-size:11px;padding:3px 8px;${u.frozen ? 'background:#dbeafe;color:#1d4ed8;border-color:#93c5fd;' : 'background:#f0f9ff;color:#0369a1;border-color:#bae6fd;'}"
              title="${u.frozen ? 'Unfreeze account' : 'Freeze account for review'}">
        ${u.frozen ? '🔓 Unfreeze' : '🔒 Freeze'}
      </button>
      <button class="audit-btn btn-ghost-sm"
              data-id="${esc(u.id)}"
              style="font-size:11px;padding:3px 8px;background:#f0f9ff;color:#0369a1;border-color:#bae6fd;"
              title="Full audit trail">🔍</button>
    </td>
  </tr>`;
}

function openMinerMessage(userId, refCode, handle) {
  minerMsgTarget = { userId, refCode };
  document.getElementById('miner-msg-title').textContent = `Message ${handle}`;
  document.getElementById('miner-msg-text').value = '';
  document.getElementById('miner-msg-status').style.display = 'none';
  document.getElementById('miner-msg-wrap').style.display = 'block';
  document.getElementById('miner-msg-text').focus();
}

async function openXpFix(userId, handle, currentXp) {
  const input = prompt(
    `Adjust XP for ${handle}\nCurrent balance: ${currentXp.toLocaleString()} XP\n\nEnter new total (or leave blank to zero out):`,
    currentXp
  );
  if (input === null) return;
  const newTotal = input.trim() === '' ? 0 : parseInt(input);
  if (isNaN(newTotal) || newTotal < 0) return alert('Invalid amount');
  const adjustXp = newTotal - currentXp;
  if (adjustXp === 0) return;
  const confirm = window.confirm(
    `Set ${handle}'s XP from ${currentXp.toLocaleString()} → ${newTotal.toLocaleString()} (${adjustXp >= 0 ? '+' : ''}${adjustXp.toLocaleString()} XP)?\n\nThis cannot be undone.`
  );
  if (!confirm) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ userId, adjustXp, note: `Admin set total to ${newTotal}` }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    alert(`Done. New balance: ${data.newTotal.toLocaleString()} XP`);
    loadMiners();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function openMergeDialog(targetUserId, targetHandle, targetXp) {
  const sourceInput = prompt(
    `Merge another account INTO ${targetHandle} (current XP: ${targetXp.toLocaleString()})\n\n` +
    `Enter the SOURCE user ID or handle to merge FROM:\n(Their XP will be added to ${targetHandle} and their account will be zeroed out)`
  );
  if (!sourceInput || !sourceInput.trim()) return;
  const query = sourceInput.trim();

  // Resolve handle → id if needed (search allMiners first)
  let sourceUserId = query;
  const byHandle = allMiners.find(u => (u.nickname || '').toLowerCase() === query.toLowerCase());
  const byId     = allMiners.find(u => u.id === query);
  if (byHandle) sourceUserId = byHandle.id;
  else if (byId) sourceUserId = byId.id;

  const sourceUser = allMiners.find(u => u.id === sourceUserId);
  const sourceLabel = sourceUser ? (sourceUser.nickname || sourceUser.email || sourceUserId) : sourceUserId;
  const sourceXp = sourceUser ? (sourceUser.totalSats || 0) : '?';

  const confirmed = window.confirm(
    `Merge "${sourceLabel}" (${typeof sourceXp === 'number' ? sourceXp.toLocaleString() : sourceXp} XP) INTO "${targetHandle}" (${targetXp.toLocaleString()} XP)?\n\n` +
    `• Source XP will be added to ${targetHandle}\n` +
    `• Source account will be zeroed out and marked merged\n` +
    `• Earlier signup number will be kept on ${targetHandle}\n\n` +
    `This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-merge-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceUserId, targetUserId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Merge failed');
    alert(`Done! Merged ${data.xpMerged.toLocaleString()} XP into ${targetHandle}.\nMigrated fields: ${data.migrated.join(', ') || 'none'}`);
    loadMiners();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function toggleFreezeAccount(userId, handle, currentlyFrozen) {
  const action = currentlyFrozen ? 'unfreeze' : 'freeze';
  let reason = '';
  if (!currentlyFrozen) {
    reason = prompt(`Freeze ${handle} for review?\n\nReason (optional):`, 'Raffle manipulation — under review');
    if (reason === null) return;
  } else {
    if (!confirm(`Unfreeze ${handle}?`)) return;
  }
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ userId, action, reason: reason.trim() || 'Under review' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    loadMiners();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function sendLoginLink(userId, handle) {
  const confirmed = window.confirm(`Send a sign-in link to ${handle}'s email address?`);
  if (!confirmed) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, action: 'reset-password' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    alert(`Sign-in link sent to ${data.email}`);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}


let payPopupEl = null;
function showPaymentPopup(u, anchorEl) {
  if (payPopupEl) payPopupEl.remove();

  const METHODS = [
    ['₿ BTC/LN',   u.btcAddress],
    ['◎ SOL',      u.solAddress],
    ['Ξ ETH',      u.ethAddress],
    ['Venmo',      u.venmo],
    ['CashApp',    u.cashapp],
    ['Apple Pay',  u.applepay],
    ['PayPal',     u.paypal],
    ['Zelle',      u.zelle],
  ].filter(([, v]) => v);

  const rows = METHODS.length
    ? METHODS.map(([label, val]) =>
        `<div class="miner-pay-row">
          <span class="miner-pay-label">${esc(label)}</span>
          <span class="miner-pay-val">${esc(val)}</span>
          <button class="miner-pay-copy" onclick="navigator.clipboard.writeText('${esc(val).replace(/'/g,"\\'")}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='Copy',1200)})">Copy</button>
        </div>`
      ).join('')
    : '<div style="color:#9ca3af;font-size:12px;">No payment methods saved yet.</div>';

  const el = document.createElement('div');
  el.className = 'miner-pay-popup';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <h4 style="margin:0;">💳 ${esc(u.nickname || u.email || u.id)}</h4>
      <button onclick="this.closest('.miner-pay-popup').remove()" style="background:none;border:none;cursor:pointer;font-size:16px;color:#9ca3af;line-height:1;padding:2px 4px;">✕</button>
    </div>
    ${rows}`;
  document.body.appendChild(el);
  payPopupEl = el;

  // Position near the button
  const rect = anchorEl.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6 + window.scrollY, window.scrollY + window.innerHeight - el.offsetHeight - 20);
  el.style.top = top + 'px';
  el.style.right = (window.innerWidth - rect.right) + 'px';

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!el.contains(ev.target) && ev.target !== anchorEl) {
        el.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 0);
}

document.getElementById('miners-search')?.addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q
    ? allMiners.filter(u =>
        (u.nickname || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.id || '').toLowerCase().includes(q)
      )
    : allMiners;
  renderMinersTable(filtered);
});

document.getElementById('miners-refresh')?.addEventListener('click', loadMiners);

document.getElementById('miner-msg-close')?.addEventListener('click', () => {
  document.getElementById('miner-msg-wrap').style.display = 'none';
});

document.getElementById('miner-msg-send')?.addEventListener('click', async () => {
  const text = document.getElementById('miner-msg-text').value.trim();
  const statusEl = document.getElementById('miner-msg-status');
  const btn = document.getElementById('miner-msg-send');
  if (!text || !minerMsgTarget) return;

  btn.disabled = true;
  btn.textContent = 'Sending…';
  statusEl.style.display = 'none';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: minerMsgTarget.userId, refCode: minerMsgTarget.refCode, text }),
    });
    const data = await res.json();
    if (res.ok) {
      statusEl.textContent = '✓ Sent!';
      statusEl.style.color = '#16a34a';
      statusEl.style.display = 'block';
      setTimeout(() => { document.getElementById('miner-msg-wrap').style.display = 'none'; }, 1200);
    } else {
      statusEl.textContent = data.error || 'Failed to send.';
      statusEl.style.color = '#dc2626';
      statusEl.style.display = 'block';
    }
  } catch (_) {
    statusEl.textContent = 'Network error — try again.';
    statusEl.style.color = '#dc2626';
    statusEl.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Send Message';
});

// ── Helpers ─────────────────────────────────────────────────────

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Campaign Sweep Requests ─────────────────────────────────────
async function loadSweepOrders() {
  const container = document.getElementById('sweep-container');
  if (!container) return;
  container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-sweep', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');

    const orders = data.orders || [];
    if (!orders.length) {
      container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:16px 0;">No campaign requests yet.</p>';
      return;
    }

    const SC = {
      pending:   { bg:'#fff7ed', border:'#fed7aa', text:'#92400e', label:'⏳ Pending'   },
      contacted: { bg:'#eff6ff', border:'#bfdbfe', text:'#1e40af', label:'📧 Contacted' },
      fulfilled: { bg:'#f0fdf4', border:'#bbf7d0', text:'#166534', label:'✓ Fulfilled'  },
      cancelled: { bg:'#fef2f2', border:'#fecaca', text:'#991b1b', label:'✕ Cancelled'  },
    };

    container.innerHTML = orders.map(o => {
      const sc = SC[o.status] || SC.pending;
      const created = o.createdAt ? new Date(o.createdAt._seconds * 1000).toLocaleString() : '—';
      const usd = o.usdEstimate ? '$' + Number(o.usdEstimate).toFixed(2) : '—';
      const emailEsc = esc(o.email || '');
      const fulfillSweepBtn = (o.status === 'pending' || o.status === 'contacted') ? `
        <button onclick="fulfillSweepAndTransfer('${esc(o.id)}','${emailEsc}')" style="background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">⚡ Fulfill Sweep + Transfer XP</button>` : '';
      const actions = o.status === 'pending' ? `
        <button onclick="updateSweepStatus('${o.id}','contacted')" style="background:#1d4ed8;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📧 Mark Contacted</button>
        <button onclick="updateSweepStatus('${o.id}','fulfilled')" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✓ Mark Fulfilled</button>
        <button onclick="updateSweepStatus('${o.id}','cancelled')" style="background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✕ Cancel</button>`
      : o.status === 'contacted' ? `
        <button onclick="updateSweepStatus('${o.id}','fulfilled')" style="background:#16a34a;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✓ Mark Fulfilled</button>
        <button onclick="updateSweepStatus('${o.id}','cancelled')" style="background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✕ Cancel</button>` : '';

      return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin-bottom:12px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <div>
            <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:2px;">${esc(o.name||'Anonymous')}</div>
            <a href="mailto:${esc(o.email)}" style="font-size:13px;color:#f7931a;font-weight:600;">${esc(o.email)}</a>
            ${o.website ? `<span style="font-size:12px;color:#6b7280;margin-left:8px;">· ${esc(o.website)}</span>` : ''}
          </div>
          <span style="background:${sc.bg};border:1px solid ${sc.border};color:${sc.text};font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;">${sc.label}</span>
        </div>
        <div style="display:flex;gap:20px;margin-bottom:10px;flex-wrap:wrap;">
          <div><div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;">XP Requested</div><div style="font-size:18px;font-weight:800;color:#f7931a;">${Number(o.totalXp||0).toLocaleString()} XP</div></div>
          <div><div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;">Total Sats</div><div style="font-size:18px;font-weight:800;color:#111827;">${Number(o.totalSats||0).toLocaleString()}</div></div>
          <div><div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;">USD Est.</div><div style="font-size:18px;font-weight:800;color:#111827;">${usd}</div></div>
          <div><div style="font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.4px;">Submitted</div><div style="font-size:13px;color:#6b7280;font-weight:600;margin-top:4px;">${created}</div></div>
        </div>
        ${o.message ? `<div style="background:#f9fafb;border:1px solid #f3f4f6;border-radius:8px;padding:10px 12px;font-size:13px;color:#374151;margin-bottom:10px;">"${esc(o.message)}"</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${fulfillSweepBtn}
          ${actions}
          <a href="mailto:${esc(o.email)}?subject=ScrollPay+Campaign+Request" style="background:#fff7ed;color:#f7931a;border:1px solid #fed7aa;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;text-decoration:none;">✉ Reply</a>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px;">${esc(e.message)}</p>`;
  }
}

window.updateSweepStatus = updateSweepStatus;
async function updateSweepStatus(id, status) {
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-sweep', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    await loadSweepOrders();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function fulfillSweepAndTransfer(sweepOrderId, defaultEmail) {
  // Let admin confirm or override the destination account
  const buyerEmail = prompt(
    `⚡ Fulfill Sweep\n\nCredit XP to which ScrollPay account?\n(Edit if the buyer's account email differs from their order email)`,
    defaultEmail
  );
  if (!buyerEmail || !buyerEmail.trim()) return;

  if (!confirm(
    `⚡ Confirm Sweep Fulfillment\n\n` +
    `• Fulfill ALL open XP sell orders\n` +
    `• Deduct XP from each seller\n` +
    `• Credit total XP → ${buyerEmail.trim()}\n` +
    `• Email all sellers + buyer\n` +
    `• Mark this sweep as fulfilled\n\n` +
    `This cannot be undone. Continue?`
  )) return;

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-sweep-fulfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ sweepOrderId, buyerEmail: buyerEmail.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    alert(
      `✓ Done!\n\n` +
      `${data.fulfilled} listings fulfilled\n` +
      `${data.totalXp.toLocaleString()} XP transferred to ${data.buyerEmail}` +
      (data.skipped ? `\n${data.skipped} listings skipped (insufficient seller balance)` : '')
    );
    loadSweepOrders();
    loadXpMarket();
    loadFulfilledListings();
  } catch(e) {
    alert('Failed: ' + e.message);
  }
}
window.fulfillSweepAndTransfer = fulfillSweepAndTransfer;

document.getElementById('sweep-refresh')?.addEventListener('click', loadSweepOrders);

// ── Raffle Entries ──────────────────────────────────────────────
async function loadRaffleEntries(drawOverride) {
  const container  = document.getElementById('raffle-container');
  const summary    = document.getElementById('raffle-summary');
  const picker     = document.getElementById('raffle-draw-picker');
  const drawBtn    = document.getElementById('raffle-draw-btn');
  const winnerBanner = document.getElementById('raffle-winner-banner');
  if (!container) return;

  const draw = drawOverride || parseInt(picker?.value) || null;
  const url  = '/api/admin-raffle' + (draw ? `?draw=${draw}` : '');

  container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';
  if (summary) summary.style.display = 'none';
  if (winnerBanner) winnerBanner.style.display = 'none';
  if (drawBtn) drawBtn.style.display = 'none';

  try {
    const token = await auth.currentUser.getIdToken();
    const res  = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    const { entries, drawNumber, totalTickets, endsAt, currentDraw, winner } = data;

    if (picker && !picker.value) picker.value = drawNumber;

    const endsDate = new Date(endsAt);
    const closed   = endsDate < new Date();
    const endsStr  = endsDate.toLocaleString();

    // Show winner banner if already drawn
    if (winner && winnerBanner) {
      const wHandle = winner.nickname ? `@${esc(winner.nickname)}` : `Miner`;
      winnerBanner.style.display = 'block';
      winnerBanner.innerHTML = `
        <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">
          <span style="font-size:24px;">🏆</span>
          <div>
            <div style="font-size:13px;font-weight:800;color:#15803d;">Draw #${drawNumber} Winner</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${wHandle}</div>
            <div style="font-size:12px;color:#6b7280;">${winner.tickets?.toLocaleString()} tickets · Email ${winner.emailSent ? 'sent ✓' : 'not sent'}</div>
          </div>
        </div>`;
    }

    // Show Draw Winner button only for closed draws without a winner yet
    if (drawBtn) {
      drawBtn.style.display = (closed && !winner) ? 'inline-block' : 'none';
      drawBtn.dataset.draw = drawNumber;
    }

    if (summary) {
      summary.style.display = 'block';
      summary.innerHTML = `
        <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center;">
          <div><span style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">Draw</span><div style="font-size:20px;font-weight:800;color:#f7931a;">#${drawNumber}</div></div>
          <div><span style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">Total Tickets</span><div style="font-size:20px;font-weight:800;">${totalTickets.toLocaleString()}</div></div>
          <div><span style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">Entrants</span><div style="font-size:20px;font-weight:800;">${entries.length}</div></div>
          <div><span style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">${closed ? 'Closed' : 'Closes'}</span><div style="font-size:13px;font-weight:600;margin-top:4px;">${endsStr}</div></div>
          ${closed ? '<span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;">Draw closed</span>' : '<span style="background:#fff7ed;border:1px solid #fed7aa;color:#92400e;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;">Active</span>'}
        </div>`;
    }

    if (!entries.length) {
      container.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:16px 0;">No entries for this draw yet.</p>';
      return;
    }

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
            <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;">#</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;">Handle / Ref</th>
            <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;">Tickets</th>
            <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;">Odds</th>
            <th style="padding:10px 14px;"></th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((e, i) => {
            const odds = totalTickets > 0 ? ((e.tickets / totalTickets) * 100).toFixed(1) : '0.0';
            const handle = e.nickname || `Miner #${e.refCode || '?'}`;
            return `<tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:10px 14px;color:#9ca3af;font-weight:600;">${i + 1}</td>
              <td style="padding:10px 14px;">
                <div style="font-weight:700;color:#111827;">${esc(handle)}</div>
                ${e.refCode ? `<div style="font-size:11px;color:#9ca3af;font-family:monospace;">${esc(e.refCode)}</div>` : ''}
              </td>
              <td style="padding:10px 14px;text-align:right;font-weight:800;color:#f7931a;">${(e.tickets||0).toLocaleString()}</td>
              <td style="padding:10px 14px;text-align:right;color:#6b7280;">${odds}%</td>
              <td style="padding:10px 14px;text-align:right;">
                <button onclick="removeRaffleEntry('${e.id}', '${esc(handle)}')"
                  style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;">
                  Remove
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px;">${esc(e.message)}</p>`;
  }
}

async function removeRaffleEntry(entryId, handle) {
  if (!confirm(`Remove all entries for ${handle}? Their XP will be refunded.`)) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/admin-raffle?entryId=${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    await loadRaffleEntries();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function drawRaffleWinner() {
  const drawBtn = document.getElementById('raffle-draw-btn');
  const drawNumber = parseInt(drawBtn?.dataset.draw) || 1;
  if (!confirm(`Draw the winner for Draw #${drawNumber} now? This cannot be undone.`)) return;
  drawBtn.disabled = true;
  drawBtn.textContent = 'Drawing…';
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-raffle', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    const w = data.winner;
    const wHandle = w.nickname ? `@${w.nickname}` : 'Miner';
    alert(`🏆 Winner: ${wHandle} — ${w.tickets?.toLocaleString()} tickets\nEmail ${data.emailSent ? 'sent ✓' : 'not sent (no email on file)'}`);
    await loadRaffleEntries();
  } catch (e) {
    alert('Error: ' + e.message);
    drawBtn.disabled = false;
    drawBtn.textContent = '🏆 Draw Winner';
  }
}

window.loadRaffleEntries  = loadRaffleEntries;
window.removeRaffleEntry  = removeRaffleEntry;
window.drawRaffleWinner   = drawRaffleWinner;
document.getElementById('raffle-refresh')?.addEventListener('click', () => loadRaffleEntries());

// ── User Audit ────────────────────────────────────────────────────
async function runAudit(userIdOverride) {
  const container = document.getElementById('audit-container');
  const input = document.getElementById('audit-user-input');
  if (!container) return;

  let query = userIdOverride || input?.value?.trim();
  if (!query) { alert('Enter a user ID or nickname'); return; }

  // If it looks like a nickname rather than a uid, resolve it from allMiners
  let userId = query;
  if (allMiners.length) {
    const byNick = allMiners.find(u => (u.nickname || '').toLowerCase() === query.toLowerCase());
    const byRef  = allMiners.find(u => (u.refCode  || '').toUpperCase() === query.toUpperCase());
    if (byNick) userId = byNick.id;
    else if (byRef) userId = byRef.id;
  }

  container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Running audit…</p>';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/admin-audit?userId=${encodeURIComponent(userId)}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');

    const { user, summary, raffleEntries, btcListings, scrollOrders, transfersOut, transfersIn } = data;

    const flagHtml = summary.flags.length
      ? summary.flags.map(f => `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:6px 12px;margin-bottom:6px;font-size:12px;font-weight:700;color:#dc2626;">⚠ ${esc(f)}</div>`).join('')
      : '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;color:#15803d;">✓ No flags</div>';

    const ts = s => s ? new Date(s * 1000).toLocaleString() : '—';
    const xp = n => (n || 0).toLocaleString();

    container.innerHTML = `
      <div style="display:grid;gap:16px;">

        <!-- User card -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;">
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;">Account</div>
          <div style="display:flex;gap:32px;flex-wrap:wrap;font-size:13px;">
            <div><span style="color:#6b7280;">Handle</span><div style="font-weight:700;">${esc(user.nickname || '—')}</div></div>
            <div><span style="color:#6b7280;">Email</span><div style="font-weight:700;">${esc(user.email || '—')}</div></div>
            <div><span style="color:#6b7280;">Ref</span><div style="font-weight:700;font-family:monospace;">${esc(user.refCode || '—')}</div></div>
            <div><span style="color:#6b7280;">Signup #</span><div style="font-weight:700;">${user.signupNumber || '—'}</div></div>
            <div><span style="color:#6b7280;">Frozen</span><div style="font-weight:700;color:${user.frozen ? '#dc2626' : '#16a34a'}">${user.frozen ? '🔒 YES — ' + esc(user.frozenReason) : '✓ No'}</div></div>
            <div><span style="color:#6b7280;">Last active</span><div style="font-weight:700;">${ts(user.lastActiveAt)}</div></div>
          </div>
        </div>

        <!-- Flags -->
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Flags</div>
          ${flagHtml}
        </div>

        <!-- XP accounting -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;">
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;">XP Accounting</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:4px 0;color:#374151;">Current balance</td><td style="text-align:right;font-weight:700;">${xp(summary.currentBalance)} XP</td></tr>
            <tr><td style="padding:4px 0;color:#374151;">In raffle tickets (all draws)</td><td style="text-align:right;font-weight:700;color:#f7931a;">${xp(summary.totalRaffleTickets)} XP</td></tr>
            <tr><td style="padding:4px 0;color:#374151;">In open BTC listings (escrowed?)</td><td style="text-align:right;font-weight:700;color:${summary.openBtcListingXp > 0 ? '#dc2626' : '#374151'}">${xp(summary.openBtcListingXp)} XP</td></tr>
            <tr><td style="padding:4px 0;color:#374151;">In open SCROLL asks (escrowed)</td><td style="text-align:right;font-weight:700;">${xp(summary.openScrollAskXp)} XP</td></tr>
            <tr style="border-top:1px solid #e5e7eb;"><td style="padding:6px 0 0;color:#374151;">Total transferred out</td><td style="text-align:right;font-weight:700;">${xp(summary.totalTransferredOut)} XP</td></tr>
            <tr><td style="padding:4px 0;color:#374151;">Total transferred in</td><td style="text-align:right;font-weight:700;">${xp(summary.totalTransferredIn)} XP</td></tr>
            ${summary.doubleSpendBtc > 0 ? `<tr style="background:#fef2f2;"><td style="padding:6px 12px;color:#dc2626;font-weight:700;">⚠ Double-spend (BTC listing > balance)</td><td style="text-align:right;font-weight:800;color:#dc2626;">${xp(summary.doubleSpendBtc)} XP</td></tr>` : ''}
          </table>
        </div>

        <!-- Raffle entries -->
        ${raffleEntries.length ? `
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Raffle Entries (${raffleEntries.length})</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            ${raffleEntries.map(e => `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:6px 0;">Draw #${e.drawNumber}</td><td style="text-align:right;font-weight:700;color:#f7931a;">${xp(e.tickets)} tickets</td></tr>`).join('')}
          </table>
        </div>` : ''}

        <!-- BTC Listings -->
        ${btcListings.length ? `
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">BTC Marketplace Listings (${btcListings.length})</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="background:#f9fafb;"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">Status</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">XP</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">Price</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">Escrowed</th></tr>
            ${btcListings.map(l => `<tr style="border-bottom:1px solid #f3f4f6;${l.status==='open'?'background:#fff7ed;':''}"><td style="padding:6px 8px;">${esc(l.status)}</td><td style="padding:6px 8px;text-align:right;font-weight:700;">${xp(l.xpAmount)}</td><td style="padding:6px 8px;text-align:right;">${l.pricePerXp} sat/XP</td><td style="padding:6px 8px;text-align:right;">${l.xpEscrowed ? '✓' : '⚠ No'}</td></tr>`).join('')}
          </table>
        </div>` : ''}

        <!-- SCROLL orders -->
        ${scrollOrders.length ? `
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">SCROLL Market Orders (${scrollOrders.length})</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="background:#f9fafb;"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">Type</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">Status</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">XP</th></tr>
            ${scrollOrders.map(o => `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:6px 8px;">${esc(o.type)}</td><td style="padding:6px 8px;">${esc(o.status)}</td><td style="padding:6px 8px;text-align:right;font-weight:700;">${xp(o.xpAmount)}</td></tr>`).join('')}
          </table>
        </div>` : ''}

        <!-- Transfers out -->
        ${transfersOut.length ? `
        <div>
          <div style="font-size:11px;color:#dc2626;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">⚠ Transfers Sent (${transfersOut.length})</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="background:#fef2f2;"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">To</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">Amount</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">When</th></tr>
            ${transfersOut.map(t => `<tr style="border-bottom:1px solid #fecaca;"><td style="padding:6px 8px;font-family:monospace;font-size:11px;">${esc(t.toHandle || t.toUid)}</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:#dc2626;">${xp(t.amount)}</td><td style="padding:6px 8px;text-align:right;color:#6b7280;">${ts(t.createdAt?._seconds || t.createdAt?.seconds)}</td></tr>`).join('')}
          </table>
        </div>` : ''}

        <!-- Transfers in -->
        ${transfersIn.length ? `
        <div>
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Transfers Received (${transfersIn.length})</div>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="background:#f9fafb;"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;">From</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">Amount</th><th style="padding:6px 8px;text-align:right;font-size:11px;color:#6b7280;">When</th></tr>
            ${transfersIn.map(t => `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:6px 8px;font-family:monospace;font-size:11px;">${esc(t.fromUid)}</td><td style="padding:6px 8px;text-align:right;font-weight:700;">${xp(t.amount)}</td><td style="padding:6px 8px;text-align:right;color:#6b7280;">${ts(t.createdAt?._seconds || t.createdAt?.seconds)}</td></tr>`).join('')}
          </table>
        </div>` : ''}

      </div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px;">${esc(e.message)}</p>`;
  }
}

window.runAudit = runAudit;

// ── Payout Report ─────────────────────────────────────────────────

const PLATFORM_FEE_PCT = 30;

function satsUsd(sats) {
  if (!btcUsd || !sats) return '—';
  return '$' + (sats * btcUsd / 1e8).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function copyPayoutAddr(btn, addr) {
  function markCopied() {
    btn.textContent = '✓ Copied';
    btn.style.background = '#16a34a';
    setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#374151'; }, 2500);
  }

  // Modern clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(addr).then(markCopied).catch(iosFallback);
  } else {
    iosFallback();
  }

  function iosFallback() {
    // iOS Safari needs a contenteditable element + setSelectionRange
    const el = document.createElement('input');
    el.value = addr;
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(el);
    el.focus();
    el.setSelectionRange(0, addr.length);
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(el);
    markCopied();
  }
}

async function loadPayoutReport() {
  const container = document.getElementById('payout-container');
  const summary   = document.getElementById('payout-summary');
  const sweepId   = (document.getElementById('payout-sweep-id')?.value || '').trim();

  container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';
  summary.style.display = 'none';

  try {
    const token = await auth.currentUser.getIdToken(true);
    const url   = '/api/admin-payout-report' + (sweepId ? `?sweepOrderId=${encodeURIComponent(sweepId)}` : '');
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data  = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');

    const { payouts = [], totalGrossSats = 0, totalNetSats = 0, totalFeeSats = 0, totalXp = 0 } = data;

    if (payouts.length === 0) {
      container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No fulfilled sweep payouts found.</p>';
      return;
    }

    const paidCount = payouts.filter(p => p.paid).length;

    summary.style.display = 'block';
    summary.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;font-size:13px;">
        <div><div style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Sellers</div><strong>${payouts.length}</strong> <span style="color:#9ca3af;">(${paidCount} paid)</span></div>
        <div><div style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">XP Sold</div><strong>${totalXp.toLocaleString()}</strong></div>
        <div><div style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Buyer Paid</div><strong>${totalGrossSats.toLocaleString()}</strong> <span style="color:#9ca3af;font-size:11px;">${satsUsd(totalGrossSats)}</span></div>
        <div><div style="color:#f7931a;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Your Fee 30%</div><strong style="color:#f7931a;">${totalFeeSats.toLocaleString()}</strong> <span style="color:#fbbf24;font-size:11px;">${satsUsd(totalFeeSats)}</span></div>
        <div><div style="color:#16a34a;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">You Send 70%</div><strong style="color:#16a34a;">${totalNetSats.toLocaleString()}</strong> <span style="color:#86efac;font-size:11px;">${satsUsd(totalNetSats)}</span></div>
      </div>`;

    container.innerHTML = payouts.map(p => {
      const addr     = p.btcAddress || p.solAddress || p.cashapp || p.venmo || '';
      const addrType = p.btcAddress ? '₿ BTC' : p.solAddress ? 'SOL' : p.cashapp ? 'CashApp' : p.venmo ? 'Venmo' : '';
      const isPaid   = !!p.paid;
      const paidDate = isPaid && p.paid.paidAt ? new Date(p.paid.paidAt).toLocaleDateString() : '';
      const addrEsc  = esc(addr);
      // escape for onclick attribute — replace single quotes
      const addrJs   = addr.replace(/'/g, "\\'");

      const addrRow = addr
        ? `<div style="padding:10px 14px;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
             ${addrType ? `<span style="font-size:10px;font-weight:700;color:#f7931a;background:#fff7ed;padding:2px 7px;border-radius:4px;flex-shrink:0;">${addrType}</span>` : ''}
             <span style="font-family:monospace;font-size:11px;color:#374151;flex:1;min-width:0;word-break:break-all;">${addrEsc}</span>
             <button onclick="copyPayoutAddr(this,'${addrJs}')"
               style="flex-shrink:0;background:#374151;color:#fff;border:none;border-radius:5px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;">Copy</button>
           </div>`
        : `<div style="padding:10px 14px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#dc2626;font-weight:600;">⚠️ No payment address on file</div>`;

      const txInfo    = isPaid && p.paid.txNote ? `<div style="font-size:11px;color:#6b7280;margin-top:3px;font-family:monospace;word-break:break-all;">${esc(p.paid.txNote)}</div>` : '';
      const actionRow = isPaid
        ? `<div style="padding:12px 14px;background:#f0fdf4;border-top:1px solid #bbf7d0;">
             <div style="font-size:12px;font-weight:700;color:#15803d;">✓ Paid ${paidDate}</div>
             ${txInfo}
             ${p.paid.emailSent !== false ? '<div style="font-size:10px;color:#6b7280;margin-top:3px;">📧 Confirmation email sent</div>' : ''}
           </div>`
        : `<div id="pa-${esc(p.userId)}" style="padding:10px 14px;background:#f9fafb;border-top:1px solid #e5e7eb;">
             <button onclick="requestPayment(this,'${esc(p.userId)}','${esc(p.userEmail)}','${esc(p.handle||'')}','${esc(sweepId)}',${p.grossSats})"
               style="width:100%;background:#f7931a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;">
               Mark Paid
             </button>
           </div>`;

      return `
        <div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:14px;overflow:hidden;${isPaid ? 'opacity:0.65;' : ''}">
          <div style="background:#f9fafb;padding:12px 14px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:700;color:#111827;font-size:14px;">${esc(p.handle || 'No handle')}</div>
              <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(p.userEmail)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:11px;color:#6b7280;">${p.xpSold.toLocaleString()} XP</div>
            </div>
          </div>
          ${addrRow}
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid #f3f4f6;">
            <div style="padding:12px 14px;border-right:1px solid #f3f4f6;">
              <div style="font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Gross</div>
              <div style="font-size:13px;font-weight:600;color:#374151;">${p.grossSats.toLocaleString()}</div>
              <div style="font-size:11px;color:#9ca3af;">${satsUsd(p.grossSats)}</div>
            </div>
            <div style="padding:12px 14px;border-right:1px solid #f3f4f6;">
              <div style="font-size:10px;color:#f7931a;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">Fee 30%</div>
              <div style="font-size:13px;font-weight:600;color:#f7931a;">${p.feeSats.toLocaleString()}</div>
              <div style="font-size:11px;color:#fbbf24;">${satsUsd(p.feeSats)}</div>
            </div>
            <div style="padding:12px 14px;">
              <div style="font-size:10px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;">You Send</div>
              <div style="font-size:15px;font-weight:800;color:#16a34a;">${p.netSats.toLocaleString()}</div>
              <div style="font-size:11px;color:#86efac;">${satsUsd(p.netSats)}</div>
            </div>
          </div>
          ${actionRow}
        </div>`;
    }).join('');

  } catch (e) {
    container.innerHTML = `<p style="color:#dc2626;font-size:13px;">${esc(e.message)}</p>`;
  }
}

function requestPayment(btn, userId, userEmail, handle, sweepOrderId, grossSats) {
  const area = document.getElementById('pa-' + userId);
  if (!area) return;
  const safeUe = userEmail.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeHe = (handle || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeSo = (sweepOrderId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  area.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:9px;">
      <div style="font-size:11px;color:#dc2626;font-weight:700;">⚠️ Enter TXN / payment reference — this will be emailed to the seller</div>
      <input id="txni-${userId}" type="text" placeholder="BTC tx hash · Venmo ref · CashApp ID · etc."
        style="width:100%;box-sizing:border-box;border:2px solid #f7931a;border-radius:7px;padding:9px 11px;font-size:13px;outline:none;background:#fff;color:#111;" />
      <div style="display:flex;gap:8px;">
        <button onclick="loadPayoutReport()"
          style="flex:1;background:#e5e7eb;color:#374151;border:none;border-radius:7px;padding:9px;font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>
        <button id="txnbtn-${userId}" onclick="confirmMarkPaid('${userId}','${safeUe}','${safeHe}','${safeSo}',${grossSats})"
          style="flex:2;background:#f7931a;color:#fff;border:none;border-radius:7px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;">✓ Confirm &amp; Email Seller</button>
      </div>
    </div>`;
  document.getElementById('txni-' + userId)?.focus();
}

async function confirmMarkPaid(userId, userEmail, handle, sweepOrderId, grossSats) {
  const input = document.getElementById('txni-' + userId);
  const txNote = input ? input.value.trim() : '';
  if (!txNote) {
    if (input) { input.style.borderColor = '#dc2626'; input.focus(); }
    return;
  }
  const confirmBtn = document.getElementById('txnbtn-' + userId);
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Sending…'; }
  try {
    const token = await auth.currentUser.getIdToken(true);
    const res   = await fetch('/api/admin-mark-paid', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, userEmail, handle, sweepOrderId: sweepOrderId || null, grossSats, txNote }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    loadPayoutReport();
  } catch (e) {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✓ Confirm & Email Seller'; }
    alert('Error: ' + e.message);
  }
}

async function sendSweepSummary() {
  const result = document.getElementById('sweep-summary-result');
  result.style.display = 'none';
  try {
    const token = await auth.currentUser.getIdToken(true);
    const res   = await fetch('/api/admin-send-sweep-summary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    result.style.display = 'block';
    result.innerHTML = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:13px;color:#15803d;font-weight:700;">✓ Sweep summary + X thread sent to ${esc('contactfire757@gmail.com')}</div>`;
  } catch (e) {
    result.style.display = 'block';
    result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;font-size:13px;color:#dc2626;">Error: ${esc(e.message)}</div>`;
  }
}

async function sendBroadcast() {
  const btn    = document.getElementById('broadcast-send-btn');
  const result = document.getElementById('broadcast-result');
  if (!confirm('Send the payment profile email to ALL users? This cannot be undone.')) return;
  btn.disabled = true;
  btn.textContent = '⏳ Sending…';
  result.style.display = 'none';
  try {
    const token = await auth.currentUser.getIdToken(true);
    const res   = await fetch('/api/admin-broadcast-email', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    result.style.display = 'block';
    result.innerHTML = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;font-size:13px;color:#15803d;font-weight:700;">
      ✓ Broadcast sent — ${data.sent} emails delivered (${data.errors} errors) out of ${data.total} users
    </div>`;
    btn.textContent = '✓ Sent';
  } catch (e) {
    result.style.display = 'block';
    result.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;font-size:13px;color:#dc2626;">Error: ${esc(e.message)}</div>`;
    btn.disabled = false;
    btn.textContent = '📧 Send to All Users Now';
  }
}

window.loadPayoutReport  = loadPayoutReport;
window.requestPayment    = requestPayment;
window.confirmMarkPaid   = confirmMarkPaid;
window.copyPayoutAddr    = copyPayoutAddr;
window.sendBroadcast       = sendBroadcast;
window.sendSweepSummary    = sendSweepSummary;

// ── Fraud Dashboard ──────────────────────────────────────────────

function fraudUserRow(u, extraFlags = [], extraCell = '') {
  const handle = esc(u.nickname || u.email || u.uid || '');
  const uid    = esc(u.uid || '');
  const xp     = (u.totalSats || 0).toLocaleString();
  const today  = (u.satsToday || 0).toLocaleString();
  const flags  = [...extraFlags];
  if (u.flaggedMultiAccount) flags.push('<span style="background:#fef2f2;color:#dc2626;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">multi-acct</span>');
  if (u.flaggedReferralFraud) flags.push('<span style="background:#fff7ed;color:#c2410c;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">ref fraud</span>');
  if (u.frozen) flags.push('<span style="background:#eff6ff;color:#2563eb;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">frozen</span>');
  if (u.banned) flags.push('<span style="background:#111827;color:#f87171;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">BANNED</span>');
  const isBanned = !!u.banned;
  return `<tr style="border-bottom:1px solid #f3f4f6;">
    <td style="padding:9px 10px 9px 0;font-size:13px;font-weight:600;color:#111827;">${handle}</td>
    <td style="padding:9px 8px;font-size:11px;color:#9ca3af;font-family:monospace;">${uid.slice(0,10)}…</td>
    <td style="padding:9px 8px;font-size:13px;text-align:right;">${xp}</td>
    <td style="padding:9px 8px;font-size:13px;text-align:right;color:#f97316;font-weight:700;">${today}</td>
    <td style="padding:9px 8px;">${flags.join(' ')}${extraCell}</td>
    <td style="padding:9px 0 9px 8px;white-space:nowrap;">
      ${isBanned
        ? `<button onclick="banUser('${uid}','${handle}',false,'unban')" style="background:#d1fae5;color:#065f46;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;">Unban</button>`
        : `<button onclick="banUser('${uid}','${handle}',false,'ban')" style="background:#fef2f2;color:#dc2626;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;margin-right:4px;">Ban</button>
           <button onclick="banUser('${uid}','${handle}',true,'ban')" style="background:#111827;color:#f87171;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;cursor:pointer;">Ban + Zero XP</button>`
      }
    </td>
  </tr>`;
}

function fraudSection(title, color, rows) {
  if (!rows.length) return '';
  return `
    <div style="margin-bottom:32px;">
      <h3 style="font-size:14px;font-weight:700;color:${color};margin-bottom:10px;">${title} (${rows.length})</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="border-bottom:2px solid #e5e7eb;">
            <th style="text-align:left;padding:7px 10px 7px 0;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Handle</th>
            <th style="text-align:left;padding:7px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">UID</th>
            <th style="text-align:right;padding:7px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">XP Balance</th>
            <th style="text-align:right;padding:7px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Today</th>
            <th style="padding:7px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Flags</th>
            <th style="padding:7px 0 7px 8px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;">Actions</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </div>`;
}

async function loadFraud() {
  const container = document.getElementById('fraud-container');
  if (!container) return;
  container.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Loading…</div>';
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-fraud', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load fraud data');

    const { velocity = [], multiAccount = [], referralFraud = [], noImpressions = [], sharedIps = [], summary = {} } = data;
    const total = (velocity.length + multiAccount.length + referralFraud.length + noImpressions.length);

    if (!total && !sharedIps.length) {
      container.innerHTML = '<div style="color:#6b7280;font-size:13px;padding:20px 0;">No fraud signals detected.</div>';
      return;
    }

    const summaryHtml = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      ${[
        ['🚀 Velocity', summary.velocityFlags, '#dc2626'],
        ['👥 Multi-acct', summary.multiAccountFlags, '#c2410c'],
        ['🔗 Ref fraud', summary.referralFraudFlags, '#b45309'],
        ['👻 No impressions', summary.noImpressionHighBalance, '#6b7280'],
        ['🌐 Shared IPs', summary.sharedIpGroups, '#4f46e5'],
      ].map(([label, val, color]) => `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 16px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:${color};">${val || 0}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">${label}</div>
      </div>`).join('')}
    </div>
    ${velocity.length ? `<div style="margin-bottom:20px;">
      <button onclick="freezeAllVelocity()" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:700;cursor:pointer;width:100%;">
        🚨 Freeze All ${velocity.length} Velocity Abusers + Cancel Their Listings
      </button>
    </div>` : ''}`;

    const velocityRows    = velocity.map(u => {
      const imp = u.impressionsToday ?? null;
      const xpp = u.xpPerImpression ?? null;
      const impCell = imp !== null
        ? `<span style="display:inline-block;margin-left:6px;background:#fef9c3;color:#92400e;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">${imp.toLocaleString()} impressions${xpp ? ` · ${xpp} XP/imp` : ''}</span>`
        : '';
      return fraudUserRow(u, ['<span style="background:#fef2f2;color:#dc2626;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">⚡ velocity</span>'], impCell);
    });
    const multiRows       = multiAccount.map(u => fraudUserRow(u));
    const refRows         = referralFraud.map(u => fraudUserRow(u));
    const noImpRows       = noImpressions.map(u => fraudUserRow(u, ['<span style="background:#f3f4f6;color:#374151;border-radius:4px;padding:2px 6px;font-size:11px;font-weight:700;">no impressions</span>']));

    const sharedIpHtml = sharedIps.length ? `
      <div style="margin-bottom:32px;">
        <h3 style="font-size:14px;font-weight:700;color:#4f46e5;margin-bottom:10px;">🌐 Shared IPs today (${sharedIps.length})</h3>
        ${sharedIps.map(g => `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px;">
          <strong>${esc(g.ip)}</strong> — ${g.accountCount} accounts: <code style="font-size:11px;">${(g.uids||[]).join(', ')}</code>
        </div>`).join('')}
      </div>` : '';

    container.innerHTML = summaryHtml
      + fraudSection('⚡ Velocity abuse (near/over daily cap)', '#dc2626', velocityRows)
      + fraudSection('👥 Multi-account flags', '#c2410c', multiRows)
      + fraudSection('🔗 Referral fraud flags', '#b45309', refRows)
      + fraudSection('👻 High balance, zero impressions', '#6b7280', noImpRows)
      + sharedIpHtml
      + `<div style="font-size:12px;color:#9ca3af;">Generated ${esc(data.generatedAt || '')}</div>`;
  } catch (e) {
    container.innerHTML = `<div style="color:#dc2626;font-size:13px;">Error: ${esc(e.message)}</div>`;
  }
}

async function banUser(userId, handle, zeroXp, action = 'ban') {
  const verb = action === 'unban' ? 'Unban' : (zeroXp ? 'Ban and zero XP for' : 'Ban');
  if (!confirm(`${verb} @${handle}?`)) return;

  const reason = action === 'ban' ? (prompt('Reason (or leave blank for "Policy violation"):') || '') : '';

  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-ban', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action, reason, zeroXp: !!zeroXp }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    alert(`✓ ${action === 'unban' ? 'Unbanned' : 'Banned'}: ${handle}`);
    loadFraud();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function freezeAllVelocity() {
  if (!confirm('Freeze ALL velocity abusers, zero their XP, and cancel their open listings? This cannot be undone.')) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-freeze-batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    alert(`✓ Frozen ${data.frozenCount} accounts · ${data.listingsCancelled} listings cancelled`);
    loadFraud();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

window.loadFraud        = loadFraud;
window.banUser          = banUser;
window.freezeAllVelocity = freezeAllVelocity;
window.handleLogoUpload = handleLogoUpload;
window.updateLogoPreview = updateLogoPreview;
window.clearLogo        = clearLogo;
