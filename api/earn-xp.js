const { admin, db, initError } = require('./_firebase');

const MAX_PER_WRITE = 50;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const { amount, type } = req.body;

    const awarded = Math.min(parseInt(amount) || 0, MAX_PER_WRITE);
    if (awarded <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const userRef = db.collection('sp_users').doc(decoded.uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Account not found — please reload the page.' });

    const data = snap.data();
    const today = new Date().toDateString();
    const lastDate = data.lastActiveAt?.toDate?.()?.toDateString?.() || '';
    const isToday = lastDate === today;

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

    return res.status(200).json({
      awarded,
      capped: false,
      total: (data.totalSats || 0) + awarded,
    });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
