const { db, initError } = require('./_firebase');

const ALLOWED_FIELDS = [
  'btcAddress', 'solAddress', 'ethAddress',
  'venmo', 'cashapp', 'applepay', 'paypal', 'zelle',
];

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  const refCode = (
    req.method === 'GET'
      ? req.query.refCode
      : req.body?.refCode
  )?.toUpperCase().trim();

  if (!refCode) return res.status(400).json({ error: 'Missing refCode' });

  try {
    const snap = await db.collection('sp_users')
      .where('refCode', '==', refCode).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'Ref code not found' });
    const userDoc = snap.docs[0];

    if (req.method === 'GET') {
      const data = userDoc.data();
      const wallets = {};
      ALLOWED_FIELDS.forEach(f => { wallets[f] = data[f] || ''; });
      return res.status(200).json({ wallets });
    }

    if (req.method === 'POST') {
      const incoming = req.body?.wallets || {};
      const update = {};
      ALLOWED_FIELDS.forEach(f => {
        if (f in incoming) update[f] = String(incoming[f] || '').trim().slice(0, 200);
      });
      if (!Object.keys(update).length) return res.status(400).json({ error: 'No fields provided' });
      await userDoc.ref.update(update);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
