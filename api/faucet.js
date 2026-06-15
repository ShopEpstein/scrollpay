const { admin, db, initError, verifyToken } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const userRef = db.collection('sp_users').doc(decoded.uid);

    let secondsUntilReset = null;

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw Object.assign(new Error('Account not found — please reload the page.'), { status: 404 });

      const data = snap.data();
      const now = new Date();
      const todayUtc = now.toISOString().slice(0, 10);

      const lastFaucetAt = data.lastFaucetAt?.toDate?.();
      if (lastFaucetAt) {
        const lastUtc = lastFaucetAt.toISOString().slice(0, 10);
        if (todayUtc === lastUtc) {
          const midnight = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
          ));
          secondsUntilReset = Math.ceil((midnight - now) / 1000);
          throw Object.assign(new Error('Already claimed today'), { status: 429 });
        }
      }

      const currentTotal = data.totalSats || 0;
      tx.update(userRef, {
        totalSats: admin.firestore.FieldValue.increment(1),
        lastFaucetAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { total: currentTotal + 1 };
    });

    return res.status(200).json({ awarded: 1, total: result.total });
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({ error: err.message, secondsUntilReset });
    }
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
