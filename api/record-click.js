const { admin, db, initError } = require('./_firebase');

// Fire-and-forget click counter — increments sp_ads.clicks using Admin SDK
// (Firestore client rules block this from the extension directly).
// No XP is involved here — XP is awarded separately in background.js.
module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adId } = req.body;
  if (!adId || typeof adId !== 'string' || adId.length > 128) {
    return res.status(400).json({ error: 'Invalid adId' });
  }

  try {
    await db.collection('sp_ads').doc(adId).update({
      clicks: admin.firestore.FieldValue.increment(1),
    });
    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(200).json({ ok: false });
  }
};
