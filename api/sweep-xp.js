const { admin, db, initError } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

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

    const xpFmt  = Number(totalXp).toLocaleString();
    const satFmt = Number(totalSats).toLocaleString();
    const usdFmt = Number(usdEstimate).toFixed(2);

    // Notify admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject: `🎯 New Campaign Request — ${xpFmt} XP`,
      html: `
        <h2 style="margin:0 0 16px;">New Campaign Request</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Name</td><td><strong>${name || '—'}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Email</td><td>${email}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Website</td><td>${website || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Total XP</td><td><strong>${xpFmt} XP</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Total sats</td><td>${satFmt} sats</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">USD estimate</td><td>$${usdFmt}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Message</td><td>${message || '—'}</td></tr>
        </table>
        <p style="margin-top:24px;"><a href="https://scrollpay.app/advertiser" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View in Admin Panel</a></p>
      `,
    });

    // Confirm to requester
    sendEmail({
      to: email.trim().toLowerCase(),
      subject: 'We received your ScrollPay campaign request',
      html: `
        <h2 style="margin:0 0 8px;">Thanks, ${name || 'there'}!</h2>
        <p style="color:#475569;">We've received your request to sweep <strong>${xpFmt} XP</strong> (~$${usdFmt} USD) and will be in touch shortly at this email address.</p>
        <p style="color:#475569;">Order reference: <code>${ref.id}</code></p>
        <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
      `,
    });

    // Notify XP sellers (fire async — don't block response)
    db.collection('sp_xp_listings').where('status', '==', 'open').get()
      .then(listingsSnap => {
        const sellerEmails = [...new Set(
          listingsSnap.docs.map(d => d.data().userEmail).filter(Boolean)
        )].slice(0, 200);
        for (const sellerEmail of sellerEmails) {
          sendEmail({
            to: sellerEmail,
            subject: `💸 New XP sweep offer — ${xpFmt} XP wanted`,
            html: `
              <h2 style="margin:0 0 12px;">A buyer wants to sweep XP</h2>
              <p style="color:#475569;margin-bottom:12px;">
                A buyer just submitted a request to purchase <strong>${xpFmt} XP</strong> (~$${usdFmt} USD).
                If you have XP listed for sale, this could be a match.
              </p>
              <p style="color:#475569;margin-bottom:20px;">
                Check the market and consider adjusting your listing price if you'd like to close this deal.
                The buyer may also make a counter-offer.
              </p>
              <p><a href="https://scrollpay.app/market" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View XP Market →</a></p>
              <p style="color:#94a3b8;font-size:12px;margin-top:32px;">— The ScrollPay Team</p>
            `,
          });
        }
      })
      .catch(() => {});

    return res.status(200).json({ id: ref.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
