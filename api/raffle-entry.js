const { admin, db, initError, verifyToken } = require('./_firebase');

const LAUNCH_TS = new Date('2026-06-14T21:25:00Z').getTime();
const PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

function currentDraw() {
  const now = Date.now();
  const n = Math.max(1, Math.floor((now - LAUNCH_TS) / PERIOD_MS) + 1);
  return { drawNumber: n, endsAt: new Date(LAUNCH_TS + n * PERIOD_MS).toISOString() };
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded;
  try { decoded = await verifyToken(authHeader.slice(7)); }
  catch (e) { return res.status(401).json({ error: 'Invalid token' }); }

  const { drawNumber, endsAt } = currentDraw();
  const userId = decoded.uid;

  if (req.method === 'GET') {
    const snap = await db.collection('sp_raffle_entries')
      .where('userId', '==', userId)
      .where('drawNumber', '==', drawNumber)
      .limit(1).get();
    const entry = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    return res.status(200).json({ entry, drawNumber, endsAt });
  }

  if (req.method === 'POST') {
    const tickets = parseInt(req.body?.tickets) || 0;
    if (tickets < 1) return res.status(400).json({ error: 'Must enter at least 1 ticket' });

    const userRef  = db.collection('sp_users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

    const balance = userSnap.data().totalSats || 0;
    if (tickets > balance) return res.status(400).json({ error: `Not enough XP — you have ${balance.toLocaleString()} XP` });

    // Deduct XP
    await userRef.update({ totalSats: admin.firestore.FieldValue.increment(-tickets) });

    // Upsert entry
    const existing = await db.collection('sp_raffle_entries')
      .where('userId', '==', userId).where('drawNumber', '==', drawNumber).limit(1).get();

    let totalTickets;
    if (existing.empty) {
      await db.collection('sp_raffle_entries').add({
        userId,
        refCode:    userSnap.data().refCode || '',
        drawNumber,
        tickets,
        enteredAt:  admin.firestore.FieldValue.serverTimestamp(),
      });
      totalTickets = tickets;
    } else {
      const prev = existing.docs[0].data().tickets || 0;
      await existing.docs[0].ref.update({
        tickets:   admin.firestore.FieldValue.increment(tickets),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      totalTickets = prev + tickets;
    }

    return res.status(200).json({ ok: true, tickets: totalTickets, drawNumber });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
