const { admin, db, initError } = require('./_firebase');

// PATCH: seller accepts/rejects/counters OR buyer accepts/rejects a counter
module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { offerId, refCode, action, counterPricePerXp } = req.body || {};
  if (!offerId || !refCode || !action)
    return res.status(400).json({ error: 'Missing offerId, refCode, or action.' });
  if (!['accept', 'reject', 'counter'].includes(action))
    return res.status(400).json({ error: 'action must be accept, reject, or counter.' });

  try {
    const offerRef = db.collection('sp_offers').doc(offerId);
    const offerSnap = await offerRef.get();
    if (!offerSnap.exists) return res.status(404).json({ error: 'Offer not found.' });
    const offer = offerSnap.data();

    // Resolve who is calling
    const userSnap = await db.collection('sp_users')
      .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
    if (userSnap.empty) return res.status(404).json({ error: 'Referral code not found.' });
    const uid = userSnap.docs[0].id;

    const isSeller = uid === offer.sellerUid;
    const isBuyer  = uid === offer.buyerUid;
    if (!isSeller && !isBuyer) return res.status(403).json({ error: 'Not your offer.' });

    // Sellers can act on pending; buyers can act on countered
    if (isSeller && offer.status !== 'pending')
      return res.status(400).json({ error: `Offer is already ${offer.status}.` });
    if (isBuyer && offer.status !== 'countered')
      return res.status(400).json({ error: `Offer is ${offer.status} — no counter to respond to.` });
    if (isBuyer && action === 'counter')
      return res.status(400).json({ error: 'Buyers cannot counter — only accept or reject.' });

    let update = { status: action === 'counter' ? 'countered' : action === 'accept' ? 'accepted' : 'rejected',
                   updatedAt: admin.firestore.FieldValue.serverTimestamp() };

    if (action === 'counter') {
      const counter = parseInt(counterPricePerXp);
      if (!counter || counter < 1) return res.status(400).json({ error: 'Counter price must be ≥ 1 sat / XP.' });
      update.counterPricePerXp = counter;
    }

    await offerRef.update(update);
    return res.status(200).json({ success: true, ...update, updatedAt: Date.now() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
