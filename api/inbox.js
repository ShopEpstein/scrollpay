const { admin, db, initError } = require('./_firebase');

const MAX_TEXT = 1000;
const RATE_LIMIT_PER_HOUR = 10;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  // GET ?refCode=xxx — fetch all messages for that user, sorted by createdAt ASC
  if (req.method === 'GET') {
    const { refCode } = req.query;
    if (!refCode) return res.status(400).json({ error: 'Missing refCode' });

    try {
      const snap = await db.collection('sp_inbox')
        .where('refCode', '==', refCode.toUpperCase().trim())
        .get();

      const messages = [];
      snap.forEach(d => messages.push({ id: d.id, ...d.data() }));

      // Sort in memory to avoid composite index
      messages.sort((a, b) => {
        const ta = a.createdAt?._seconds || a.createdAt?.seconds || 0;
        const tb = b.createdAt?._seconds || b.createdAt?.seconds || 0;
        return ta - tb;
      });

      // Serialize Firestore timestamps to ISO strings for the client
      const serialized = messages.map(m => ({
        ...m,
        createdAt: m.createdAt
          ? new Date((m.createdAt._seconds || m.createdAt.seconds || 0) * 1000).toISOString()
          : null,
      }));

      return res.status(200).json({ messages: serialized });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST { refCode, text } — user sends message to admin
  if (req.method === 'POST') {
    const { refCode, text } = req.body || {};
    if (!refCode) return res.status(400).json({ error: 'Missing refCode' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ error: `Message too long (max ${MAX_TEXT} characters)` });
    }

    try {
      const normalizedRef = refCode.toUpperCase().trim();

      // Look up user by refCode
      const userSnap = await db.collection('sp_users')
        .where('refCode', '==', normalizedRef)
        .limit(1)
        .get();

      if (userSnap.empty) {
        return res.status(404).json({ error: 'No account found with that referral code' });
      }

      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Rate limit: max 10 messages per refCode per hour (query by refCode, filter in memory)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentSnap = await db.collection('sp_inbox')
        .where('refCode', '==', normalizedRef)
        .limit(20)
        .get();

      let recentCount = 0;
      recentSnap.forEach(d => {
        const data = d.data();
        if (data.from === 'user') {
          const ts = data.createdAt?._seconds || data.createdAt?.seconds || 0;
          if (ts * 1000 >= oneHourAgo.getTime()) recentCount++;
        }
      });

      if (recentCount >= RATE_LIMIT_PER_HOUR) {
        return res.status(429).json({ error: 'Rate limit exceeded — max 10 messages per hour' });
      }

      // Store message
      const msgRef = await db.collection('sp_inbox').add({
        userId,
        refCode: normalizedRef,
        userEmail: userData.email || '',
        userHandle: userData.nickname || '',
        from: 'user',
        text: text.trim(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ id: msgRef.id, ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
