const { admin, db, initError } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

module.exports = async (req, res) => {
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, website, message, totalXp, totalSats, usdEstimate,
          bidPricePerXp, bidTotalSats, bidPct } = req.body;
  if (!email || !totalXp) return res.status(400).json({ error: 'Email and XP amount are required.' });

  const isLowball = !!bidPricePerXp;

  try {
    const ref = await db.collection('sp_sweep_orders').add({
      name:         name?.trim() || '',
      email:        email.trim().toLowerCase(),
      website:      website?.trim() || '',
      message:      message?.trim() || '',
      totalXp:      Number(totalXp) || 0,
      totalSats:    Number(totalSats) || 0,
      usdEstimate:  Number(usdEstimate) || 0,
      bidPricePerXp: bidPricePerXp ? Number(bidPricePerXp) : null,
      bidTotalSats:  bidTotalSats ? Number(bidTotalSats) : null,
      bidPct:        bidPct ? Number(bidPct) : null,
      type:          isLowball ? 'lowball_bid' : 'campaign',
      status:       'pending',
      createdAt:    admin.firestore.FieldValue.serverTimestamp(),
    });

    const xpFmt     = Number(totalXp).toLocaleString();
    const satFmt    = Number(totalSats).toLocaleString();
    const usdFmt    = Number(usdEstimate).toFixed(2);
    const bidSatFmt = bidTotalSats ? Number(bidTotalSats).toLocaleString() : null;
    const pctLabel  = bidPct ? `${Number(bidPct).toFixed(1)}% of ask` : '';

    const bidRows = isLowball ? `
      <tr style="background:#fef9c3;"><td style="padding:8px 12px 8px 0;color:#92400e;font-weight:600;">Bid price</td><td style="color:#92400e;font-weight:700;">${Number(bidPricePerXp).toLocaleString()} sats/XP (${pctLabel})</td></tr>
      <tr style="background:#fef9c3;"><td style="padding:6px 12px 6px 0;color:#92400e;font-weight:600;">Bid total</td><td style="color:#92400e;font-weight:700;">${bidSatFmt} sats</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Market ask total</td><td>${satFmt} sats (~$${usdFmt})</td></tr>
    ` : `
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Total sats (at ask)</td><td>${satFmt} sats</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#64748b;">USD estimate</td><td>$${usdFmt}</td></tr>
    `;

    const subject = isLowball
      ? `💰 Lowball Bid — ${xpFmt} XP @ ${pctLabel}`
      : `🎯 New Campaign Request — ${xpFmt} XP`;

    // Notify admin
    sendEmail({
      to: ADMIN_EMAIL,
      subject,
      html: `
        <h2 style="margin:0 0 16px;">${isLowball ? 'Lowball Sweep Bid' : 'New Campaign Request'}</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Name</td><td><strong>${name || '—'}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Email</td><td>${email}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Website</td><td>${website || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Total XP</td><td><strong>${xpFmt} XP</strong></td></tr>
          ${bidRows}
          <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Message</td><td>${message || '—'}</td></tr>
        </table>
        <p style="margin-top:24px;"><a href="https://scrollpay.app/advertiser" style="background:#f97316;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View in Admin Panel</a></p>
      `,
    });

    // Confirm to requester
    const reqBody = isLowball
      ? `Your bid of <strong>${Number(bidPricePerXp).toLocaleString()} sats/XP</strong> (${pctLabel}) for <strong>${xpFmt} XP</strong> has been received. We'll review and respond shortly — sellers may accept, counter, or decline.`
      : `We've received your request to sweep <strong>${xpFmt} XP</strong> (~$${usdFmt} USD) and will be in touch shortly.`;

    sendEmail({
      to: email.trim().toLowerCase(),
      subject: isLowball ? 'Your XP sweep bid was received — ScrollPay' : 'We received your ScrollPay campaign request',
      html: `
        <h2 style="margin:0 0 8px;">Thanks, ${name || 'there'}!</h2>
        <p style="color:#475569;">${reqBody}</p>
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
        const sellerSubject = isLowball
          ? `💰 Lowball bid received — ${xpFmt} XP @ ${pctLabel}`
          : `💸 New XP sweep offer — ${xpFmt} XP wanted`;
        const sellerBody = isLowball
          ? `A buyer submitted a lowball bid of <strong>${Number(bidPricePerXp).toLocaleString()} sats/XP (${pctLabel} of market)</strong> for all available XP. If you're willing to accept a lower price, this could be a quick sale.`
          : `A buyer just submitted a request to purchase <strong>${xpFmt} XP</strong> (~$${usdFmt} USD). If you have XP listed, this could be a match.`;

        for (const sellerEmail of sellerEmails) {
          sendEmail({
            to: sellerEmail,
            subject: sellerSubject,
            html: `
              <h2 style="margin:0 0 12px;">${isLowball ? 'Lowball Bid on the Market' : 'A buyer wants to sweep XP'}</h2>
              <p style="color:#475569;margin-bottom:12px;">${sellerBody}</p>
              <p style="color:#475569;margin-bottom:20px;">Check the market and adjust your listing price if you'd like to close this deal.</p>
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
