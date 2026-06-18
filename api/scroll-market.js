const crypto = require('crypto');
const { admin, db, initError } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const MIN_XP = 100;
const SCROLL_TOKEN_MINT = '9yfXvj9pYzS92v8JKp7K25oFFjz9emH6nHGtbBexpump';
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
// 32-byte secret used to encrypt per-order private keys at rest
const ENCRYPT_SECRET = (process.env.ESCROW_ENCRYPT_KEY || 'scrollpay-escrow-key-changeme!!').padEnd(32).slice(0, 32);

// ── Solana helpers (no external packages needed) ──────────────────

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let s = '';
  while (n > 0n) { s = BASE58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; s = '1' + s; }
  return s;
}

// Generate a fresh Solana keypair — returns { address, secretKeyB64 }
function generateSolanaKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubBytes  = publicKey.export({ type: 'spki',  format: 'der' }).slice(-32);
  const privBytes = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
  // Solana secret key = [32-byte private || 32-byte public]
  const secretKey = Buffer.concat([privBytes, pubBytes]);
  return { address: base58Encode(pubBytes), secretKeyB64: secretKey.toString('base64') };
}

// AES-256-CBC encrypt/decrypt for private key storage
function encryptKey(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPT_SECRET), iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}
function decryptKey(ciphertext) {
  const [ivHex, encHex] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPT_SECRET), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
}

