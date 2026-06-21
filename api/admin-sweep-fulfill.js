const { admin, db, initError } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const { sweepOrderId, buyerEmail } = req.body || {};
    if (!sweepOrderId || !buyerEmail) {
      return res.status(400).json({ error: 'Missing sweepOrderId or buyerEmail' });
    }

    // Verify sweep order exists
    const sweepRef = db.collection('sp_sweep_orders').doc(sweepOrderId);
    const sweepSnap = await sweepRef.get();
    if (!sweepSnap.exists) return res.status(404).json({ error: 'Sweep order not found' });

    // Resolve buyer — accept email, handle, or refCode
    let buyerUid = null;
    const toTrimmed = String(buyerEmail).trim();

    if (toTrimmed.includes('@')) {
      // Email lookup via Firebase Auth
      try {
        const authUser = await admin.auth().getUserByEmail(toTrimmed);
        buyerUid = authUser.uid;
      } catch (_) {
        return res.status(404).json({ error: `No ScrollPay account found for ${toTrimmed}. Ask them to sign up first.` });
      }
    } else {
      // Handle or refCode lookup via Firestore
      const upper = toTrimmed.toUpperCase();
      let snap = await db.collection('sp_users').where('refCode', '==', upper).limit(1).get();
      if (snap.empty) snap = await db.collection('sp_users').where('nickname', '==', toTrimmed.toLowerCase()).limit(1).get();
      if (snap.empty) return res.status(404).json({ error: `User not found for "${toTrimmed}". Try their email, handle, or ref code.` });
      buyerUid = snap.docs[0].id;
    }

    const buyerRef = db.collection('sp_users').doc(buyerUid);
    const buyerSnap = await buyerRef.get();
    if (!buyerSnap.exists) {
      return res.status(404).json({ error: `User profile not found for ${toTrimmed}` });
    }

    // Get all open sell listings
    const listingsSnap = await db.collection('sp_xp_listings')
      .where('status', '==', 'open')
      .get();

    if (listingsSnap.empty) {
      return res.status(200).json({ ok: true, totalXp: 0, fulfilled: 0, message: 'No open listings to fulfill' });
    }

    const listings = [];
    listingsSnap.forEach(d => listings.push({ id: d.id, ref: d.ref, ...d.data() }));

    // Validate each seller has enough XP — batch check
    const sellerUids = [...new Set(listings.map(l => l.userId).filter(Boolean))];
    const sellerMap = {};
    await Promise.all(sellerUids.map(async uid => {
      try {
        const snap = await db.collection('sp_users').doc(uid).get();
        if (snap.exists) sellerMap[uid] = { ref: snap.ref, balance: snap.data().totalSats || 0 };
      } catch (_) {}
    }));

    // Filter out any listings where seller no longer has enough XP
    const valid = listings.filter(l => {
      const seller = sellerMap[l.userId];
      return seller && seller.balance >= l.xpAmount;
    });
    const skipped = listings.length - valid.length;

    if (valid.length === 0) {
      return res.status(400).json({ error: 'No listings could be fulfilled — sellers may have insufficient balance' });
    }

    // Execute in batches (Firestore batch limit = 500 writes)
    const totalXp = valid.reduce((sum, l) => sum + (l.xpAmount || 0), 0);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Process in chunks of 100 (each listing = 2 writes: listing + seller)
    const CHUNK = 100;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const chunk = valid.slice(i, i + CHUNK);
      const batch = db.batch();

      chunk.forEach(l => {
        // Mark listing fulfilled
        batch.update(l.ref, {
          status: 'fulfilled',
          txHash: 'xp-sweep',
          txChain: 'internal',
          txUrl: '',
          fulfilledAt: now,
          sweepOrderId,
          buyerEmail,
        });

        // Deduct XP from seller
        const seller = sellerMap[l.userId];
        if (seller) {
          batch.update(seller.ref, {
            totalSats: admin.firestore.FieldValue.increment(-l.xpAmount),
          });
        }
      });

      await batch.commit();
    }

    // Credit total XP to buyer
    await buyerRef.update({
      totalSats: admin.firestore.FieldValue.increment(totalXp),
    });

    // Mark sweep order fulfilled
    await sweepRef.update({
      status: 'fulfilled',
      xpDelivered: totalXp,
      listingsFulfilled: valid.length,
      updatedAt: now,
    });

    // Email sellers (fire-and-forget)
    valid.forEach(async l => {
      try {
        const authUser = await admin.auth().getUser(l.userId);
        if (authUser.email) {
          const xpFmt = Number(l.xpAmount || 0).toLocaleString();
          sendEmail({
            to: authUser.email,
            subject: `Your XP listing has been fulfilled — ${xpFmt} XP sold`,
            html: `
              <h2 style="margin:0 0 8px;">XP Sold!</h2>
              <p style="color:#475569;">Your listing of <strong>${xpFmt} XP</strong> has been purchased. Payment will be sent to your registered address.</p>
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
            `,
          });
        }
      } catch (_) {}
    });

    // Email buyer
    try {
      sendEmail({
        to: buyerEmail,
        subject: `ScrollPay XP Delivered — ${totalXp.toLocaleString()} XP`,
        html: `
          <h2 style="margin:0 0 8px;">Your XP has been delivered!</h2>
          <p style="color:#475569;"><strong>${totalXp.toLocaleString()} XP</strong> has been added to your ScrollPay account.</p>
          <p style="margin-top:24px;"><a href="https://scrollpay.app" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open ScrollPay</a></p>
          <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
        `,
      });
    } catch (_) {}

    return res.status(200).json({
      ok: true,
      totalXp,
      fulfilled: valid.length,
      skipped,
      buyerEmail,
    });

  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
