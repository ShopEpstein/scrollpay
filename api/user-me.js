const { admin, db, initError, verifyToken } = require('./_firebase');

const POINTS_CONFIG = {
  referralBonusL1: 100,
  referralBonusL2: 25,
  referralBonusL3: 10,
  earlyAdopterThreshold: 500,
  earlyAdopterMultiplier: 1.5,
};

async function bonusFor(uid, base) {
  try {
    const s = await db.collection('sp_users').doc(uid).get();
    if (!s.exists) return base;
    const sn = s.data().signupNumber || 999999;
    return Math.round(base * (sn <= POINTS_CONFIG.earlyAdopterThreshold ? POINTS_CONFIG.earlyAdopterMultiplier : 1.0));
  } catch (e) { return base; }
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const uid = decoded.uid;
    const userRef = db.collection('sp_users').doc(uid);
    const snap = await userRef.get();

    if (snap.exists) {
      return res.status(200).json({ user: { id: uid, ...snap.data() }, isNew: false });
    }

    // First sign-in — create account
    const referredBy = (req.body?.referredBy || req.query?.ref || '').toUpperCase().trim();
    const refCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // Signup number
    let signupNumber = 1;
    const statsRef = db.collection('sp_meta').doc('stats');
    try {
      const st = await statsRef.get();
      if (st.exists) {
        signupNumber = (st.data().userCount || 0) + 1;
        await statsRef.update({ userCount: admin.firestore.FieldValue.increment(1) });
      } else {
        await statsRef.set({ userCount: 1 });
      }
    } catch (e) {}

    // Resolve referral chain
    let l1Id = null, l2Id = null, l3Id = null;
    if (referredBy) {
      const refSnap = await db.collection('sp_users')
        .where('refCode', '==', referredBy).limit(1).get();
      if (!refSnap.empty) {
        const l1Doc = refSnap.docs[0];
        l1Id = l1Doc.id;
        l2Id = l1Doc.data().referrerId || null;
        if (l2Id) {
          const l2Snap = await db.collection('sp_users').doc(l2Id).get();
          l3Id = (l2Snap.exists ? l2Snap.data().referrerId : null) || null;
        }
      }
    }

    const userData = {
      id: uid,
      email: decoded.email || '',
      totalSats: 0,
      satsToday: 0,
      totalImpressions: 0,
      impressionsToday: 0,
      refCode,
      referredBy,
      referrerId: l1Id || '',
      signupNumber,
      referralCount: 0,
      downlineSize: 0,
      downlineXp: 0,
      installedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await userRef.set(userData);

    // Award referral bonuses
    if (l1Id) {
      const award = await bonusFor(l1Id, POINTS_CONFIG.referralBonusL1);
      await db.collection('sp_users').doc(l1Id).update({
        totalSats: admin.firestore.FieldValue.increment(award),
        referralCount: admin.firestore.FieldValue.increment(1),
        downlineSize: admin.firestore.FieldValue.increment(1),
        downlineXp: admin.firestore.FieldValue.increment(award),
      });
    }
    if (l2Id) {
      const award = await bonusFor(l2Id, POINTS_CONFIG.referralBonusL2);
      await db.collection('sp_users').doc(l2Id).update({
        totalSats: admin.firestore.FieldValue.increment(award),
        downlineSize: admin.firestore.FieldValue.increment(1),
        downlineXp: admin.firestore.FieldValue.increment(award),
      });
    }
    if (l3Id) {
      const award = await bonusFor(l3Id, POINTS_CONFIG.referralBonusL3);
      await db.collection('sp_users').doc(l3Id).update({
        totalSats: admin.firestore.FieldValue.increment(award),
        downlineSize: admin.firestore.FieldValue.increment(1),
        downlineXp: admin.firestore.FieldValue.increment(award),
      });
    }

    return res.status(200).json({ user: { ...userData, totalSats: 0 }, isNew: true });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
