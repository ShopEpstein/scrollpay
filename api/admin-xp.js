const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET' && req.query.status === 'recent-fulfilled') {
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', 'fulfilled')
        .limit(20)
        .get();
      const listings = [];
      snap.forEach(d => listings.push({ id: d.id, ...d.data() }));
      listings.sort((a, b) => (b.fulfilledAt?.seconds || 0) - (a.fulfilledAt?.seconds || 0));
      return res.status(200).json({ listings });
    }

    if (req.method === 'GET') {
      const status = req.query.status || 'open';
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', status)
        .limit(100)
        .get();
      const listings = [];
      snap.forEach(d => listings.push({ id: d.id, ...d.data() }));
      listings.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      // Enrich with nickname + refCode from sp_users (batch lookup by unique userId)
      const uids = [...new Set(listings.map(l => l.userId).filter(Boolean))];
      const userMap = {};
      await Promise.all(uids.map(async uid => {
        try {
          const userSnap = await db.collection('sp_users').doc(uid).get();
          if (userSnap.exists) {
            const u = userSnap.data();
            userMap[uid] = { nickname: u.nickname || '', refCode: u.refCode || '', balance: u.totalSats || 0 };
          }
        } catch (_) {}
      }));
      listings.forEach(l => {
        const u = userMap[l.userId] || {};
        l.nickname = u.nickname || '';
        l.refCode  = u.refCode  || '';
        l.balance  = u.balance  ?? null;
      });

      return res.status(200).json({ listings });
    }

    if (req.method === 'PATCH') {
      const { listingId, action } = req.body;
      if (!listingId || !action) return res.status(400).json({ error: 'Missing listingId or action' });

      const listingRef = db.collection('sp_xp_listings').doc(listingId);
      const listingSnap = await listingRef.get();
      if (!listingSnap.exists) return res.status(404).json({ error: 'Listing not found' });

      const listing = listingSnap.data();

      if (action === 'update-tx') {
        const { txHash, txChain, xpAmount } = req.body;
        const txChainNorm = (txChain || 'btc').toLowerCase();
        const explorerBase = {
          btc:  'https://mempool.space/tx/',
          sol:  'https://solscan.io/tx/',
          eth:  'https://etherscan.io/tx/',
          usdc: 'https://etherscan.io/tx/',
        }[txChainNorm] || 'https://mempool.space/tx/';
        const update = {
          txHash: txHash || '',
          txChain: txChainNorm,
          txUrl: txHash ? explorerBase + txHash : '',
        };
        if (xpAmount && parseInt(xpAmount) > 0) update.xpAmount = parseInt(xpAmount);
        await listingRef.update(update);
        return res.status(200).json({ ok: true });
      }

      if (action === 'fulfill' || action === 'cancel') {
        if (listing.status !== 'open') {
          return res.status(400).json({ error: `Listing is already ${listing.status}` });
        }
      }

      if (action === 'fulfill') {
        const { txHash, txChain } = req.body;
        const userRef = db.collection('sp_users').doc(listing.userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

        if ((userSnap.data().totalSats || 0) < listing.xpAmount) {
          return res.status(400).json({ error: 'User no longer has enough XP' });
        }

        await userRef.update({
          totalSats: admin.firestore.FieldValue.increment(-listing.xpAmount),
        });

        const txChainNorm = (txChain || 'btc').toLowerCase();
        const explorerBase = {
          btc:  'https://mempool.space/tx/',
          sol:  'https://solscan.io/tx/',
          eth:  'https://etherscan.io/tx/',
          usdc: 'https://etherscan.io/tx/',
        }[txChainNorm] || 'https://mempool.space/tx/';

        await listingRef.update({
          status: 'fulfilled',
          txHash: txHash || '',
          txChain: txChainNorm,
          txUrl: txHash ? explorerBase + txHash : '',
          fulfilledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: true });
      }

      if (action === 'cancel') {
        await listingRef.update({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
