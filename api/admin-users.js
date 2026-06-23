const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

// Simple heuristic fraud score (0–100). Higher = more suspicious.
function fraudScore(u) {
  let score = 0;
  const daysSinceSignup = u.installedAt
    ? Math.max(1, (Date.now() / 1000 - u.installedAt) / 86400)
    : 30;
  const xpPerDay = u.totalSats / daysSinceSignup;

  // Extremely high daily XP today
  if (u.satsToday > 500)  score += 30;
  else if (u.satsToday > 200) score += 15;

  // Very high lifetime XP relative to impressions
  // Legit ratio: ~10 XP per impression. >50 XP/impression is sus.
  if (u.totalImpressions > 0) {
    const ratio = u.totalSats / u.totalImpressions;
    if (ratio > 200) score += 35;
    else if (ratio > 50) score += 15;
  } else if (u.totalSats > 500) {
    // High XP with zero impressions = likely API abuse
    score += 40;
  }

  // Many referrals but young account
  if (u.referralCount > 20) score += 25;
  else if (u.referralCount > 10) score += 10;

  // Override XP is very high (farming via downline bots)
  if (u.overrideXp > 1000) score += 20;

  return Math.min(score, 100);
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const snap = await db.collection('sp_users').limit(1000).get();
      const users = [];
      snap.forEach(d => {
        const u = d.data();
        const row = {
          id: d.id,
          email: u.email || '',
          nickname: u.nickname || '',
          totalSats: u.totalSats || 0,
          satsToday: u.satsToday || 0,
          referralCount: u.referralCount || 0,
          signupNumber: u.signupNumber || 0,
          refCode: u.refCode || '',
          lastActiveAt: u.lastActiveAt?._seconds || u.lastActiveAt?.seconds || null,
          totalImpressions: u.totalImpressions || 0,
          impressionsToday: u.impressionsToday || 0,
          overrideXp: u.overrideXp || 0,
          downlineSize: u.downlineSize || 0,
          downlineXp: u.downlineXp || 0,
          installedAt: u.installedAt?._seconds || u.installedAt?.seconds || null,
          // Payment methods
          btcAddress: u.btcAddress || '',
          solAddress: u.solAddress || '',
          ethAddress: u.ethAddress || '',
          venmo:      u.venmo      || '',
          cashapp:    u.cashapp    || '',
          applepay:   u.applepay   || '',
          paypal:     u.paypal     || '',
          zelle:      u.zelle      || '',
        };
        row.fraudScore = fraudScore(row);
        users.push(row);
      });
      users.sort((a, b) => (a.signupNumber || 999999) - (b.signupNumber || 999999));
      return res.status(200).json({ users });
    }

    if (req.method === 'POST') {
      const { userId, refCode, text } = req.body || {};
      if (!userId || !text?.trim()) {
        return res.status(400).json({ error: 'Missing userId or text' });
      }
      await db.collection('sp_inbox').add({
        userId,
        refCode: (refCode || '').toUpperCase(),
        userEmail: '',
        userHandle: '',
        from: 'admin',
        text: text.trim(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ ok: true });
    }

    // PATCH: adjust XP or send password reset
    if (req.method === 'PATCH') {
      const { userId, adjustXp, note, action } = req.body || {};

      // Send password reset email
      if (action === 'reset-password') {
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        const authUser = await admin.auth().getUser(userId);
        if (!authUser.email) return res.status(400).json({ error: 'User has no email address' });
        const link = await admin.auth().generatePasswordResetLink(authUser.email);
        const { sendEmail } = require('./_email');
        await sendEmail({
          to: authUser.email,
          subject: 'ScrollPay — Sign in to your account',
          html: `
            <h2 style="margin:0 0 8px;">Sign in to ScrollPay</h2>
            <p style="color:#475569;">Use the link below to sign in and access your account. The link expires in 1 hour.</p>
            <p><a href="${link}" style="color:#f97316;font-weight:700;">Sign in now ↗</a></p>
            <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
          `,
        });
        return res.status(200).json({ ok: true, email: authUser.email });
      }

      // Adjust XP
      if (!userId || typeof adjustXp !== 'number') {
        return res.status(400).json({ error: 'Missing userId or adjustXp' });
      }
      const userRef = db.collection('sp_users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'User not found' });
      const current = snap.data().totalSats || 0;
      const newTotal = Math.max(0, current + adjustXp);
      await userRef.update({
        totalSats: newTotal,
        lastAdminNote: note || `Admin adjusted XP by ${adjustXp}`,
        lastAdminAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ ok: true, newTotal });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
