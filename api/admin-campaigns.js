const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const snap = await db.collection('sp_ads').get();
      const campaigns = [];
      snap.forEach(d => campaigns.push({ id: d.id, ...d.data() }));
      campaigns.sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
      return res.status(200).json({ campaigns });
    }

    if (req.method === 'PATCH') {
      const { adId, ...updates } = req.body;
      if (!adId) return res.status(400).json({ error: 'Missing adId' });
      delete updates.ownerId;
      delete updates.ownerEmail;
      delete updates.createdAt;
      await db.collection('sp_ads').doc(adId).update(updates);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
