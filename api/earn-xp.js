const { admin, db, initError, verifyToken } = require('./_firebase');

const MAX_PER_WRITE = 50;
const DAILY_CAP = 25000;

// Awards override XP to a referrer (fire-and-forget — never blocks the caller).
function awardOverrideXp(referrerId, override) {
  if (!referrerId || !(override > 0)) return;
  const ref = db.collection('sp_users').doc(referrerId);
  ref.update({
    totalSats:  admin.firestore.FieldValue.increment(override),
    overrideXp: admin.firestore.FieldValue.increment(override),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
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

    const userRef = db.collection('sp_users').doc(decoded.uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Account not found — please reload the page.' });

    const data = snap.data();
    if (data.frozen) return res.status(403).json({ error: 'Account frozen' });

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
      totalSats: admin.firestore.FieldValue.increment(awarded),
      satsToday: isToday ? admin.firestore.FieldValue.increment(awarded) : awarded,
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (type === 'impression') {
      update.totalImpressions = admin.firestore.FieldValue.increment(1);
      update.impressionsToday = isToday ? admin.firestore.FieldValue.increment(1) : 1;
    }

    await userRef.update(update);

    // Override XP: referrer earns 1 XP per 10 XP their recruit earns
    const override = Math.floor(awarded / 10);
    awardOverrideXp(data.referrerId || '', override);

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
