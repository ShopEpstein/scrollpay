const { admin, db, initError } = require('./_firebase');

const MAX_TEXT = 400;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });

  if (req.method === 'GET') {
    const { listingId } = req.query;
    if (!listingId) return res.status(400).json({ error: 'Missing listingId.' });
    try {
      const snap = await db.collection('sp_chat')
        .where('listingId', '==', listingId)
        .limit(100)
        .get();
      const messages = [];
      snap.forEach(d => {
        const data = d.data();
        messages.push({
          id: d.id,
          handle: data.handle,
          text: data.text,
          createdAt: data.createdAt?.toMillis?.() || 0,
        });
      });
      messages.sort((a, b) => a.createdAt - b.createdAt);
      return res.status(200).json({ messages });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { listingId, handle, text } = req.body || {};
    if (!listingId || !text) return res.status(400).json({ error: 'Missing listingId or text.' });
    const cleaned = String(text).trim().slice(0, MAX_TEXT);
    if (!cleaned) return res.status(400).json({ error: 'Message cannot be empty.' });
    const safeHandle = String(handle || 'Anonymous').trim().slice(0, 30) || 'Anonymous';
    try {
      // Rate-limit: no more than 5 messages per listing per minute from same handle.
      // Single where clause avoids composite index requirement; filter in memory.
      const cutoff = Date.now() - 60000;
      const recent = await db.collection('sp_chat')
        .where('listingId', '==', listingId)
        .limit(50)
        .get();
      let fromHandle = 0;
      recent.forEach(d => {
        const data = d.data();
        if (data.handle === safeHandle && (data.createdAt?.toMillis?.() || 0) > cutoff) fromHandle++;
      });
      if (fromHandle >= 5) return res.status(429).json({ error: 'Slow down — wait a moment before sending more.' });

      await db.collection('sp_chat').add({
        listingId,
        handle: safeHandle,
        text: cleaned,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
