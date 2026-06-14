const { admin, db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  // ── GET: list offers on a listing (seller) or made by a buyer ──
  if (req.method === 'GET') {
    const { listingId, sellerRefCode, buyerRefCode } = req.query;
    try {
      if (sellerRefCode) {
        // Seller checking incoming offers on their listing
        if (!listingId) return res.status(400).json({ error: 'Missing listingId.' });
        const listingSnap = await db.collection('sp_xp_listings').doc(listingId).get();
        if (!listingSnap.exists) return res.status(404).json({ error: 'Listing not found.' });
        const sellerSnap = await db.collection('sp_users')
          .where('refCode', '==', sellerRefCode.toUpperCase().trim()).limit(1).get();
        if (sellerSnap.empty) return res.status(404).json({ error: 'Seller not found.' });
        if (listingSnap.data().userId !== sellerSnap.docs[0].id)
          return res.status(403).json({ error: 'Not your listing.' });
        const snap = await db.collection('sp_offers').where('listingId', '==', listingId).limit(50).get();
        const offers = [];
        snap.forEach(d => offers.push({ id: d.id, ...serializeOffer(d.data()) }));
        offers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.status(200).json({ offers });
      }
      if (buyerRefCode) {
        // Buyer checking offers they've made
        const buyerSnap = await db.collection('sp_users')
          .where('refCode', '==', buyerRefCode.toUpperCase().trim()).limit(1).get();
        if (buyerSnap.empty) return res.status(404).json({ error: 'Buyer not found.' });
        const snap = await db.collection('sp_offers')
          .where('buyerUid', '==', buyerSnap.docs[0].id).limit(50).get();
        const offers = [];
        snap.forEach(d => offers.push({ id: d.id, ...serializeOffer(d.data()) }));
        offers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.status(200).json({ offers });
      }
      return res.status(400).json({ error: 'Provide sellerRefCode or buyerRefCode.' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: create an offer ──
  if (req.method === 'POST') {
    const { listingId, buyerRefCode, proposedPricePerXp, message } = req.body || {};
    if (!listingId || !buyerRefCode || !proposedPricePerXp)
      return res.status(400).json({ error: 'Missing listingId, buyerRefCode, or proposedPricePerXp.' });
    const price = parseInt(proposedPricePerXp);
    if (!price || price < 1) return res.status(400).json({ error: 'Price must be at least 1 sat / XP.' });

    try {
      const buyerSnap = await db.collection('sp_users')
        .where('refCode', '==', buyerRefCode.toUpperCase().trim()).limit(1).get();
      if (buyerSnap.empty) return res.status(404).json({ error: 'Referral code not found.' });
      const buyerDoc = buyerSnap.docs[0];
      const buyerData = buyerDoc.data();

      const listingRef = db.collection('sp_xp_listings').doc(listingId);
      const listingSnap = await listingRef.get();
      if (!listingSnap.exists) return res.status(404).json({ error: 'Listing not found.' });
      const listing = listingSnap.data();
      if (listing.status !== 'open') return res.status(400).json({ error: 'Listing is no longer open.' });
      if (listing.userId === buyerDoc.id)
        return res.status(400).json({ error: 'Cannot offer on your own listing.' });

      const offerRef = await db.collection('sp_offers').add({
        listingId,
        sellerUid: listing.userId,
        buyerUid: buyerDoc.id,
        buyerHandle: buyerData.nickname || `Miner #${buyerData.signupNumber || '?'}`,
        buyerRefCode: buyerRefCode.toUpperCase().trim(),
        originalPricePerXp: listing.pricePerXp,
        xpAmount: listing.xpAmount,
        proposedPricePerXp: price,
        message: String(message || '').trim().slice(0, 500),
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true, offerId: offerRef.id, proposedPricePerXp: price });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

function serializeOffer(d) {
  return {
    ...d,
    createdAt: d.createdAt?.toMillis?.() || null,
    updatedAt: d.updatedAt?.toMillis?.() || null,
  };
}
