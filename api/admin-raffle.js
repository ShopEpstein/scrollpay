const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const LAUNCH_TS   = new Date('2026-06-14T21:25:00Z').getTime();
const PERIOD_MS   = 7 * 24 * 60 * 60 * 1000;

function currentDrawNumber() {
  return Math.max(1, Math.floor((Date.now() - LAUNCH_TS) / PERIOD_MS) + 1);
}

async function verifyAdmin(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) throw new Error('Unauthorized');
  const decoded = await admin.auth().verifyIdToken(token);
  if (decoded.email !== ADMIN_EMAIL) throw new Error('Forbidden');
  return decoded;
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(403).json({ error: e.message }); }

  if (req.method === 'GET') {
    const drawNumber = parseInt(req.query.draw) || currentDrawNumber();
    try {
      const snap = await db.collection('sp_raffle_entries')
        .where('drawNumber', '==', drawNumber)
        .get();

      const entries = [];
      snap.forEach(d => entries.push({ id: d.id, ...d.data() }));
      entries.sort((a, b) => (b.tickets || 0) - (a.tickets || 0));

      const totalTickets = entries.reduce((s, e) => s + (e.tickets || 0), 0);
      const endsAt = new Date(LAUNCH_TS + drawNumber * PERIOD_MS).toISOString();

      return res.status(200).json({ entries, drawNumber, totalTickets, endsAt, currentDraw: currentDrawNumber() });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
