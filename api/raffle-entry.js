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

    const userRef = db.collection('sp_users').doc(userId);

    // Transaction: atomically validate balance and deduct XP
    let userData;
    try {
      await db.runTransaction(async t => {
        const userSnap = await t.get(userRef);
        if (!userSnap.exists) throw new Error('User not found');
        if (userSnap.data().frozen) {
          const err = new Error('Account frozen');
          err.status = 403;
          throw err;
        }
        const balance = userSnap.data().totalSats || 0;
        if (tickets > balance) {
          const err = new Error(`Not enough XP — you have ${balance.toLocaleString()} XP`);
          err.status = 400;
          throw err;
        }
        userData = userSnap.data();
        t.update(userRef, { totalSats: admin.firestore.FieldValue.increment(-tickets) });
      });
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }

    // Upsert entry outside transaction (no read-write on same doc needed)
    const existing = await db.collection('sp_raffle_entries')
      .where('userId', '==', userId).where('drawNumber', '==', drawNumber).limit(1).get();

    let totalTickets;
    if (existing.empty) {
      await db.collection('sp_raffle_entries').add({
        userId,
        refCode:    userData.refCode || '',
        nickname:   userData.nickname || '',
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
