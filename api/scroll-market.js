const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const MIN_XP = 100;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  // GET — public: open orders + recent trades
  if (req.method === 'GET') {
    try {
      const [ordersSnap, tradesSnap] = await Promise.all([
        db.collection('sp_scroll_orders').where('status', '==', 'open').get(),
        db.collection('sp_scroll_trades').orderBy('tradedAt', 'desc').limit(100).get(),
      ]);
      const orders = [];
      ordersSnap.forEach(d => {
        const o = d.data();
        orders.push({
          id: d.id,
          type: o.type,
          xpAmount: o.xpAmount || 0,
          scrollPerXp: o.scrollPerXp || 0,
          totalScroll: o.totalScroll || 0,
          nickname: o.nickname || '',
          solanaAddress: o.solanaAddress || '',
          createdAt: o.createdAt?._seconds || o.createdAt?.seconds || null,
        });
      });
      const trades = [];
      tradesSnap.forEach(d => {
        const t = d.data();
        trades.push({
          id: d.id,
          xpAmount: t.xpAmount || 0,
          scrollPerXp: t.scrollPerXp || 0,
          totalScroll: t.totalScroll || 0,
          side: t.side || 'sell',
          tradedAt: t.tradedAt?._seconds || t.tradedAt?.seconds || null,
        });
      });
      return res.status(200).json({ orders, trades });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — place a new bid or ask (no auth needed, verified by refCode)
  if (req.method === 'POST' && !req.headers.authorization) {
    try {
      const { type, xpAmount, scrollPerXp, refCode, solanaAddress } = req.body || {};
      if (!type || !xpAmount || !scrollPerXp || !refCode) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (!['bid', 'ask'].includes(type)) {
        return res.status(400).json({ error: 'type must be bid or ask' });
      }
      const xp = parseInt(xpAmount);
      const price = parseFloat(scrollPerXp);
      if (xp < MIN_XP) return res.status(400).json({ error: `Minimum ${MIN_XP} XP` });
      if (price <= 0) return res.status(400).json({ error: 'Price must be greater than 0' });

      const userSnap = await db.collection('sp_users')
        .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
      if (userSnap.empty) return res.status(404).json({ error: 'Ref code not found' });

      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();

      if (type === 'ask' && (userData.totalSats || 0) < xp) {
        return res.status(402).json({
          error: `Not enough XP. You have ${(userData.totalSats || 0).toLocaleString()} XP, need ${xp.toLocaleString()}.`,
        });
      }

      // Limit one open order per refCode per type
      const existingSnap = await db.collection('sp_scroll_orders')
        .where('refCode', '==', refCode.toUpperCase().trim())
        .where('type', '==', type)
        .where('status', '==', 'open')
        .limit(1).get();
      if (!existingSnap.empty) {
        return res.status(409).json({ error: `You already have an open ${type === 'ask' ? 'sell' : 'buy'} order. Cancel it first.` });
      }

      const totalScroll = Math.round(xp * price);
      const orderRef = await db.collection('sp_scroll_orders').add({
        type,
        xpAmount: xp,
        scrollPerXp: price,
        totalScroll,
        refCode: refCode.toUpperCase().trim(),
        nickname: userData.nickname || '',
        solanaAddress: (solanaAddress || '').trim(),
        status: 'open',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ id: orderRef.id, totalScroll });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — admin: fill or cancel an order, record a trade
  if (req.method === 'PATCH') {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { verifyToken } = require('./_firebase');
      const decoded = await verifyToken(authHeader.slice(7));
      if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

      const { orderId, action, txHash } = req.body || {};
      if (!orderId || !action) return res.status(400).json({ error: 'Missing orderId or action' });

      const orderRef = db.collection('sp_scroll_orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

      const order = orderSnap.data();
      if (order.status !== 'open') return res.status(400).json({ error: `Order is already ${order.status}` });

      if (action === 'cancel') {
        await orderRef.update({ status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.status(200).json({ ok: true });
      }

      if (action === 'fill') {
        // Resolve which user to debit XP from and credit to
        const userSnap = await db.collection('sp_users')
          .where('refCode', '==', order.refCode).limit(1).get();
        if (userSnap.empty) return res.status(404).json({ error: 'Order owner not found' });
        const userDoc = userSnap.docs[0];

        await db.runTransaction(async (tx) => {
          if (order.type === 'ask') {
            // Seller provided XP — deduct from their balance
            const uRef = db.collection('sp_users').doc(userDoc.id);
            const uSnap = await tx.get(uRef);
            if ((uSnap.data().totalSats || 0) < order.xpAmount) {
              throw new Error('Seller no longer has enough XP');
            }
            tx.update(uRef, { totalSats: admin.firestore.FieldValue.increment(-order.xpAmount) });
          }
          tx.update(orderRef, {
            status: 'filled',
            txHash: txHash || '',
            filledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        // Record trade
        await db.collection('sp_scroll_trades').add({
          xpAmount: order.xpAmount,
          scrollPerXp: order.scrollPerXp,
          totalScroll: order.totalScroll,
          side: order.type === 'ask' ? 'sell' : 'buy',
          refCode: order.refCode,
          nickname: order.nickname || '',
          txHash: txHash || '',
          tradedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
