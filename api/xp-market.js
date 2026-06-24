const { admin, db, initError } = require('./_firebase');

const MIN_SELL_XP = 100;
const MIN_PRICE_SATS = 1;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  if (req.method === 'GET' && req.query.chart) {
    try {
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', 'fulfilled')
        .limit(500)
        .get();
      const points = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.pricePerXp && data.fulfilledAt) {
          points.push({
            price: data.pricePerXp,
            xp: data.xpAmount || 0,
            t: data.fulfilledAt._seconds || 0,
          });
        }
      });
      points.sort((a, b) => a.t - b.t);
      return res.status(200).json({ points });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

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

      const existing = await db.collection('sp_xp_listings')
        .where('userId', '==', userDoc.id)
        .where('status', '==', 'open')
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(400).json({ error: 'You already have an open listing. Cancel it first.' });
      }

      // Block if user also has an open SCROLL market ask for the same XP
      const scrollAskSnap = await db.collection('sp_scroll_orders')
        .where('userId', '==', userDoc.id)
        .where('type', '==', 'ask')
        .where('status', '==', 'open')
        .limit(1).get();
      if (!scrollAskSnap.empty) {
        return res.status(409).json({ error: 'You have an open SCROLL market sell order. Cancel it first — the same XP cannot be listed in both markets.' });
      }

      const satsRequested = amount * price;
      const listingRef = db.collection('sp_xp_listings').doc();

      // Atomically deduct XP and create listing to prevent double-spend
      await db.runTransaction(async (tx) => {
        const uRef  = db.collection('sp_users').doc(userDoc.id);
        const uSnap = await tx.get(uRef);
        const balance = uSnap.data().totalSats || 0;
        if (balance < amount) {
          throw Object.assign(new Error(`Insufficient XP. Your balance: ${balance.toLocaleString()} XP`), { status: 400 });
        }
        tx.update(uRef, { totalSats: admin.firestore.FieldValue.increment(-amount) });
        tx.set(listingRef, {
          userId:       userDoc.id,
          userEmail:    userData.email || '',
          xpAmount:     amount,
          pricePerXp:   price,
          satsRequested,
          btcAddress:   btcAddress.trim(),
          xpEscrowed:   true,
          status:       'open',
          createdAt:    admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return res.status(200).json({ id: listingRef.id, satsRequested, pricePerXp: price });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  // DELETE — cancel an open listing and return escrowed XP
  if (req.method === 'DELETE') {
    const { listingId, refCode } = req.body || {};
    if (!listingId || !refCode) return res.status(400).json({ error: 'listingId and refCode required' });

    try {
      const userSnap = await db.collection('sp_users')
        .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
      if (userSnap.empty) return res.status(404).json({ error: 'Ref code not found' });
      const userId = userSnap.docs[0].id;

      const listingRef = db.collection('sp_xp_listings').doc(listingId);

      await db.runTransaction(async (tx) => {
        const lSnap = await tx.get(listingRef);
        if (!lSnap.exists) throw Object.assign(new Error('Listing not found'), { status: 404 });
        const listing = lSnap.data();
        if (listing.userId !== userId) throw Object.assign(new Error('Not your listing'), { status: 403 });
        if (listing.status !== 'open') throw Object.assign(new Error(`Listing is already ${listing.status}`), { status: 400 });

        tx.update(listingRef, {
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Return escrowed XP
        if (listing.xpEscrowed) {
          tx.update(db.collection('sp_users').doc(userId), {
            totalSats: admin.firestore.FieldValue.increment(listing.xpAmount || 0),
          });
        }
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
