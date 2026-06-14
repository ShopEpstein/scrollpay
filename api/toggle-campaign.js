const { admin, db } = require('./_firebase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const { adId, active } = req.body;

    if (!adId) return res.status(400).json({ error: 'Missing adId' });

    const ref = db.collection('sp_ads').doc(adId);
    const snap = await ref.get();

    if (!snap.exists) return res.status(404).json({ error: 'Campaign not found' });
    if (snap.data().ownerId !== decoded.uid) return res.status(403).json({ error: 'Forbidden' });

    await ref.update({ active: !!active });
    res.status(200).json({ ok: true });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
