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
    loadCampaigns();
    if (isAdminUser) { loadStats(); loadXpMarket(); loadFulfilledListings(); loadInbox(); loadPartners(); loadMiners(); }
  } else {
    showView('view-auth');
  }
});

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
  loadCampaigns();
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
  document.getElementById('stats-section').style.display = 'block';
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
  const section = document.getElementById('xp-market-section');
  const container = document.getElementById('xp-market-container');
  section.style.display = 'block';
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
  const section = document.getElementById('fulfilled-section');
  const container = document.getElementById('fulfilled-container');
  if (!container) return;
  if (section) section.style.display = 'block';
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
  const section = document.getElementById('inbox-section');
  const container = document.getElementById('inbox-container');
  section.style.display = 'block';
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

      return `<div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px;">
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

// ── SEO Partners (admin only) ────────────────────────────────────

let partnersData = [];

async function loadPartners() {
  const section = document.getElementById('partners-section');
  const container = document.getElementById('partners-container');
  section.style.display = 'block';
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

function openPartnerForm(p = null) {
  document.getElementById('partner-form-wrap').style.display = 'block';
  document.getElementById('partner-form-title').textContent = p ? 'Edit Partner' : 'Add Partner';
  document.getElementById('pf-id').value = p ? p.id : '';
  document.getElementById('pf-name').value = p ? p.name : '';
  document.getElementById('pf-slug').value = p ? p.slug : '';
  document.getElementById('pf-desc').value = p ? p.description : '';
  document.getElementById('pf-logo').value = p ? p.logo : '';
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
  const section = document.getElementById('miners-section');
  const container = document.getElementById('miners-container');
  section.style.display = 'block';
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
  container.querySelectorAll('.sort-miners-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      minerSort = btn.dataset.sort;
      renderMinersTable(allMiners);
    });
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
  return `<tr style="${fs >= 60 ? 'background:#fff5f5;' : fs >= 30 ? 'background:#fffbeb;' : ''}">
    <td style="font-size:12px;color:#6b7280">${u.signupNumber || '—'}</td>
    <td><strong>${u.nickname ? esc(u.nickname) : '<span style="color:#9ca3af">—</span>'}</strong></td>
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
