const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

async function verifyAdmin(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) throw new Error('Unauthorized');
  const decoded = await admin.auth().verifyIdToken(token);
  if (decoded.email !== ADMIN_EMAIL) throw new Error('Forbidden');
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(403).json({ error: e.message }); }

  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    const [
      ipXpSnap,
      multiAccountSnap,
      referralFraudSnap,
      velocitySnap,
      zeroImpressionsSnap,
    ] = await Promise.all([
      // IP sharing today — populated by earn-xp after this deploy
      db.collection('sp_ip_xp').where('date', '==', todayStr).get(),
      // Accounts flagged for multi-account from same IP
      db.collection('sp_users').where('flaggedMultiAccount', '==', true).limit(100).get(),
      // Referrers whose IP matched a recruit's IP
      db.collection('sp_users').where('flaggedReferralFraud', '==', true).limit(100).get(),
      // Near or at daily cap today (potential bots/scripts)
      db.collection('sp_users').where('satsToday', '>=', 4500).orderBy('satsToday', 'desc').limit(50).get(),
      // Zero impressions but non-trivial balance (gifted or transferred in)
      db.collection('sp_users').where('totalImpressions', '==', 0).limit(300).get(),
    ]);

    // Shared IPs: 2+ accounts earning from same IP today
    const sharedIps = [];
    ipXpSnap.forEach(doc => {
      const d = doc.data();
      if ((d.uids || []).length >= 2) {
        sharedIps.push({ ip: d.ip, date: d.date, uids: d.uids, accountCount: d.uids.length });
      }
    });
    sharedIps.sort((a, b) => b.accountCount - a.accountCount);

    const multiAccount = [];
    multiAccountSnap.forEach(doc => {
      const d = doc.data();
      multiAccount.push({
        uid: doc.id, nickname: d.nickname || '', email: d.email || '',
        totalSats: d.totalSats || 0, satsToday: d.satsToday || 0,
        lastIp: d.lastIp || '', flaggedAt: d.flaggedAt?._seconds || null,
        frozen: d.frozen || false,
      });
    });

    const referralFraud = [];
    referralFraudSnap.forEach(doc => {
      const d = doc.data();
      referralFraud.push({
        uid: doc.id, nickname: d.nickname || '', email: d.email || '',
        totalSats: d.totalSats || 0, overrideXp: d.overrideXp || 0,
        referralCount: d.referralCount || 0, lastIp: d.lastIp || '',
        flaggedAt: d.flaggedAt?._seconds || null, frozen: d.frozen || false,
      });
    });

    const velocity = [];
    velocitySnap.forEach(doc => {
      const d = doc.data();
      const impressions = d.impressionsToday || 0;
      velocity.push({
        uid: doc.id, nickname: d.nickname || '', email: d.email || '',
        satsToday: d.satsToday || 0, impressionsToday: impressions,
        xpPerImpression: impressions > 0 ? Math.round((d.satsToday || 0) / impressions) : null,
        lastIp: d.lastIp || '', frozen: d.frozen || false,
        flaggedMultiAccount: d.flaggedMultiAccount || false,
      });
    });

    // Filter in-memory to avoid needing a composite index
    const noImpressions = [];
    zeroImpressionsSnap.forEach(doc => {
      const d = doc.data();
      if ((d.totalSats || 0) > 5000) {
        noImpressions.push({
          uid: doc.id, nickname: d.nickname || '', email: d.email || '',
          totalSats: d.totalSats || 0, lastIp: d.lastIp || '', frozen: d.frozen || false,
        });
      }
    });
    noImpressions.sort((a, b) => b.totalSats - a.totalSats);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      date: todayStr,
      summary: {
        sharedIpGroups:        sharedIps.length,
        multiAccountFlags:     multiAccount.length,
        referralFraudFlags:    referralFraud.length,
        velocityFlags:         velocity.length,
        noImpressionHighBalance: noImpressions.length,
      },
      sharedIps,
      multiAccount,
      referralFraud,
      velocity,
      noImpressions,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
