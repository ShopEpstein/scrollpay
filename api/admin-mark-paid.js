const { admin, db, initError, verifyToken } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const PLATFORM_FEE = 0.30;

function buildPaymentEmail({ handle, netSats, netUsd, txNote, referralUrl, xShareUrl, fbShareUrl, ttShareUrl, paidDate }) {
  const name = handle ? `@${handle}` : 'Seller';
  const usdLine = netUsd ? ` <span style="color:#fbbf24;font-size:22px;">≈&nbsp;$${netUsd}&nbsp;USD</span>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You've been paid — ScrollPay</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px 40px;">

  <!-- Logo -->
  <div style="text-align:center;padding:28px 0 20px;">
    <div style="font-size:30px;font-weight:900;color:#f7931a;letter-spacing:-1px;">⚡ ScrollPay</div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px;letter-spacing:2.5px;text-transform:uppercase;">Bitcoin &ldquo;Mining&rdquo; Platform</div>
  </div>

  <!-- Hero -->
  <div style="background:linear-gradient(145deg,#0f1a07 0%,#071a0f 50%,#0a1200 100%);border:1px solid #16a34a;border-radius:22px;padding:44px 28px 36px;text-align:center;margin-bottom:18px;box-shadow:0 0 60px rgba(22,163,74,0.15);">
    <div style="font-size:52px;line-height:1;margin-bottom:14px;">🎉</div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;">Congratulations, ${name}</div>
    <div style="font-size:15px;color:#9ca3af;margin-bottom:18px;">You've been paid in real Bitcoin</div>
    <div style="font-size:58px;font-weight:900;color:#f7931a;line-height:1;letter-spacing:-2px;">${netSats.toLocaleString()}</div>
    <div style="font-size:16px;color:#fbbf24;font-weight:700;margin:4px 0 22px;">sats${usdLine}</div>
    <div style="display:inline-block;background:rgba(22,163,74,0.15);border:1px solid #16a34a;border-radius:30px;padding:8px 22px;">
      <span style="color:#4ade80;font-size:13px;font-weight:800;letter-spacing:1px;">✓ &nbsp;REAL BTC &nbsp;·&nbsp; PAID IN FULL</span>
    </div>
  </div>

  <!-- Payment details -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:20px 24px;margin-bottom:18px;">
    <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Payment Details</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="color:#6b7280;font-size:13px;padding:8px 0;border-bottom:1px solid #1f2937;">Reference / TXN</td>
        <td style="text-align:right;padding:8px 0;border-bottom:1px solid #1f2937;">
          <span style="color:#f3f4f6;font-size:13px;font-weight:700;font-family:monospace;word-break:break-all;">${txNote}</span>
        </td>
      </tr>
      <tr>
        <td style="color:#6b7280;font-size:13px;padding:8px 0;border-bottom:1px solid #1f2937;">Amount paid</td>
        <td style="text-align:right;color:#f7931a;font-size:13px;font-weight:700;padding:8px 0;border-bottom:1px solid #1f2937;">${netSats.toLocaleString()} sats${netUsd ? ` (~$${netUsd})` : ''}</td>
      </tr>
      <tr>
        <td style="color:#6b7280;font-size:13px;padding:8px 0;">Date</td>
        <td style="text-align:right;color:#f3f4f6;font-size:13px;padding:8px 0;">${paidDate}</td>
      </tr>
    </table>
  </div>

  <!-- How you mined this -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
    <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">How you &ldquo;mined&rdquo; this</div>
    <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0;">
      You listed your ScrollPay XP on the market, and advertisers bought it to reach real viewers who &ldquo;mine&rdquo; Bitcoin simply by scrolling. No GPUs, no energy bills — just scroll, earn sats, cash out.
      <br><br>
      <span style="color:#f7931a;font-weight:700;">You just got paid real BTC for being part of the future of advertising.</span> ⚡
    </p>
  </div>

  <!-- Share section -->
  <div style="background:linear-gradient(145deg,#12080a 0%,#08080f 100%);border:2px solid #f7931a;border-radius:22px;padding:36px 28px;margin-bottom:18px;text-align:center;">
    <div style="font-size:36px;margin-bottom:10px;">🚀</div>
    <div style="font-size:20px;font-weight:900;color:#ffffff;line-height:1.3;margin-bottom:10px;">Show the world you get paid<br>to browse the internet</div>
    <p style="color:#9ca3af;font-size:13px;line-height:1.7;margin:0 0 28px;">
      Invite friends to &ldquo;mine&rdquo; Bitcoin with you using your personal referral link.
      Every person who joins scrolls, &ldquo;mines&rdquo;, and grows the network alongside you.
    </p>

    <!-- Share buttons -->
    <div style="margin-bottom:20px;">
      <a href="${xShareUrl}" target="_blank"
        style="display:inline-block;margin:5px;background:#000000;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:800;border:1px solid #333;">
        𝕏 &nbsp;Share on X
      </a>
      <a href="${fbShareUrl}" target="_blank"
        style="display:inline-block;margin:5px;background:#1877f2;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:800;">
        f &nbsp;Share on Facebook
      </a>
      <a href="${ttShareUrl}" target="_blank"
        style="display:inline-block;margin:5px;background:#010101;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:800;border:1px solid #fe2c55;">
        ♪ &nbsp;Share on TikTok
      </a>
      <span
        style="display:inline-block;margin:5px;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4);color:#ffffff;padding:13px 22px;border-radius:10px;font-size:13px;font-weight:800;">
        📸 &nbsp;Instagram: copy link ↓
      </span>
    </div>

    <!-- Referral link box -->
    <div style="font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Your referral link</div>
    <div style="background:#0a0a0a;border:1px solid #f7931a;border-radius:10px;padding:14px 18px;font-family:monospace;font-size:14px;color:#f7931a;word-break:break-all;font-weight:700;">
      ${referralUrl}
    </div>
    <div style="font-size:12px;color:#6b7280;margin-top:10px;">Copy &amp; paste this into any bio, post, or story</div>
  </div>

  <!-- CTA button -->
  <div style="text-align:center;margin-bottom:28px;">
    <a href="${referralUrl}" target="_blank"
      style="display:inline-block;background:linear-gradient(135deg,#f7931a,#f5a623);color:#000;text-decoration:none;padding:16px 48px;border-radius:50px;font-size:15px;font-weight:900;letter-spacing:.5px;">
      Start &ldquo;Mining&rdquo; Again →
    </a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:16px 0;">
    <div style="color:#374151;font-size:12px;margin-bottom:6px;">
      <a href="https://scrollpay.app" style="color:#f7931a;text-decoration:none;font-weight:700;">scrollpay.app</a>
      &nbsp;·&nbsp;
      <a href="https://scrollpay.app/privacy" style="color:#6b7280;text-decoration:none;">Privacy</a>
    </div>
    <div style="color:#374151;font-size:11px;line-height:1.6;">The future of advertising is here. Keep &ldquo;mining.&rdquo; ⚡<br>You're receiving this because you sold XP on ScrollPay.</div>
  </div>

</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (initError) return res.status(500).json({ error: initError.message });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await verifyToken(authHeader.slice(7));
    if (decoded.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

    const { userId, userEmail, handle, sweepOrderId, grossSats, txNote } = req.body || {};
    if (!userId || !grossSats) return res.status(400).json({ error: 'Missing userId or grossSats' });
    if (!txNote || !txNote.trim()) return res.status(400).json({ error: 'txNote is required' });

    const feeSats = Math.round(grossSats * PLATFORM_FEE);
    const netSats = grossSats - feeSats;
    const paidDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // BTC price for USD display in email
    let netUsd = null;
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const priceData = await priceRes.json();
      const btcUsd = priceData?.bitcoin?.usd || 0;
      if (btcUsd) netUsd = (netSats * btcUsd / 1e8).toFixed(2);
    } catch (_) {}

    // Save payout record
    const payoutRef = await db.collection('sp_payouts').add({
      userId,
      userEmail: userEmail || '',
      handle:    handle    || null,
      sweepOrderId: sweepOrderId || null,
      grossSats,
      feeSats,
      netSats,
      txNote: txNote.trim(),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: ADMIN_EMAIL,
    });

    // Send payment confirmation email
    let emailSent = false;
    if (userEmail) {
      const referralCode = handle || userId;
      const referralUrl  = `https://scrollpay.app/r/${encodeURIComponent(referralCode)}`;

      const tweetText = encodeURIComponent(`Just got paid in Bitcoin for "mining" BTC while browsing! 🧡⚡\n\nScroll ads → earn XP → cash out real sats.\n\nJoin me 👇`);
      const xShareUrl  = `https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(referralUrl)}`;
      const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralUrl)}`;
      const ttText     = encodeURIComponent(`I got paid Bitcoin for "mining" while browsing! Join me on ScrollPay`);
      const ttShareUrl = `https://www.tiktok.com/share?url=${encodeURIComponent(referralUrl)}&title=${ttText}`;

      const html = buildPaymentEmail({ handle, netSats, netUsd, txNote: txNote.trim(), referralUrl, xShareUrl, fbShareUrl, ttShareUrl, paidDate });

      await sendEmail({
        to: userEmail,
        subject: `💸 You've been paid ${netSats.toLocaleString()} sats${netUsd ? ` (~$${netUsd})` : ''} — ScrollPay`,
        html,
      });
      emailSent = true;

      // Update payout record with emailSent flag
      await payoutRef.update({ emailSent: true });

      // Log the email send
      await db.collection('sp_email_logs').add({
        type:       'payout_confirmation',
        userId,
        userEmail,
        handle:     handle || null,
        payoutId:   payoutRef.id,
        netSats,
        emailSent:  true,
        sentAt:     admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return res.status(200).json({ ok: true, netSats, feeSats, emailSent });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
