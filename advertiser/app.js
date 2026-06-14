import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, query, where
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

// In-progress campaign data collected across steps
const draft = { brand: {}, ad: {}, budget: {} };

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
    if (isAdminUser) { loadStats(); loadXpMarket(); }
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

    container.querySelectorAll('.toggle-btn:not(.edit-btn)').forEach(btn => {
      btn.addEventListener('click', () =>
        toggleCampaign(btn.dataset.id, btn.dataset.active === 'true')
      );
    });
    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id, rows));
    });
  } catch (err) {
    container.innerHTML = `<div class="err-msg" style="padding:20px">Failed to load: ${esc(err.message)}</div>`;
  }
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
      <td style="white-space:nowrap">
        <button class="toggle-btn ${c.active ? 'live' : 'paused'}"
                data-id="${c.id}" data-active="${!!c.active}">
          ${c.active ? '● Live' : '○ Paused'}
        </button>
        ${adminMode ? `<button class="toggle-btn paused edit-btn" data-id="${c.id}" style="margin-left:6px">✏️ Edit</button>` : ''}
      </td>
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

document.getElementById('new-campaign-btn').addEventListener('click', () => {
  Object.assign(draft, { brand: {}, ad: {}, budget: {} });
  // Clear form fields
  ['brand-name','brand-logo','brand-website','ad-headline','ad-cta','ad-url','daily-budget','total-budget']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('headline-chars').textContent = '0';
  hide('campaign-summary');
  hide('launch-error');
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
document.getElementById('step2-next').addEventListener('click', () => {
  const headline = document.getElementById('ad-headline').value.trim();
  const ctaText = document.getElementById('ad-cta').value.trim();
  const ctaUrl = document.getElementById('ad-url').value.trim();
  if (!headline || !ctaText || !ctaUrl) return alert('Please fill in all ad fields.');
  draft.ad = { headline, ctaText, ctaUrl };
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
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="summary-title">Campaign summary</div>
    <div class="summary-row"><span>Brand</span><span>${esc(draft.brand.name || '—')}</span></div>
    <div class="summary-row"><span>Headline</span><span>"${esc(draft.ad.headline || '—')}"</span></div>
    <div class="summary-row"><span>CTA button</span><span>${esc(draft.ad.ctaText || '—')}</span></div>
    <div class="summary-row"><span>Destination</span><span>${esc(draft.ad.ctaUrl || '—')}</span></div>
    <div class="summary-row"><span>Daily budget</span><span>${daily ? daily.toLocaleString() + ' XP / day' : '—'}</span></div>
    <div class="summary-row"><span>Total budget</span><span>${total ? total.toLocaleString() + ' XP' : '—'}</span></div>`;
}

document.getElementById('launch-btn').addEventListener('click', async () => {
  const daily = parseInt(document.getElementById('daily-budget').value);
  const total = parseInt(document.getElementById('total-budget').value);
  const btn = document.getElementById('launch-btn');

  hide('launch-error');

  btn.disabled = true;
  btn.textContent = 'Launching…';

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
        dailyBudgetXp: daily || 0,
        totalBudgetXp: total || 0,
      }),
    });

    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Server error'); }

    showView('view-dashboard');
    loadCampaigns();
  } catch (err) {
    showError('launch-error', 'Launch failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = '🚀 Launch Campaign';
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

function copyAddr(addr) {
  navigator.clipboard.writeText(addr).then(() => {
    const prev = event.target.textContent;
    event.target.textContent = '✓';
    setTimeout(() => { event.target.textContent = prev; }, 1500);
  }).catch(() => prompt('Copy address:', addr));
}

document.getElementById('stats-refresh')?.addEventListener('click', loadStats);

// ── XP Marketplace (admin only) ─────────────────────────────────

async function loadXpMarket() {
  const section = document.getElementById('xp-market-section');
  const container = document.getElementById('xp-market-container');
  section.style.display = 'block';
  container.innerHTML = '<div class="loading">Loading sell requests…</div>';

  try {
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

    container.innerHTML = `
      <table class="campaigns-table">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Handle / Ref</th>
            <th>XP to sell</th>
            <th>Sats to pay</th>
            <th>BTC / Lightning address</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${listings.map(l => `
            <tr>
              <td style="font-size:12px">
                ${l.userEmail ? `<a href="mailto:${esc(l.userEmail)}" style="color:#f7931a">${esc(l.userEmail)}</a>` : '<span style="color:#9ca3af">—</span>'}
              </td>
              <td style="font-size:12px;color:#6b7280">
                ${l.nickname ? `<strong style="color:#111">${esc(l.nickname)}</strong><br>` : ''}
                <span style="font-family:monospace;font-size:11px">${esc(l.refCode || '—')}</span>
              </td>
              <td><strong>${(l.xpAmount || 0).toLocaleString()} XP</strong></td>
              <td style="color:#f7931a;font-weight:700;font-size:15px">${(l.satsRequested || 0).toLocaleString()} sats</td>
              <td style="font-size:12px;font-family:monospace;word-break:break-all">
                ${esc(l.btcAddress || '—')}
                ${l.btcAddress ? `<button onclick="copyAddr('${esc(l.btcAddress)}')" style="margin-left:6px;padding:2px 7px;font-size:11px;cursor:pointer;border:1px solid #e5e7eb;border-radius:4px;background:#f9fafb">📋</button>` : ''}
              </td>
              <td style="white-space:nowrap">
                <button class="toggle-btn live" data-listing-id="${l.id}" data-action="fulfill">✓ Fulfill</button>
                <button class="toggle-btn paused" data-listing-id="${l.id}" data-action="cancel" style="margin-left:6px">✕ Cancel</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

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
  if (!confirm(action === 'fulfill'
    ? 'Mark as fulfilled? This will deduct XP from the user\'s balance.'
    : 'Cancel this listing?')) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin-xp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ listingId, action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    loadXpMarket();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

document.getElementById('xp-market-refresh')?.addEventListener('click', loadXpMarket);

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
