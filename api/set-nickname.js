const { admin, db, initError, verifyToken } = require('./_firebase');

const NICKNAME_RE = /^[a-z0-9_]{3,20}$/;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const { nickname } = req.body || {};
  if (!nickname || !NICKNAME_RE.test(nickname)) {
    return res.status(400).json({ error: 'Handle must be 3–20 lowercase letters, numbers, or underscores.' });
  }

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const userRef = db.collection('sp_users').doc(decoded.uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Account not found.' });

    if (snap.data().nickname) {
      return res.status(409).json({ error: 'Handle already set — it cannot be changed.' });
    }

    // Enforce uniqueness
    const taken = await db.collection('sp_users').where('nickname', '==', nickname).limit(1).get();
    if (!taken.empty) {
      return res.status(409).json({ error: 'Handle already taken — choose another.' });
    }

    await userRef.update({ nickname });
    return res.status(200).json({ nickname });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
