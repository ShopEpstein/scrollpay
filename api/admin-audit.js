const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

async function verifyAdmin(req) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) throw new Error('Unauthorized');
  const decoded = await admin.auth().verifyIdToken(token);
  if (decoded.email !== ADMIN_EMAIL) throw new Error('Forbidden');
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try { await verifyAdmin(req); }
  catch (e) { return res.status(403).json({ error: e.message }); }

  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    // Fetch everything in parallel
    const [
      userSnap,
      raffleSnap,
      btcListingsSnap,
      scrollOrdersSnap,
      transfersOutSnap,
      transfersInSnap,
    ] = await Promise.all([
      db.collection('sp_users').doc(userId).get(),
      db.collection('sp_raffle_entries').where('userId', '==', userId).get(),
      db.collection('sp_xp_listings').where('userId', '==', userId).get(),
      db.collection('sp_scroll_orders').where('userId', '==', userId).get(),
      db.collection('sp_transfers').where('fromUid', '==', userId).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('sp_transfers').where('toUid', '==', userId).orderBy('createdAt', 'desc').limit(50).get(),
    ]);

    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

    const user = { id: userId, ...userSnap.data() };

    // Raffle entries
    const raffleEntries = [];
    raffleSnap.forEach(d => raffleEntries.push({ id: d.id, ...d.data() }));
    raffleEntries.sort((a, b) => (b.drawNumber || 0) - (a.drawNumber || 0));
    const totalRaffleTickets = raffleEntries.reduce((s, e) => s + (e.tickets || 0), 0);

    // BTC marketplace listings
    const btcListings = [];
    btcListingsSnap.forEach(d => btcListings.push({ id: d.id, ...d.data() }));
    const openBtcListings = btcListings.filter(l => l.status === 'open');
    const openBtcXp = openBtcListings.reduce((s, l) => s + (l.xpAmount || 0), 0);

    // SCROLL market orders
    const scrollOrders = [];
    scrollOrdersSnap.forEach(d => scrollOrders.push({ id: d.id, ...d.data() }));
    const openScrollAsks = scrollOrders.filter(o => o.type === 'ask' && ['open', 'awaiting_deposit'].includes(o.status));
    const openScrollXp  = openScrollAsks.reduce((s, o) => s + (o.xpAmount || 0), 0);

    // Transfers
    const transfersOut = [];
    transfersOutSnap.forEach(d => transfersOut.push({ id: d.id, ...d.data() }));
    const transfersIn = [];
    transfersInSnap.forEach(d => transfersIn.push({ id: d.id, ...d.data() }));
    const totalTransferredOut = transfersOut.reduce((s, t) => s + (t.amount || 0), 0);
    const totalTransferredIn  = transfersIn.reduce((s, t) => s + (t.amount || 0), 0);

    const currentBalance = user.totalSats || 0;

    // XP accounting
    // XP in raffle is deducted from balance (covered).
    // XP in open SCROLL ASKs is deducted from balance (covered).
    // XP in open BTC listings is NOT deducted (vulnerability).
    // Double-spend: open BTC listing XP that exceeds current balance.
    const doubleSpendBtc = Math.max(0, openBtcXp - currentBalance);

    // Flags
    const flags = [];
    if (user.frozen)               flags.push('FROZEN');
    if (openBtcXp > 0 && totalRaffleTickets > 0)
      flags.push('BTC_LISTING_AND_RAFFLE_ENTRIES');
    if (doubleSpendBtc > 0)
      flags.push(`DOUBLE_SPEND: ${doubleSpendBtc.toLocaleString()} XP in BTC listings exceeds balance`);
    if (transfersOut.length > 0)
      flags.push(`TRANSFERS_OUT: ${transfersOut.length} transfer(s), ${totalTransferredOut.toLocaleString()} XP total`);
    if ((user.totalImpressions || 0) === 0 && currentBalance > 1000)
      flags.push('HIGH_BALANCE_ZERO_IMPRESSIONS');
    if ((user.fraudScore || 0) >= 60)
      flags.push(`HIGH_FRAUD_SCORE: ${user.fraudScore}`);

    return res.status(200).json({
      user: {
        id: userId,
        nickname: user.nickname || '',
        email:    user.email    || '',
        refCode:  user.refCode  || '',
        frozen:   user.frozen   || false,
        frozenReason: user.frozenReason || '',
        totalSats:        currentBalance,
        totalImpressions: user.totalImpressions || 0,
        satsToday:        user.satsToday || 0,
        signupNumber:     user.signupNumber || null,
        installedAt:      user.installedAt?._seconds || null,
        lastActiveAt:     user.lastActiveAt?._seconds || null,
      },
      summary: {
        currentBalance,
        totalRaffleTickets,
        openBtcListingXp: openBtcXp,
        openScrollAskXp:  openScrollXp,
        totalTransferredOut,
        totalTransferredIn,
        doubleSpendBtc,
        flags,
      },
      raffleEntries,
      btcListings,
      scrollOrders,
      transfersOut,
      transfersIn,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
