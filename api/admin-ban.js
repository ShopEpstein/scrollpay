const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { userId, action, reason, zeroXp } = req.body || {};
    if (!userId || !['ban', 'unban'].includes(action)) {
      return res.status(400).json({ error: 'Missing userId or invalid action (ban|unban)' });
    }

    const userRef = db.collection('sp_users').doc(userId);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const userData = snap.data();

    if (action === 'ban') {
      const updates = {
        banned: true,
        bannedAt: now,
        bannedReason: reason || 'Policy violation',
        bannedBy: ADMIN_EMAIL,
        frozen: true,
        frozenReason: `BANNED: ${reason || 'Policy violation'}`,
      };
      if (zeroXp) {
        updates.totalSats = 0;
        updates.satsToday = 0;
        updates.totalXpMined = 0;
        updates.satsDate = null;
        updates.overrideXp = 0;
      }
      await userRef.update(updates);

      await db.collection('sp_audit').add({
        action: 'ban',
        userId,
        handle: userData.nickname || '',
        email: userData.email || '',
        reason: reason || 'Policy violation',
        xpBefore: userData.totalSats || 0,
        zeroXp: !!zeroXp,
        adminEmail: ADMIN_EMAIL,
        createdAt: now,
      });

      return res.status(200).json({ ok: true, banned: true, zeroXp: !!zeroXp });

    } else {
      await userRef.update({
        banned: false,
        unbannedAt: now,
        unbannedBy: ADMIN_EMAIL,
        frozen: false,
      });
      await db.collection('sp_audit').add({
        action: 'unban',
        userId,
        handle: userData.nickname || '',
        adminEmail: ADMIN_EMAIL,
        createdAt: now,
      });
      return res.status(200).json({ ok: true, banned: false });
    }
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
