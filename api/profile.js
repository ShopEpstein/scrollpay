const { admin, db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (initError) return res.status(500).json({ error: initError.message });

  // GET /api/profile?handle=satoshi_21
  if (req.method === 'GET') {
    const handle = (req.query.handle || '').trim().toLowerCase();
    if (!handle) return res.status(400).json({ error: 'Missing handle' });

    try {
      const snap = await db.collection('sp_users')
        .where('nickname', '==', handle)
        .limit(1)
        .get();

      if (snap.empty) return res.status(404).json({ error: 'Profile not found' });

      const data = snap.docs[0].data();
      const userXp = data.totalSats || 0;

      const aboveSnap = await db.collection('sp_users')
        .where('totalSats', '>', userXp)
        .get();
      const xpRank = aboveSnap.size + 1;

      const profile = {
        handle:       data.nickname     || handle,
        refCode:      data.refCode      || '',
        xp:           userXp,
        xpRank,
        signupNumber: data.signupNumber || null,
        bio:          data.bio          || '',
        twitter:      data.twitter      || '',
        instagram:    data.instagram    || '',
        telegram:     data.telegram     || '',
        website:      data.website      || '',
        joinedAt:     data.createdAt
          ? new Date((data.createdAt._seconds || data.createdAt.seconds || 0) * 1000).toISOString()
          : null,
      };

      return res.status(200).json({ profile });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST /api/profile — update bio/socials (auth: userId + verified against Firestore)
  if (req.method === 'POST') {
    const { userId, bio, twitter, instagram, telegram, website } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Missing userId' });

    try {
      const userRef = db.collection('sp_users').doc(userId);
      const snap = await userRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'User not found' });

      const update = {};
      if (bio         !== undefined) update.bio       = String(bio).slice(0, 280).trim();
      if (twitter     !== undefined) update.twitter   = String(twitter).replace(/^@/, '').slice(0, 50).trim();
      if (instagram   !== undefined) update.instagram = String(instagram).replace(/^@/, '').slice(0, 50).trim();
      if (telegram    !== undefined) update.telegram  = String(telegram).replace(/^@/, '').slice(0, 50).trim();
      if (website     !== undefined) update.website   = String(website).slice(0, 200).trim();

      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });

      await userRef.update(update);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
