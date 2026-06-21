const { db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = (req.query.userId || '').trim();
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const [userSnap, listingsSnap] = await Promise.all([
      db.collection('sp_users').doc(userId).get(),
      db.collection('sp_xp_listings')
        .where('userId', '==', userId)
        .where('status', '==', 'open')
        .get(),
    ]);

    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

    const minedXp     = userSnap.data().totalSats || 0;
    const listedXp    = listingsSnap.docs.reduce((sum, d) => sum + (d.data().xpAmount || 0), 0);
    const availableXp = Math.max(0, minedXp - listedXp);

    return res.status(200).json({ minedXp, listedXp, availableXp });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
