const { admin, db, initError } = require('./_firebase');

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, website, message, totalXp, totalSats, usdEstimate } = req.body;
  if (!email || !totalXp) return res.status(400).json({ error: 'Email and XP amount are required.' });

  try {
    const ref = await db.collection('sp_sweep_orders').add({
      name:        name?.trim() || '',
      email:       email.trim().toLowerCase(),
      website:     website?.trim() || '',
      message:     message?.trim() || '',
      totalXp:     Number(totalXp) || 0,
      totalSats:   Number(totalSats) || 0,
      usdEstimate: Number(usdEstimate) || 0,
      status:      'pending',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ id: ref.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
