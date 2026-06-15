const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const snap = await db.collection('sp_partners').get();
      const partners = [];
      snap.forEach(d => partners.push({ id: d.id, ...d.data() }));
      partners.sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
      return res.status(200).json({ partners });
    }

    if (req.method === 'POST') {
      const { name, slug, description, logo, website, twitter, telegram, contractAddress, chain } = req.body;
      if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const existing = await db.collection('sp_partners').where('slug', '==', cleanSlug).get();
      if (!existing.empty) return res.status(409).json({ error: 'Slug already in use' });

      const ref = db.collection('sp_partners').doc();
      await ref.set({
        name, slug: cleanSlug,
        description: description || '',
        logo: logo || '',
        website: website || '',
        twitter: twitter || '',
        telegram: telegram || '',
        contractAddress: contractAddress || '',
        chain: chain || 'solana',
        active: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ id: ref.id, slug: cleanSlug });
    }

    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const allowed = ['name','description','logo','website','twitter','telegram','contractAddress','chain','active'];
      const clean = {};
      allowed.forEach(k => { if (k in updates) clean[k] = updates[k]; });
      await db.collection('sp_partners').doc(id).update(clean);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await db.collection('sp_partners').doc(id).delete();
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
