const { admin, db, initError } = require('./_firebase');
const { sendEmail } = require('./_email');

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
      const orderSnap = await db.collection('sp_sweep_orders').doc(id).get();
      const order = orderSnap.exists ? orderSnap.data() : null;

      await db.collection('sp_sweep_orders').doc(id).update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (order?.email) {
        const statusLabels = {
          contacted: "We've reached out",
          fulfilled:  'Your campaign is live!',
          cancelled:  'Campaign request cancelled',
        };
        const label = statusLabels[status];
        if (label) {
          const xpFmt = Number(order.totalXp || 0).toLocaleString();
          sendEmail({
            to: order.email,
            subject: `ScrollPay Campaign Update — ${label}`,
            html: `
              <h2 style="margin:0 0 8px;">${label}</h2>
              <p style="color:#475569;">Your request to sweep <strong>${xpFmt} XP</strong> has been updated to <strong>${status}</strong>.</p>
              ${status === 'fulfilled' ? '<p style="color:#475569;">Your XP has been delivered. Thank you for running a campaign with ScrollPay!</p>' : ''}
              ${status === 'cancelled' ? '<p style="color:#475569;">If you have questions, reply to this email or reach out via <a href="https://scrollpay.app">scrollpay.app</a>.</p>' : ''}
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;">Order: <code>${id}</code> — The ScrollPay Team</p>
            `,
          });
        }
      }

      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
