const { admin, db, initError } = require('./_firebase');

const MIN_SELL_XP = 100;
const MIN_PRICE_SATS = 1;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  if (req.method === 'GET' && req.query.status === 'fulfilled') {
    try {
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', 'fulfilled')
        .limit(20)
        .get();
      const listings = [];
      snap.forEach(d => {
        const data = d.data();
        if (!data.txHash) return; // only show verified payouts
        listings.push({
          id: d.id,
          xpAmount: data.xpAmount,
          pricePerXp: data.pricePerXp || 0,
          satsRequested: data.satsRequested || 0,
          txHash: data.txHash || '',
          txChain: data.txChain || 'btc',
          txUrl: data.txUrl || '',
          fulfilledAt: data.fulfilledAt,
        });
      });
      listings.sort((a, b) => (b.fulfilledAt?._seconds || 0) - (a.fulfilledAt?._seconds || 0));
      return res.status(200).json({ listings });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    const { refCode } = req.query;
    if (refCode) {
      try {
        const userSnap = await db.collection('sp_users')
          .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
        if (userSnap.empty) return res.status(404).json({ error: 'Referral code not found.' });
        const uid = userSnap.docs[0].id;
        const snap = await db.collection('sp_xp_listings')
          .where('userId', '==', uid)
          .where('status', '==', 'open')
          .limit(20)
          .get();
        const listings = [];
        snap.forEach(d => {
          const data = d.data();
          listings.push({ id: d.id, xpAmount: data.xpAmount, pricePerXp: data.pricePerXp, satsRequested: data.satsRequested });
        });
        return res.status(200).json({ listings });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    try {
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', 'open')
        .limit(100)
        .get();
      const listings = [];
      snap.forEach(d => {
        const data = d.data();
        listings.push({
          id: d.id,
          xpAmount: data.xpAmount,
          pricePerXp: data.pricePerXp,
          satsRequested: data.satsRequested,
          createdAt: data.createdAt,
        });
      });
      // Cheapest first; ties broken by creation time — no composite index needed
      listings.sort((a, b) => {
        if (a.pricePerXp !== b.pricePerXp) return a.pricePerXp - b.pricePerXp;
        return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
      });
      return res.status(200).json({ listings });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { refCode, xpAmount, pricePerXp, btcAddress } = req.body;
    if (!refCode || !xpAmount || !pricePerXp || !btcAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const amount = parseInt(xpAmount);
    const price  = parseInt(pricePerXp);
    if (!amount || amount < MIN_SELL_XP) {
      return res.status(400).json({ error: `Minimum sell amount is ${MIN_SELL_XP} XP` });
    }
    if (!price || price < MIN_PRICE_SATS) {
      return res.status(400).json({ error: `Minimum price is ${MIN_PRICE_SATS} sat per XP` });
    }

    try {
      const snap = await db.collection('sp_users')
        .where('refCode', '==', refCode.toUpperCase().trim())
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(404).json({ error: 'No account found with that referral code' });
      }

      const userDoc = snap.docs[0];
      const userData = userDoc.data();

      if ((userData.totalSats || 0) < amount) {
        return res.status(400).json({
          error: `Insufficient XP. Your balance: ${userData.totalSats || 0} XP`
        });
      }

      const existing = await db.collection('sp_xp_listings')
        .where('userId', '==', userDoc.id)
        .where('status', '==', 'open')
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(400).json({ error: 'You already have an open listing. Cancel it first.' });
      }

      const satsRequested = amount * price;
      const ref = await db.collection('sp_xp_listings').add({
        userId: userDoc.id,
        userEmail: userData.email || '',
        xpAmount: amount,
        pricePerXp: price,
        satsRequested,
        btcAddress: btcAddress.trim(),
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ id: ref.id, satsRequested, pricePerXp: price });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
