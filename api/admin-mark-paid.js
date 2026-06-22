const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const PLATFORM_FEE = 0.30;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const { userId, userEmail, handle, sweepOrderId, grossSats, txNote } = req.body || {};
    if (!userId || !grossSats) return res.status(400).json({ error: 'Missing userId or grossSats' });

    const feeSats  = Math.round(grossSats * PLATFORM_FEE);
    const netSats  = grossSats - feeSats;

    await db.collection('sp_payouts').add({
      userId,
      userEmail: userEmail || '',
      handle:    handle    || null,
      sweepOrderId: sweepOrderId || null,
      grossSats,
      feeSats,
      netSats,
      txNote: txNote || '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: ADMIN_EMAIL,
    });

    return res.status(200).json({ ok: true, netSats, feeSats });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
