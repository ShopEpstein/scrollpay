const { db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, refCode } = req.query;
  if (!userId && !refCode) return res.status(400).json({ error: 'userId or refCode required' });

  try {
    let uid = userId;

    if (!uid && refCode) {
      const userSnap = await db.collection('sp_users')
        .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
      if (userSnap.empty) return res.status(404).json({ error: 'User not found' });
      uid = userSnap.docs[0].id;
    }

    const snap = await db.collection('sp_payouts')
      .where('userId', '==', uid)
      .orderBy('paidAt', 'desc')
      .limit(50)
      .get();

    const payouts = [];
    snap.forEach(doc => {
      const d = doc.data();
      payouts.push({
        id:        doc.id,
        grossSats: d.grossSats || 0,
        netSats:   d.netSats   || 0,
        feeSats:   d.feeSats   || 0,
        txNote:    d.txNote    || '',
        paidAt:    d.paidAt?._seconds || null,
      });
    });

    return res.status(200).json({ payouts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
