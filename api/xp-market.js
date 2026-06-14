const { admin, db, initError } = require('./_firebase');

const XP_RATE_SATS = 10; // 1 XP = 10 sats (~$0.01 at $100k BTC)
const MIN_SELL_XP = 100;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('sp_xp_listings')
        .where('status', '==', 'open')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      const listings = [];
      snap.forEach(d => {
        const data = d.data();
        listings.push({
          id: d.id,
          xpAmount: data.xpAmount,
          satsRequested: data.satsRequested,
          createdAt: data.createdAt,
        });
      });
      return res.status(200).json({ listings, ratePerXp: XP_RATE_SATS });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { refCode, xpAmount, btcAddress } = req.body;
    if (!refCode || !xpAmount || !btcAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const amount = parseInt(xpAmount);
    if (!amount || amount < MIN_SELL_XP) {
      return res.status(400).json({ error: `Minimum sell amount is ${MIN_SELL_XP} XP` });
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

      // Check no other open listing from this user
      const existing = await db.collection('sp_xp_listings')
        .where('userId', '==', userDoc.id)
        .where('status', '==', 'open')
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(400).json({ error: 'You already have an open listing. Cancel it first.' });
      }

      const satsRequested = amount * XP_RATE_SATS;
      const ref = await db.collection('sp_xp_listings').add({
        userId: userDoc.id,
        userEmail: userData.email || '',
        xpAmount: amount,
        satsRequested,
        btcAddress: btcAddress.trim(),
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ id: ref.id, satsRequested, ratePerXp: XP_RATE_SATS });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
