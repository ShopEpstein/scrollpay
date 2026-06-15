const { db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'public, s-maxage=60');

  const { slug } = req.query;

  if (slug) {
    const snap = await db.collection('sp_partners').where('slug', '==', slug).where('active', '==', true).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'Not found' });
    const doc = snap.docs[0];
    return res.status(200).json({ partner: { id: doc.id, ...doc.data() } });
  }

  const snap = await db.collection('sp_partners').where('active', '==', true).get();
  const partners = [];
  snap.forEach(d => partners.push({ id: d.id, ...d.data() }));
  partners.sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
  return res.status(200).json({ partners });
};
