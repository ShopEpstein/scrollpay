const { admin, db, initError, verifyToken } = require('./_firebase');

const MAX_PER_WRITE = 50;
const DAILY_CAP = 5000;
const RATE_LIMIT_PER_MINUTE = 10;

// Checks referrer IP against recruit IP before awarding override XP.
// Flags referrer and skips award if IPs match (self-referral ring).
function awardOverrideXp(referrerId, override, recruitIp) {
  if (!referrerId || !(override > 0)) return;
  const ref = db.collection('sp_users').doc(referrerId);
  ref.get().then(snap => {
    if (!snap.exists) return;
    const d = snap.data();
    if (recruitIp && d.lastIp && d.lastIp === recruitIp) {
      ref.update({
        flaggedReferralFraud: true,
        flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      return;
    }
    ref.update({
      totalSats:  admin.firestore.FieldValue.increment(override),
      overrideXp: admin.firestore.FieldValue.increment(override),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
  }).catch(() => {});
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const { amount, type } = req.body;

    const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const todayStr = new Date().toISOString().slice(0, 10);
    const minuteKey = Math.floor(Date.now() / 60000).toString();

    const userRef = db.collection('sp_users').doc(decoded.uid);
    const rlRef   = clientIp ? db.collection('sp_rate_limits').doc(`${clientIp}_${minuteKey}`) : null;
    const ipRef   = clientIp ? db.collection('sp_ip_xp').doc(`${todayStr}_${clientIp}`) : null;

    // Parallel reads to minimise latency
    const [snap, rlSnap, ipSnap] = await Promise.all([
      userRef.get(),
      rlRef ? rlRef.get() : Promise.resolve(null),
      ipRef  ? ipRef.get()  : Promise.resolve(null),
    ]);

    if (!snap.exists) return res.status(404).json({ error: 'Account not found — please reload the page.' });

    const data = snap.data();
    if (data.frozen) return res.status(403).json({ error: 'Account frozen' });

    // Rate limit: max RATE_LIMIT_PER_MINUTE calls per IP per minute
    const rlCount = rlSnap?.exists ? (rlSnap.data().count || 0) : 0;
    if (rlCount >= RATE_LIMIT_PER_MINUTE) {
      return res.status(429).json({ error: 'Too many requests — slow down.' });
    }
    if (rlRef) {
      rlRef.set(
        { count: admin.firestore.FieldValue.increment(1), ip: clientIp,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
        { merge: true }
      ).catch(() => {});
    }

    const today = new Date().toDateString();
    const lastDate = data.lastActiveAt?.toDate?.()?.toDateString?.() || '';
    const isToday = lastDate === today;
    const satsToday = isToday ? (data.satsToday || 0) : 0;

    if (satsToday >= DAILY_CAP) {
      return res.status(200).json({ awarded: 0, capped: true, total: data.totalSats || 0 });
    }

    const remaining = DAILY_CAP - satsToday;
    const awarded = Math.min(parseInt(amount) || 0, MAX_PER_WRITE, remaining);
    if (awarded <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const update = {
      totalSats:    admin.firestore.FieldValue.increment(awarded),
      totalXpMined: admin.firestore.FieldValue.increment(awarded),
      satsToday:    isToday ? admin.firestore.FieldValue.increment(awarded) : awarded,
      satsDate:     todayStr,
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(clientIp && { lastIp: clientIp }),
    };
    if (type === 'impression') {
      update.totalImpressions  = admin.firestore.FieldValue.increment(1);
      update.impressionsToday  = isToday ? admin.firestore.FieldValue.increment(1) : 1;
    }

    await userRef.update(update);

    // IP dedup: if 3+ distinct accounts earn from same IP today, flag this one
    if (ipRef && clientIp) {
      const existingUids = ipSnap?.exists ? (ipSnap.data().uids || []) : [];
      if (!existingUids.includes(decoded.uid)) {
        if (existingUids.length >= 2) {
          userRef.update({
            flaggedMultiAccount: true,
            flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
        }
        ipRef.set(
          { uids: admin.firestore.FieldValue.arrayUnion(decoded.uid), ip: clientIp, date: todayStr,
            expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000) },
          { merge: true }
        ).catch(() => {});
      }
    }

    // Override XP to referrer (skipped if IPs match — referral ring)
    const override = Math.floor(awarded / 10);
    awardOverrideXp(data.referrerId || '', override, clientIp);

    return res.status(200).json({
      awarded,
      overrideAwarded: override,
      capped: (satsToday + awarded) >= DAILY_CAP,
      total: (data.totalSats || 0) + awarded,
    });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
