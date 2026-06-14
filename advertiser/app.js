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
  ['view-auth', 'view-dashboard', 'view-create'].forEach(v =>
    document.getElementById(v).classList.toggle('hidden', v !== id)
  );
  document.getElementById('main-nav').classList.toggle('hidden', id === 'view-auth');
}

// ── Auth ────────────────────────────────────────────────────────

onAuthStateChanged(auth, user => {
  if (user) {
    const isAdminUser = user.email === ADMIN_EMAIL;
    document.getElementById('nav-email').textContent =
      user.email + (isAdminUser ? ' ⚡ Admin' : '');
    showView('view-dashboard');
    loadCampaigns();
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
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load');
      rows = (await res.json()).campaigns || [];
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

    container.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        toggleCampaign(btn.dataset.id, btn.dataset.active === 'true')
      );
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
      <td>
        <button class="toggle-btn ${c.active ? 'live' : 'paused'}"
                data-id="${c.id}" data-active="${!!c.active}">
          ${c.active ? '● Live' : '○ Paused'}
        </button>
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
