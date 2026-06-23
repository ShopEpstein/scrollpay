const { admin, db, initError } = require('./_firebase');
const { sendEmail } = require('./_email');

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

function pickWinner(entries) {
  const total = entries.reduce((s, e) => s + (e.tickets || 0), 0);
  if (total === 0) return null;
  let pick = Math.floor(Math.random() * total);
  for (const entry of entries) {
    pick -= entry.tickets || 0;
    if (pick < 0) return entry;
  }
  return entries[entries.length - 1];
}

function buildWinnerEmail({ nickname, drawNumber, tickets, totalTickets }) {
  const name = nickname ? `@${nickname}` : 'Miner';
  const odds = totalTickets > 0 ? ((tickets / totalTickets) * 100).toFixed(1) : '0.0';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You Won the ScrollPay Raffle!</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px 40px;">

  <div style="text-align:center;padding:28px 0 20px;">
    <div style="font-size:30px;font-weight:900;color:#f7931a;letter-spacing:-1px;">⚡ ScrollPay</div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px;letter-spacing:2.5px;text-transform:uppercase;">Bitcoin "Mining" Platform</div>
  </div>

  <div style="background:linear-gradient(145deg,#0f1200 0%,#1a0f00 50%,#0a1000 100%);border:2px solid #f7931a;border-radius:22px;padding:44px 28px 36px;text-align:center;margin-bottom:20px;">
    <div style="font-size:64px;line-height:1;margin-bottom:16px;">🏆</div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">Congratulations, ${name}</div>
    <div style="font-size:28px;font-weight:900;color:#ffffff;line-height:1.3;margin-bottom:16px;">
      You Won Draw #${drawNumber}!<br>
      <span style="color:#f7931a;">₿ Bitcoin Raffle</span>
    </div>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 22px;">
      Your <strong style="color:#f7931a;">${tickets.toLocaleString()} tickets</strong> hit — beating ${odds}% odds.
      A ScrollPay team member will contact you shortly to arrange your Bitcoin payout.
    </p>
    <div style="display:inline-block;background:rgba(247,147,26,0.15);border:1px solid #f7931a;border-radius:30px;padding:8px 24px;">
      <span style="color:#fbbf24;font-size:13px;font-weight:800;">Make sure your BTC address is set in your profile</span>
    </div>
  </div>

  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:22px 24px;margin-bottom:24px;">
    <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Next Steps</div>
    <div style="color:#9ca3af;font-size:13px;line-height:2;">
      <span style="color:#f7931a;font-weight:700;">1.</span>&nbsp; Open the ScrollPay extension and confirm your BTC address is saved<br>
      <span style="color:#f7931a;font-weight:700;">2.</span>&nbsp; Reply to this email if you have any questions<br>
      <span style="color:#f7931a;font-weight:700;">3.</span>&nbsp; Keep mining — new draws run every week ⚡
    </div>
  </div>

  <div style="text-align:center;margin-bottom:28px;">
    <a href="https://scrollpay.app" target="_blank"
      style="display:inline-block;background:linear-gradient(135deg,#f7931a,#f5a623);color:#000;text-decoration:none;padding:16px 52px;border-radius:50px;font-size:15px;font-weight:900;letter-spacing:.3px;">
      Open ScrollPay →
    </a>
  </div>

  <div style="text-align:center;padding:16px 0;">
    <div style="color:#374151;font-size:12px;margin-bottom:6px;">
      <a href="https://scrollpay.app" style="color:#f7931a;text-decoration:none;font-weight:700;">scrollpay.app</a>
      &nbsp;·&nbsp;
      <a href="https://scrollpay.app/privacy" style="color:#6b7280;text-decoration:none;">Privacy</a>
    </div>
    <div style="color:#374151;font-size:11px;line-height:1.6;">
      You're receiving this because you won the ScrollPay weekly BTC draw.
    </div>
  </div>

</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(403).json({ error: e.message }); }

  // GET — list entries for a draw
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

      // Include winner if already drawn
      const winnerSnap = await db.collection('sp_raffle_winners')
        .where('drawNumber', '==', drawNumber).limit(1).get();
      const winner = winnerSnap.empty ? null : winnerSnap.docs[0].data();

      return res.status(200).json({ entries, drawNumber, totalTickets, endsAt, currentDraw: currentDrawNumber(), winner });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove a single entry (no XP refund — rigged entries are forfeited)
  if (req.method === 'DELETE') {
    const entryId = req.query.entryId;
    if (!entryId) return res.status(400).json({ error: 'entryId required' });
    try {
      const ref = db.collection('sp_raffle_entries').doc(entryId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Entry not found' });
      const data = snap.data();
      await ref.delete();
      return res.status(200).json({ ok: true, userId: data.userId, tickets: data.tickets || 0 });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — draw winner
  if (req.method === 'POST') {
    const drawNumber = parseInt(req.body?.drawNumber) || 1;

    // Check not already drawn
    const existingWinner = await db.collection('sp_raffle_winners')
      .where('drawNumber', '==', drawNumber).limit(1).get();
    if (!existingWinner.empty) {
      return res.status(409).json({ error: `Draw #${drawNumber} already has a winner`, winner: existingWinner.docs[0].data() });
    }

    const snap = await db.collection('sp_raffle_entries')
      .where('drawNumber', '==', drawNumber).get();

    const entries = [];
    snap.forEach(d => entries.push({ id: d.id, ...d.data() }));

    if (entries.length === 0) {
      return res.status(400).json({ error: `No entries for draw #${drawNumber}` });
    }

    const totalTickets = entries.reduce((s, e) => s + (e.tickets || 0), 0);
    const winner = pickWinner(entries);
    if (!winner) return res.status(500).json({ error: 'Could not select winner' });

    // Look up winner's email
    const userSnap = await db.collection('sp_users').doc(winner.userId).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const email = userData.email || null;

    const winnerRecord = {
      drawNumber,
      userId:       winner.userId,
      entryId:      winner.id,
      nickname:     winner.nickname || '',
      refCode:      winner.refCode  || '',
      tickets:      winner.tickets  || 0,
      totalTickets,
      email:        email || '',
      drawnAt:      admin.firestore.FieldValue.serverTimestamp(),
      drawnBy:      ADMIN_EMAIL,
      emailSent:    false,
    };

    await db.collection('sp_raffle_winners').add(winnerRecord);

    // Email the winner
    if (email) {
      const html = buildWinnerEmail({
        nickname: winner.nickname,
        drawNumber,
        tickets: winner.tickets || 0,
        totalTickets,
      });
      await sendEmail({
        to: email,
        subject: `🏆 You won the ScrollPay Draw #${drawNumber} — Bitcoin Raffle`,
        html,
      });
      // Mark email sent
      const newWinnerSnap = await db.collection('sp_raffle_winners')
        .where('drawNumber', '==', drawNumber).limit(1).get();
      if (!newWinnerSnap.empty) {
        await newWinnerSnap.docs[0].ref.update({ emailSent: true });
      }
    }

    return res.status(200).json({
      ok: true,
      winner: { ...winnerRecord, drawnAt: new Date().toISOString() },
      emailSent: !!email,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
