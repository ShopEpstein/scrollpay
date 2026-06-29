const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const VELOCITY_THRESHOLD = 4500;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Fetch all velocity abusers (near or over daily cap today)
    const velocitySnap = await db.collection('sp_users')
      .where('satsToday', '>=', VELOCITY_THRESHOLD)
      .orderBy('satsToday', 'desc')
      .limit(200)
      .get();

    const uids = [];
    velocitySnap.forEach(doc => {
      if (!doc.data().frozen) uids.push(doc.id);
    });

    if (uids.length === 0) {
      return res.status(200).json({ ok: true, frozenCount: 0, listingsCancelled: 0 });
    }

    // Freeze + zero XP in batches of 500 (Firestore batch limit)
    const BATCH_SIZE = 400;
    for (let i = 0; i < uids.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = uids.slice(i, i + BATCH_SIZE);
      for (const uid of chunk) {
        batch.update(db.collection('sp_users').doc(uid), {
          frozen: true,
          frozenAt: now,
          frozenReason: 'Velocity abuse — automated batch freeze',
          frozenBy: ADMIN_EMAIL,
          totalSats: 0,
          satsToday: 0,
          totalXpMined: 0,
          overrideXp: 0,
          satsDate: null,
        });
      }
      await batch.commit();
    }

    // Cancel all open listings belonging to these accounts
    // Firestore 'in' queries max 30 items — chunk accordingly
    let listingsCancelled = 0;
    const IN_CHUNK = 30;
    for (let i = 0; i < uids.length; i += IN_CHUNK) {
      const chunk = uids.slice(i, i + IN_CHUNK);
      const listSnap = await db.collection('sp_xp_listings')
        .where('userId', 'in', chunk)
        .where('status', '==', 'open')
        .get();

      if (listSnap.empty) continue;

      const batch = db.batch();
      listSnap.forEach(doc => {
        batch.update(doc.ref, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledReason: 'Account frozen for velocity abuse',
        });
        listingsCancelled++;
      });
      await batch.commit();
    }

    // Audit record
    await db.collection('sp_audit').add({
      action: 'batch_freeze_velocity',
      frozenUids: uids,
      frozenCount: uids.length,
      listingsCancelled,
      adminEmail: ADMIN_EMAIL,
      createdAt: now,
    });

    return res.status(200).json({ ok: true, frozenCount: uids.length, listingsCancelled });

  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
