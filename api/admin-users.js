const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const snap = await db.collection('sp_users').limit(1000).get();
      const users = [];
      snap.forEach(d => {
        const u = d.data();
        users.push({
          id: d.id,
          email: u.email || '',
          nickname: u.nickname || '',
          totalSats: u.totalSats || 0,
          satsToday: u.satsToday || 0,
          referralCount: u.referralCount || 0,
          signupNumber: u.signupNumber || 0,
          refCode: u.refCode || '',
          lastActiveAt: u.lastActiveAt?._seconds || u.lastActiveAt?.seconds || null,
        });
      });
      users.sort((a, b) => (a.signupNumber || 999999) - (b.signupNumber || 999999));
      return res.status(200).json({ users });
    }

    if (req.method === 'POST') {
      const { userId, refCode, text } = req.body || {};
      if (!userId || !text?.trim()) {
        return res.status(400).json({ error: 'Missing userId or text' });
      }
      await db.collection('sp_inbox').add({
        userId,
        refCode: (refCode || '').toUpperCase(),
        userEmail: '',
        userHandle: '',
        from: 'admin',
        text: text.trim(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
