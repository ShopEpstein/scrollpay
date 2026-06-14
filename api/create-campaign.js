const { admin, db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    const { brandName, brandLogo, brandWebsite, headline, ctaText, ctaUrl, dailyBudgetXp, totalBudgetXp } = req.body;

    if (!brandName || !headline || !ctaText || !ctaUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ref = await db.collection('sp_ads').add({
      ownerId: decoded.uid,
      ownerEmail: decoded.email || '',
      brandName,
      brandLogo: brandLogo || '',
      brandWebsite: brandWebsite || '',
      headline,
      ctaText,
      ctaUrl,
      dailyBudgetXp: dailyBudgetXp || 0,
      totalBudgetXp: totalBudgetXp || 0,
      budgetUsed: 0,
      impressions: 0,
      clicks: 0,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ id: ref.id });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};
