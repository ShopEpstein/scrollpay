const { admin, db, initError, verifyToken } = require('./_firebase');
const { sendEmail } = require('./_email');

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

      const uids = [...new Set(listings.map(l => l.userId).filter(Boolean))];
      const userMap = {};
      await Promise.all(uids.map(async uid => {
        try {
          const u = await db.collection('sp_users').doc(uid).get();
          if (u.exists) userMap[uid] = { nickname: u.data().nickname || '', refCode: u.data().refCode || '' };
        } catch (_) {}
      }));
      listings.forEach(l => {
        const u = userMap[l.userId] || {};
        l.nickname = u.nickname || '';
        l.refCode  = u.refCode  || '';
      });

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
        let { txHash, txChain, xpAmount } = req.body;
        const txChainNorm = (txChain || 'btc').toLowerCase();
        const explorerBase = {
          btc:  'https://mempool.space/tx/',
          sol:  'https://solscan.io/tx/',
          eth:  'https://etherscan.io/tx/',
          usdc: 'https://etherscan.io/tx/',
        }[txChainNorm] || 'https://mempool.space/tx/';
        // If user pasted a full explorer URL, extract just the hash
        if (txHash && txHash.startsWith('http')) {
          const parts = txHash.replace(/\?.*$/, '').split('/');
          txHash = parts[parts.length - 1];
        }
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
        let { txHash, txChain } = req.body;
        if (txHash && txHash.startsWith('http')) {
          const parts = txHash.replace(/\?.*$/, '').split('/');
          txHash = parts[parts.length - 1];
        }
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

        // Email seller
        try {
          const authUser = await admin.auth().getUser(listing.userId);
          if (authUser.email) {
            const xpFmt = Number(listing.xpAmount || 0).toLocaleString();
            const txLink = txHash ? `<p><a href="${explorerBase}${txHash}" style="color:#f97316;">View transaction ↗</a></p>` : '';
            sendEmail({
              to: authUser.email,
              subject: `Your XP listing has been fulfilled — ${xpFmt} XP sold`,
              html: `
                <h2 style="margin:0 0 8px;">XP Sold!</h2>
                <p style="color:#475569;">Your listing of <strong>${xpFmt} XP</strong> has been fulfilled. Payment has been sent via ${txChainNorm.toUpperCase()}.</p>
                ${txLink}
                <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
              `,
            });
          }
        } catch (_) {}

        return res.status(200).json({ ok: true });
      }

      if (action === 'cancel') {
        await listingRef.update({
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Email seller
        try {
          const authUser = await admin.auth().getUser(listing.userId);
          if (authUser.email) {
            const xpFmt = Number(listing.xpAmount || 0).toLocaleString();
            sendEmail({
              to: authUser.email,
              subject: `Your XP listing has been cancelled — ${xpFmt} XP`,
              html: `
                <h2 style="margin:0 0 8px;">Listing Cancelled</h2>
                <p style="color:#475569;">Your listing of <strong>${xpFmt} XP</strong> has been cancelled. Your XP balance has not been affected.</p>
                <p style="color:#475569;">If you have questions, visit <a href="https://scrollpay.app" style="color:#f97316;">scrollpay.app</a>.</p>
                <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
              `,
            });
          }
        } catch (_) {}

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
