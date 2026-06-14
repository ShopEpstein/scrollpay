const { admin, db, initError, verifyToken } = require('./_firebase');

const MIN_TRANSFER = 10;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  const { to, amount } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!to || !Number.isFinite(amt) || amt < MIN_TRANSFER) {
    return res.status(400).json({ error: `Enter a recipient and an amount of at least ${MIN_TRANSFER} XP.` });
  }

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const fromUid = decoded.uid;

    // Find recipient by nickname (lowercase) or refCode (uppercase)
    const toStr = to.trim();
    let recipientDoc = null;

    const byNickname = await db.collection('sp_users')
      .where('nickname', '==', toStr.toLowerCase())
      .limit(1).get();
    if (!byNickname.empty) {
      recipientDoc = byNickname.docs[0];
    } else {
      const byRefCode = await db.collection('sp_users')
        .where('refCode', '==', toStr.toUpperCase())
        .limit(1).get();
      if (!byRefCode.empty) recipientDoc = byRefCode.docs[0];
    }

    if (!recipientDoc) {
      return res.status(404).json({ error: 'Recipient not found. Check the handle or referral code.' });
    }

    const toUid = recipientDoc.id;
    if (toUid === fromUid) {
      return res.status(400).json({ error: 'Cannot transfer XP to yourself.' });
    }

    const fromRef = db.collection('sp_users').doc(fromUid);
    const toRef   = db.collection('sp_users').doc(toUid);
    let toHandle  = '';

    await db.runTransaction(async (tx) => {
      const fromSnap = await tx.get(fromRef);
      const toSnap   = await tx.get(toRef);

      if (!fromSnap.exists) throw Object.assign(new Error('Sender account not found.'),   { status: 404 });
      if (!toSnap.exists)   throw Object.assign(new Error('Recipient account not found.'), { status: 404 });

      const balance = fromSnap.data().totalSats || 0;
      if (balance < amt) {
        throw Object.assign(
          new Error(`Insufficient XP. You have ${balance} XP.`),
          { status: 400 }
        );
      }

      toHandle = toSnap.data().nickname || `Miner #${toSnap.data().signupNumber || '?'}`;

      tx.update(fromRef, { totalSats: admin.firestore.FieldValue.increment(-amt) });
      tx.update(toRef,   { totalSats: admin.firestore.FieldValue.increment(amt)  });
    });

    // Audit log (best-effort, outside transaction)
    db.collection('sp_transfers').add({
      fromUid,
      toUid,
      amount: amt,
      toHandle,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});

    return res.status(200).json({ success: true, toHandle, amount: amt });
  } catch (err) {
    const status = err.status || (err.code?.startsWith('auth/') ? 401 : 500);
    return res.status(status).json({ error: err.message });
  }
};
