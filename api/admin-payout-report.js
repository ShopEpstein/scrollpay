const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

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

    // Query fulfilled sweep listings (txChain = 'internal' = fulfilled via admin sweep)
    // Optionally filter by sweepOrderId
    const sweepOrderId = req.query.sweepOrderId || null;

    // Single equality filter only — avoids composite index requirement.
    // Filter txChain/sweepOrderId in JS after fetching.
    const baseQuery = sweepOrderId
      ? db.collection('sp_xp_listings').where('sweepOrderId', '==', sweepOrderId).limit(500)
      : db.collection('sp_xp_listings').where('status', '==', 'fulfilled').limit(500);

    const rawSnap = await baseQuery.get();

    // Apply remaining filters in JS
    const listingDocs = rawSnap.docs.filter(d => {
      const l = d.data();
      if (sweepOrderId) return true; // sweepOrderId filter already applied
      return l.txChain === 'internal';
    });

    // Wrap in an object that mimics QuerySnapshot.forEach / .empty
    const listingsSnap = {
      empty: listingDocs.length === 0,
      forEach: cb => listingDocs.forEach(cb),
    };

    if (listingsSnap.empty) {
      return res.status(200).json({ payouts: [], totalSats: 0, totalXp: 0 });
    }

    // Group by userId so multiple listings from same seller are merged
    const byUser = {};
    listingsSnap.forEach(d => {
      const l = d.data();
      const uid = l.userId;
      if (!byUser[uid]) {
        byUser[uid] = {
          userId: uid,
          userEmail: l.userEmail || '',
          xpSold: 0,
          satsOwed: 0,
          listings: [],
        };
      }
      const sats = (l.pricePerXp || 0) * (l.xpAmount || 0);
      byUser[uid].xpSold    += l.xpAmount || 0;
      byUser[uid].satsOwed  += sats;
      byUser[uid].listings.push({
        id: d.id,
        xpAmount: l.xpAmount,
        pricePerXp: l.pricePerXp,
        sats,
        fulfilledAt: l.fulfilledAt ? new Date(l.fulfilledAt._seconds * 1000).toISOString() : null,
        sweepOrderId: l.sweepOrderId || null,
      });
    });

    // Enrich with handle + payment addresses from sp_users
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

    const payouts = Object.values(byUser).sort((a, b) => b.satsOwed - a.satsOwed);
    const totalSats = payouts.reduce((s, p) => s + p.satsOwed, 0);
    const totalXp   = payouts.reduce((s, p) => s + p.xpSold, 0);

    return res.status(200).json({ payouts, totalSats, totalXp, count: payouts.length });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
