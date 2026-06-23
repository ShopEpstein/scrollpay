const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

// Merge sourceUserId into targetUserId:
//   - Add source XP to target
//   - Migrate handle from source to target if target has none
//   - Use the earlier signupNumber on the target (early-adopter benefit)
//   - Copy payment methods from source if target is missing them
//   - Zero out source XP, mark it merged
module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const { sourceUserId, targetUserId } = req.body || {};
    if (!sourceUserId || !targetUserId) {
      return res.status(400).json({ error: 'Missing sourceUserId or targetUserId' });
    }
    if (sourceUserId === targetUserId) {
      return res.status(400).json({ error: 'Source and target are the same user' });
    }

    const sourceRef = db.collection('sp_users').doc(sourceUserId);
    const targetRef = db.collection('sp_users').doc(targetUserId);
    const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);

    if (!sourceSnap.exists) return res.status(404).json({ error: 'Source user not found' });
    if (!targetSnap.exists) return res.status(404).json({ error: 'Target user not found' });

    const src = sourceSnap.data();
    const tgt = targetSnap.data();

    const targetUpdates = {};

    // XP: add source balance to target
    const srcXp = src.totalSats || 0;
    if (srcXp > 0) {
      targetUpdates.totalSats = admin.firestore.FieldValue.increment(srcXp);
    }

    // Impressions
    const srcImpr = src.totalImpressions || 0;
    if (srcImpr > 0) {
      targetUpdates.totalImpressions = admin.firestore.FieldValue.increment(srcImpr);
    }

    // Handle: migrate from source if target has none
    if (src.nickname && !tgt.nickname) {
      targetUpdates.nickname = src.nickname;
    }

    // signupNumber: keep the earlier (lower) one for early-adopter bonus
    const srcNum = src.signupNumber || 999999;
    const tgtNum = tgt.signupNumber || 999999;
    if (srcNum < tgtNum) {
      targetUpdates.signupNumber = srcNum;
    }

    // Payment methods: copy from source if target doesn't have them
    const PAY_FIELDS = ['btcAddress', 'solAddress', 'ethAddress', 'venmo', 'cashapp', 'applepay', 'paypal', 'zelle', 'lightningAddress'];
    for (const field of PAY_FIELDS) {
      if (src[field] && !tgt[field]) {
        targetUpdates[field] = src[field];
      }
    }

    // Mark source as merged and zero it out
    const sourceUpdates = {
      mergedIntoUid: targetUserId,
      mergedAt: admin.firestore.FieldValue.serverTimestamp(),
      totalSats: 0,
      satsToday: 0,
      lastAdminNote: `Merged into ${targetUserId} by admin`,
      lastAdminAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // Free the handle on source so target can claim it
    if (targetUpdates.nickname) {
      sourceUpdates.nickname = admin.firestore.FieldValue.delete();
    }

    const ops = [sourceRef.update(sourceUpdates)];
    if (Object.keys(targetUpdates).length > 0) {
      ops.push(targetRef.update(targetUpdates));
    }
    await Promise.all(ops);

    return res.status(200).json({
      ok: true,
      xpMerged: srcXp,
      impressionsMerged: srcImpr,
      migrated: Object.keys(targetUpdates),
    });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
