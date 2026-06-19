const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

async function verifyAdmin(req) {
  const auth = req.headers.authorization?.split('Bearer ')[1];
  if (!auth) throw new Error('Unauthorized');
  const decoded = await admin.auth().verifyIdToken(auth);
  if (decoded.email !== ADMIN_EMAIL) throw new Error('Forbidden');
  return decoded;
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  try { await verifyAdmin(req); }
  catch(e) { return res.status(403).json({ error: e.message }); }

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('sp_sweep_orders').limit(100).get();
      const orders = [];
      snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
      orders.sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
      return res.status(200).json({ orders });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body;
    const valid = ['pending', 'contacted', 'fulfilled', 'cancelled'];
    if (!id || !valid.includes(status)) {
      return res.status(400).json({ error: 'Invalid id or status' });
    }
    try {
      await db.collection('sp_sweep_orders').doc(id).update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