// Check how many SCROLL tokens are held at a Solana address
async function getScrollBalance(walletAddress) {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [walletAddress, { mint: SCROLL_TOKEN_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    const data = await res.json();
    return (data?.result?.value || []).reduce(
      (sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0
    );
  } catch (_) { return 0; }
}

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  // ── GET — public order book + recent trades ───────────────────
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
          id: d.id, type: o.type,
          xpAmount: o.xpAmount || 0, scrollPerXp: o.scrollPerXp || 0,
          totalScroll: o.totalScroll || 0, nickname: o.nickname || '',
          solanaAddress: o.solanaAddress || '',
          createdAt: o.createdAt?._seconds || o.createdAt?.seconds || null,
        });
      });
      const trades = [];
      tradesSnap.forEach(d => {
        const t = d.data();
        trades.push({
          id: d.id, xpAmount: t.xpAmount || 0,
          scrollPerXp: t.scrollPerXp || 0, totalScroll: t.totalScroll || 0,
          side: t.side || 'sell', tradedAt: t.tradedAt?._seconds || t.tradedAt?.seconds || null,
        });
      });
      return res.status(200).json({ orders, trades });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — place order or confirm bid deposit ─────────────────
  if (req.method === 'POST' && !req.headers.authorization) {
    try {
      const body = req.body || {};

      // ── Step 2: buyer confirms SCROLL was sent to escrow wallet ─
      if (body.action === 'confirm_bid') {
        const { orderId, refCode } = body;
        if (!orderId || !refCode) return res.status(400).json({ error: 'Missing orderId or refCode' });

        const orderRef = db.collection('sp_scroll_orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

        const order = orderSnap.data();
        if (order.refCode !== refCode.toUpperCase().trim()) {
          return res.status(403).json({ error: 'Ref code does not match this order' });
        }
        if (order.status === 'open') return res.status(200).json({ ok: true, alreadyActive: true });
        if (order.status !== 'awaiting_deposit') {
          return res.status(400).json({ error: `Order is ${order.status}` });
        }

        // Check on-chain balance at the per-order escrow wallet
        const balance = await getScrollBalance(order.escrowAddress);
        if (balance < order.totalScroll - 1) {
          return res.status(402).json({
            error: `Escrow wallet shows ${balance} SCROLL — need ${order.totalScroll}. Send the SCROLL first, then confirm.`,
            balance, required: order.totalScroll,
          });
        }

        await orderRef.update({ status: 'open', depositConfirmedAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.status(200).json({ ok: true, activated: true, balance });
      }

      // ── Step 1: place a new ask or bid ─────────────────────────
      const { type, xpAmount, scrollPerXp, refCode, solanaAddress } = body;
      if (!type || !xpAmount || !scrollPerXp || !refCode) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      if (!['bid', 'ask'].includes(type)) {
        return res.status(400).json({ error: 'type must be bid or ask' });
      }
      const xp    = parseInt(xpAmount);
      const price = parseFloat(scrollPerXp);
      if (xp < MIN_XP)  return res.status(400).json({ error: `Minimum ${MIN_XP} XP` });
      if (price <= 0)   return res.status(400).json({ error: 'Price must be greater than 0' });

      const userSnap = await db.collection('sp_users')
        .where('refCode', '==', refCode.toUpperCase().trim()).limit(1).get();
      if (userSnap.empty) return res.status(404).json({ error: 'Ref code not found' });

      const userDoc  = userSnap.docs[0];
      const userData = userDoc.data();
      const totalScroll = Math.round(xp * price);

      // ── ASK: sell XP → lock it immediately ────────────────────
      if (type === 'ask') {
        const existingSnap = await db.collection('sp_scroll_orders')
          .where('refCode', '==', refCode.toUpperCase().trim())
          .where('type', '==', 'ask').where('status', '==', 'open').limit(1).get();
        if (!existingSnap.empty) {
          return res.status(409).json({ error: 'You already have an open sell order. Cancel it first.' });
        }

        // Cross-market: block if user has an open BTC marketplace listing
        const btcSnap = await db.collection('sp_xp_listings')
          .where('userId', '==', userDoc.id).where('status', '==', 'open').limit(1).get();
        if (!btcSnap.empty) {
          return res.status(409).json({
            error: 'You have an open BTC marketplace listing. Cancel it first — the same XP cannot be listed in both markets.',
          });
        }

        // Atomic: deduct XP + create order in one Firestore transaction
        const orderRef = db.collection('sp_scroll_orders').doc();
        try {
          await db.runTransaction(async (tx) => {
            const uRef  = db.collection('sp_users').doc(userDoc.id);
            const uSnap = await tx.get(uRef);
            const currentXp = uSnap.data().totalSats || 0;
            if (currentXp < xp) throw new Error(`Not enough XP. Have ${currentXp.toLocaleString()}, need ${xp.toLocaleString()}.`);
            tx.update(uRef, { totalSats: admin.firestore.FieldValue.increment(-xp) });
            tx.set(orderRef, {
              type: 'ask', xpAmount: xp, scrollPerXp: price, totalScroll,
              refCode: refCode.toUpperCase().trim(), userId: userDoc.id,
              nickname: userData.nickname || '', solanaAddress: (solanaAddress || '').trim(),
              status: 'open', xpEscrowed: true,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          });
        } catch (txErr) {
          return res.status(402).json({ error: txErr.message });
        }
        return res.status(200).json({ id: orderRef.id, totalScroll, xpLocked: xp });
      }

      // ── BID: buy XP with SCROLL → generate unique escrow wallet
      if (type === 'bid') {
        const existingSnap = await db.collection('sp_scroll_orders')
          .where('refCode', '==', refCode.toUpperCase().trim())
          .where('type', '==', 'bid')
          .where('status', 'in', ['open', 'awaiting_deposit']).limit(1).get();
        if (!existingSnap.empty) {
          const existing = existingSnap.docs[0].data();
          // Return the existing escrow address so the buyer can complete it
          return res.status(409).json({
            error: 'You already have an open buy order.',
            existingOrderId: existingSnap.docs[0].id,
            escrowAddress: existing.escrowAddress,
            scrollAmount: existing.totalScroll,
            status: existing.status,
          });
        }

        // Generate a fresh Solana wallet for this order only
        const escrowWallet = generateSolanaKeypair();
        const encryptedKey  = encryptKey(escrowWallet.secretKeyB64);

        const orderRef = await db.collection('sp_scroll_orders').add({
          type: 'bid', xpAmount: xp, scrollPerXp: price, totalScroll,
          refCode: refCode.toUpperCase().trim(), userId: userDoc.id,
          nickname: userData.nickname || '', solanaAddress: (solanaAddress || '').trim(),
          escrowAddress: escrowWallet.address,
          escrowPrivateKey: encryptedKey,   // AES-256 encrypted at rest
          scrollEscrowed: false,            // becomes true after confirm_bid
          status: 'awaiting_deposit',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.status(200).json({
          id: orderRef.id,
          escrowAddress: escrowWallet.address,
          scrollAmount: totalScroll,
          status: 'awaiting_deposit',
          instructions: `Send exactly ${totalScroll.toLocaleString()} SCROLL to the address above, then click "Confirm Deposit".`,
        });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH — admin: fill or cancel ────────────────────────────
  if (req.method === 'PATCH') {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { verifyToken } = require('./_firebase');
      const decoded = await verifyToken(authHeader.slice(7));
      if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

      const { orderId, action, txHash } = req.body || {};
      if (!orderId || !action) return res.status(400).json({ error: 'Missing orderId or action' });

      const orderRef  = db.collection('sp_scroll_orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

      const order = orderSnap.data();
      if (!['open', 'awaiting_deposit'].includes(order.status)) {
        return res.status(400).json({ error: `Order is already ${order.status}` });
      }

      // ── Cancel ───────────────────────────────────────────────
      if (action === 'cancel') {
        await db.runTransaction(async (tx) => {
          tx.update(orderRef, {
            status: 'cancelled',
            cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          // Return escrowed XP to seller automatically
          if (order.type === 'ask' && order.xpEscrowed && order.userId) {
            tx.update(db.collection('sp_users').doc(order.userId), {
              totalSats: admin.firestore.FieldValue.increment(order.xpAmount),
            });
          }
        });

        const scrollNote = (order.type === 'bid' && order.escrowAddress)
          ? `Check escrow wallet ${order.escrowAddress} — if funded, return ${order.totalScroll} SCROLL to buyer at ${order.solanaAddress}`
          : null;
        return res.status(200).json({
          ok: true,
          xpReturned: order.type === 'ask' && order.xpEscrowed ? order.xpAmount : 0,
          scrollNote,
        });
      }

      // ── Fill ─────────────────────────────────────────────────
      if (action === 'fill') {
        if (order.status !== 'open') {
          return res.status(400).json({ error: 'Order must be open (deposit confirmed) to fill.' });
        }

        const userSnap = await db.collection('sp_users')
          .where('refCode', '==', order.refCode).limit(1).get();
        if (userSnap.empty) return res.status(404).json({ error: 'Order owner not found' });
        const userDoc = userSnap.docs[0];

        await db.runTransaction(async (tx) => {
          if (order.type === 'ask') {
            if (!order.xpEscrowed) {
              // Legacy order (pre-escrow): deduct XP now
              const uRef  = db.collection('sp_users').doc(userDoc.id);
              const uSnap = await tx.get(uRef);
              if ((uSnap.data().totalSats || 0) < order.xpAmount) {
                throw new Error('Seller no longer has enough XP');
              }
              tx.update(uRef, { totalSats: admin.firestore.FieldValue.increment(-order.xpAmount) });
            }
            // If xpEscrowed, XP was already locked at order placement — nothing to deduct
          }
          tx.update(orderRef, {
            status: 'filled', txHash: txHash || '',
            filledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        // Record trade
        await db.collection('sp_scroll_trades').add({
          xpAmount: order.xpAmount, scrollPerXp: order.scrollPerXp,
          totalScroll: order.totalScroll, side: order.type === 'ask' ? 'sell' : 'buy',
          refCode: order.refCode, nickname: order.nickname || '',
          txHash: txHash || '', tradedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // For bids, expose the escrow key so admin can transfer SCROLL to seller
        let escrowNote = null;
        if (order.type === 'bid' && order.escrowPrivateKey) {
          try {
            const secretKeyB64 = decryptKey(order.escrowPrivateKey);
            escrowNote = {
              escrowAddress: order.escrowAddress,
              secretKeyB64,
              sellerSolanaAddress: order.solanaAddress,
              scrollAmount: order.totalScroll,
              note: 'Import secretKeyB64 (base64) as Solana keypair to release SCROLL to seller.',
            };
          } catch (_) {}
        }

        return res.status(200).json({ ok: true, escrowNote });
      }

      return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
