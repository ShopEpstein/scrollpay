const { db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const daily = req.query.daily === '1';

  try {
    if (daily) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const snap = await db.collection('sp_users')
        .orderBy('satsToday', 'desc')
        .limit(50)
        .get();

      const leaders = [];
      snap.forEach(doc => {
        if (leaders.length >= 20) return;
        const d = doc.data();
        if (d.satsDate !== todayStr) return;
        leaders.push({
          rank: leaders.length + 1,
          handle: d.nickname || `Miner #${d.signupNumber || '?'}`,
          xp: d.satsToday || 0,
          recruits: d.referralCount || 0,
          hasNickname: !!d.nickname,
        });
      });

      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json({ leaders, updatedAt: new Date().toISOString(), date: todayStr });
    }

    // All-time
    const snap = await db.collection('sp_users')
      .orderBy('totalSats', 'desc')
      .limit(20)
      .get();

    const leaders = [];
    snap.forEach(doc => {
      const d = doc.data();
      leaders.push({
        rank: leaders.length + 1,
        handle: d.nickname || `Miner #${d.signupNumber || '?'}`,
        xp: d.totalSats || 0,
        recruits: d.referralCount || 0,
        hasNickname: !!d.nickname,
      });
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ leaders, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
