const { db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const daily = req.query.daily === '1';

  try {
    if (daily) {
      const todayStr = new Date().toISOString().slice(0, 10);

      // Filter by satsDate (calendar day string) so stale satsToday values
      // from previous days don't pollute the today leaderboard.
      const snap = await db.collection('sp_users')
        .where('satsDate', '==', todayStr)
        .limit(1000)
        .get();

      const miners = [];
      snap.forEach(doc => {
        const d = doc.data();
        miners.push({
          handle: d.nickname || `Miner #${d.signupNumber || '?'}`,
          xp: d.satsToday || 0,
          recruits: d.referralCount || 0,
          hasNickname: !!d.nickname,
        });
      });

      miners.sort((a, b) => b.xp - a.xp);
      const leaders = miners.slice(0, 10).map((m, i) => ({ rank: i + 1, ...m }));

      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json({ leaders, updatedAt: new Date().toISOString(), date: todayStr });
    }

    // All-time — order by totalXpMined so that selling XP doesn't remove
    // someone from the leaderboard. Fall back to totalSats for older users
    // who don't yet have totalXpMined written.
    const [snapMined, snapBalance] = await Promise.all([
      db.collection('sp_users').orderBy('totalXpMined', 'desc').limit(20).get(),
      db.collection('sp_users').orderBy('totalSats', 'desc').limit(20).get(),
    ]);

    const seenUids = new Set();
    const leaderMap = {};

    snapMined.forEach(doc => {
      const d = doc.data();
      seenUids.add(doc.id);
      leaderMap[doc.id] = {
        handle: d.nickname || `Miner #${d.signupNumber || '?'}`,
        xp: d.totalXpMined || d.totalSats || 0,
        recruits: d.referralCount || 0,
        hasNickname: !!d.nickname,
      };
    });

    // Include high-balance users who might predate the totalXpMined field
    snapBalance.forEach(doc => {
      if (seenUids.has(doc.id)) return;
      const d = doc.data();
      if (!d.totalSats) return;
      leaderMap[doc.id] = {
        handle: d.nickname || `Miner #${d.signupNumber || '?'}`,
        xp: d.totalXpMined || d.totalSats || 0,
        recruits: d.referralCount || 0,
        hasNickname: !!d.nickname,
      };
    });

    const leaders = Object.values(leaderMap)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 20)
      .map((m, i) => ({ rank: i + 1, ...m }));

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ leaders, updatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
