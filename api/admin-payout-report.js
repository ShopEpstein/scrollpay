const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const PLATFORM_FEE = 0.30;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const sweepOrderId = req.query.sweepOrderId || null;

    // Single equality filter only — avoids composite index requirement.
    // Filter txChain/sweepOrderId in JS after fetching.
    const baseQuery = sweepOrderId
      ? db.collection('sp_xp_listings').where('sweepOrderId', '==', sweepOrderId).limit(500)
      : db.collection('sp_xp_listings').where('status', '==', 'fulfilled').limit(500);

    const rawSnap = await baseQuery.get();

    const listingDocs = rawSnap.docs.filter(d => {
      const l = d.data();
      if (sweepOrderId) return true;
      return l.txChain === 'internal';
    });

    if (listingDocs.length === 0) {
      return res.status(200).json({ payouts: [], totalGrossSats: 0, totalNetSats: 0, totalFeeSats: 0, totalXp: 0 });
    }

    // Group by userId
    const byUser = {};
    listingDocs.forEach(d => {
      const l = d.data();
      const uid = l.userId;
      if (!byUser[uid]) {
        byUser[uid] = { userId: uid, userEmail: l.userEmail || '', xpSold: 0, grossSats: 0, listings: [] };
      }
      const sats = (l.pricePerXp || 0) * (l.xpAmount || 0);
      byUser[uid].xpSold    += l.xpAmount || 0;
      byUser[uid].grossSats += sats;
      byUser[uid].listings.push({
        id: d.id,
        xpAmount: l.xpAmount,
        pricePerXp: l.pricePerXp,
        sats,
        fulfilledAt: l.fulfilledAt ? new Date(l.fulfilledAt._seconds * 1000).toISOString() : null,
        sweepOrderId: l.sweepOrderId || null,
      });
    });

    // Compute fee/net per user
    Object.values(byUser).forEach(u => {
      u.feeSats = Math.round(u.grossSats * PLATFORM_FEE);
      u.netSats = u.grossSats - u.feeSats;
    });

    // Enrich with handle + payment addresses
    const uids = Object.keys(byUser);
    await Promise.all(uids.map(async uid => {
      try {
        const snap = await db.collection('sp_users').doc(uid).get();
        if (snap.exists) {
          const u = snap.data();
          byUser[uid].handle     = u.nickname   || null;
          byUser[uid].btcAddress = u.btcAddress || '';
          byUser[uid].solAddress = u.solAddress || '';
          byUser[uid].venmo      = u.venmo      || '';
          byUser[uid].cashapp    = u.cashapp    || '';
        }
      } catch (_) {}
    }));

    // Fetch paid status from sp_payouts
    const paidSnap = sweepOrderId
      ? await db.collection('sp_payouts').where('sweepOrderId', '==', sweepOrderId).get()
      : await db.collection('sp_payouts').limit(500).get();

    const paidMap = {};
    paidSnap.forEach(d => {
      const p = d.data();
      if (p.userId) paidMap[p.userId] = {
        paidAt:    p.paidAt ? new Date(p.paidAt._seconds * 1000).toISOString() : null,
        netSats:   p.netSats,
        txNote:    p.txNote    || '',
        emailSent: p.emailSent || false,
      };
    });

    Object.values(byUser).forEach(u => {
      u.paid = paidMap[u.userId] || null;
    });

    const payouts = Object.values(byUser).sort((a, b) => b.grossSats - a.grossSats);
    const totalGrossSats = payouts.reduce((s, p) => s + p.grossSats, 0);
    const totalFeeSats   = payouts.reduce((s, p) => s + p.feeSats,   0);
    const totalNetSats   = payouts.reduce((s, p) => s + p.netSats,   0);
    const totalXp        = payouts.reduce((s, p) => s + p.xpSold,    0);

    return res.status(200).json({ payouts, totalGrossSats, totalFeeSats, totalNetSats, totalXp, count: payouts.length });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};

