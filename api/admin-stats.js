const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const now = Date.now();
    const oneDayAgo  = new Date(now - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const usersSnap = await db.collection('sp_users').get();

    let totalUsers = 0;
    let activeToday = 0;
    let activeWeek  = 0;
    let totalXp     = 0;
    let totalOverrideXp = 0;
    const allUsers = [];

    usersSnap.forEach(docSnap => {
      const d = docSnap.data();
      totalUsers++;
      totalXp += d.totalSats || 0;
      totalOverrideXp += d.overrideXp || 0;

      const lastActive = d.lastActiveAt?.toDate?.() || new Date(0);
      if (lastActive > oneDayAgo)    activeToday++;
      if (lastActive > sevenDaysAgo) activeWeek++;

      allUsers.push({
        id:            docSnap.id,
        email:         d.email || '',
        nickname:      d.nickname || '',
        refCode:       d.refCode || '',
        signupNumber:  d.signupNumber || 0,
        totalSats:     d.totalSats || 0,
        overrideXp:    d.overrideXp || 0,
        referralCount: d.referralCount || 0,
        downlineSize:  d.downlineSize || 0,
        totalImpressions: d.totalImpressions || 0,
        lastActiveAt:  d.lastActiveAt?.toDate?.()?.toISOString?.() || null,
        installedAt:   d.installedAt?.toDate?.()?.toISOString?.() || null,
      });
    });

    // Recent signups: highest signup numbers first
    const recentSignups = [...allUsers]
      .sort((a, b) => b.signupNumber - a.signupNumber)
      .slice(0, 15);

    // Top earners: most XP first
    const topEarners = [...allUsers]
      .sort((a, b) => b.totalSats - a.totalSats)
      .slice(0, 15);

    // Top referrers: most referrals first
    const topReferrers = [...allUsers]
      .sort((a, b) => b.referralCount - a.referralCount)
      .slice(0, 10);

    return res.status(200).json({
      totalUsers,
      activeToday,
      activeWeek,
      totalXp,
      totalOverrideXp,
      recentSignups,
      topEarners,
      topReferrers,
    });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
