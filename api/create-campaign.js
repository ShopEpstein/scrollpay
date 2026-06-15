const { admin, db, initError, verifyToken } = require('./_firebase');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const CAMPAIGN_COST_XP = 50000;

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    const { brandName, brandLogo, brandWebsite, headline, ctaText, ctaUrl, dailyBudgetXp, totalBudgetXp } = req.body;

    if (!brandName || !headline || !ctaText || !ctaUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const userRef = db.collection('sp_users').doc(decoded.uid);
    const newAdRef = db.collection('sp_ads').doc();

    // Admin posts campaigns for free
    const isFree = decoded.email === ADMIN_EMAIL;

    let insufficientXp = false;
    let userBalance = 0;

    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      userBalance = userSnap.exists ? (userSnap.data().totalSats || 0) : 0;

      if (!isFree && userBalance < CAMPAIGN_COST_XP) {
        insufficientXp = true;
        return; // abort transaction body; we'll return 402 below
      }

      if (!isFree) {
        t.update(userRef, {
          totalSats: admin.firestore.FieldValue.increment(-CAMPAIGN_COST_XP),
        });
      }

      t.set(newAdRef, {
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
        active: false,
        status: 'pending',
        xpPaid: isFree ? 0 : CAMPAIGN_COST_XP,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    if (insufficientXp) {
      return res.status(402).json({
        error: `You need ${CAMPAIGN_COST_XP.toLocaleString()} XP to run a campaign. Your balance: ${userBalance.toLocaleString()} XP. Earn more by browsing with the ScrollPay extension.`,
        balance: userBalance,
        required: CAMPAIGN_COST_XP,
      });
    }

    res.status(200).json({ id: newAdRef.id });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
};

