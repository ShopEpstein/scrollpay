const { db, initError, verifyToken } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';

const SUMMARY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ScrollPay — Week 1 Sweep Summary</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:28px 16px 48px;">

  <!-- Logo -->
  <div style="text-align:center;padding:24px 0 20px;">
    <div style="font-size:32px;font-weight:900;color:#f7931a;letter-spacing:-1px;">⚡ ScrollPay</div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px;letter-spacing:2.5px;text-transform:uppercase;">Bitcoin &ldquo;Mining&rdquo; Platform</div>
  </div>

  <!-- Hero banner -->
  <div style="background:linear-gradient(145deg,#0f1a00 0%,#001a0f 50%,#0a1200 100%);border:2px solid #f7931a;border-radius:22px;padding:44px 28px;text-align:center;margin-bottom:20px;">
    <div style="font-size:13px;color:#6b7280;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">First Ever</div>
    <div style="font-size:34px;font-weight:900;color:#ffffff;line-height:1.2;margin-bottom:8px;">Week 1 Sweep<br>Complete ✅</div>
    <div style="font-size:13px;color:#9ca3af;margin-top:10px;line-height:1.6;">Extension not officially launched &nbsp;·&nbsp; Zero paid ads &nbsp;·&nbsp; Pure organic</div>
  </div>

  <!-- Headline stats grid -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
    <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:20px 18px;text-align:center;">
      <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">XP Swept</div>
      <div style="font-size:36px;font-weight:900;color:#f7931a;line-height:1;">72,930</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">units of attention</div>
    </div>
    <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:20px 18px;text-align:center;">
      <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Sellers Paid</div>
      <div style="font-size:36px;font-weight:900;color:#60a5fa;line-height:1;">16</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">&ldquo;miners&rdquo; cashed out</div>
    </div>
  </div>

  <!-- Money stats -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:24px;margin-bottom:12px;">
    <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:18px;">💰 Bitcoin Flow</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #1f2937;">
        <td style="color:#9ca3af;font-size:13px;padding:10px 0;">Advertiser paid in</td>
        <td style="text-align:right;padding:10px 0;">
          <span style="color:#f3f4f6;font-weight:700;">1,179,644 sats</span>
          <span style="color:#6b7280;font-size:12px;"> &nbsp;~$762</span>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #1f2937;">
        <td style="color:#f7931a;font-size:13px;padding:10px 0;">ScrollPay fee (30%)</td>
        <td style="text-align:right;padding:10px 0;">
          <span style="color:#f7931a;font-weight:700;">353,893 sats</span>
          <span style="color:#6b7280;font-size:12px;"> &nbsp;~$229</span>
        </td>
      </tr>
      <tr>
        <td style="color:#4ade80;font-size:14px;font-weight:700;padding:10px 0;">Paid to &ldquo;miners&rdquo; (70%)</td>
        <td style="text-align:right;padding:10px 0;">
          <span style="color:#4ade80;font-size:18px;font-weight:900;">825,751 sats</span>
          <span style="color:#86efac;font-size:13px;"> &nbsp;~$534</span>
        </td>
      </tr>
    </table>
  </div>

  <!-- Top & bottom -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
    <div style="background:linear-gradient(145deg,#0f1a00,#001200);border:1px solid #16a34a;border-radius:14px;padding:20px 16px;text-align:center;">
      <div style="font-size:20px;margin-bottom:6px;">🥇</div>
      <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Top Payout</div>
      <div style="font-size:26px;font-weight:900;color:#4ade80;line-height:1;">350,000</div>
      <div style="font-size:13px;color:#86efac;margin-top:3px;">sats &nbsp;·&nbsp; ~$226</div>
    </div>
    <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:20px 16px;text-align:center;">
      <div style="font-size:20px;margin-bottom:6px;">🎯</div>
      <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Bottom Payout</div>
      <div style="font-size:26px;font-weight:900;color:#f3f4f6;line-height:1;">2,310</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:3px;">sats &nbsp;·&nbsp; ~$1.49</div>
    </div>
  </div>

  <!-- How it works -->
  <div style="background:linear-gradient(145deg,#080818,#0a0820);border:1px solid #3730a3;border-radius:14px;padding:24px;margin-bottom:12px;">
    <div style="font-size:11px;color:#818cf8;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">⚙️ How the Ecosystem Works</div>
    <div style="color:#c7d2fe;font-size:13px;line-height:2.1;">
      <span style="color:#f7931a;font-weight:700;">1.</span> &nbsp;Users install the extension &amp; start &ldquo;mining&rdquo; XP by viewing ads while browsing<br>
      <span style="color:#f7931a;font-weight:700;">2.</span> &nbsp;XP accumulates in their wallet — every ad viewed = sats earned<br>
      <span style="color:#f7931a;font-weight:700;">3.</span> &nbsp;Users list their XP on the ScrollPay market<br>
      <span style="color:#f7931a;font-weight:700;">4.</span> &nbsp;Advertisers run XP sweep orders — buying batches of XP to reach verified viewers<br>
      <span style="color:#f7931a;font-weight:700;">5.</span> &nbsp;ScrollPay takes 30%, 70% goes directly to the &ldquo;miner&rdquo; in Bitcoin
    </div>
  </div>

  <!-- Context -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:22px 24px;margin-bottom:24px;">
    <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">📅 Context</div>
    <div style="color:#9ca3af;font-size:13px;line-height:2.1;">
      ⏱️ &nbsp;<strong style="color:#f3f4f6;">Age of network:</strong> 1 week<br>
      🔌 &nbsp;<strong style="color:#f3f4f6;">Extension status:</strong> Not on Chrome Web Store yet — manual install only<br>
      📣 &nbsp;<strong style="color:#f3f4f6;">Marketing spend:</strong> $0 — 100% organic<br>
      🌐 &nbsp;<strong style="color:#f3f4f6;">Website:</strong> scrollpay.app<br>
      📦 &nbsp;<strong style="color:#f3f4f6;">Next sweep:</strong> TBD
    </div>
  </div>

  <!-- X Thread copy -->
  <div style="background:#0a0a14;border:1px solid #374151;border-radius:14px;padding:22px 24px;margin-bottom:24px;">
    <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">𝕏 Thread Copy</div>

    <div style="border-left:3px solid #f7931a;padding-left:14px;margin-bottom:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">1/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">We're 1 week old. The extension isn't officially on the Chrome Web Store yet.<br>We just completed our first XP sweep and paid out real Bitcoin to 16 people.<br><br>Here's the breakdown 🧡⚡</div>
    </div>

    <div style="border-left:3px solid #374151;padding-left:14px;margin-bottom:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">2/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">How it works:<br><br>Install ScrollPay → "mine" XP just by browsing the web → list your XP on our market → advertisers buy it to reach real viewers → you get paid in Bitcoin.<br><br>No hardware. No energy bill. Just scroll.</div>
    </div>

    <div style="border-left:3px solid #374151;padding-left:14px;margin-bottom:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">3/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">Week 1 sweep results:<br><br>📦 72,930 XP swept<br>💰 1,179,644 sats paid in (~$762)<br>₿ 825,751 sats paid out to "miners" (~$534)<br>👥 16 sellers paid<br><br>Before an official launch. Before any paid ads. Pure organic.</div>
    </div>

    <div style="border-left:3px solid #374151;padding-left:14px;margin-bottom:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">4/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">Top "miner" payout: 350,000 sats (~$226) 🥇<br>Bottom "miner" payout: 2,310 sats (~$1.49)<br><br>Every single person who listed XP got paid.<br>On-chain. Verified. Done.</div>
    </div>

    <div style="border-left:3px solid #374151;padding-left:14px;margin-bottom:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">5/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">The extension isn't even on the Chrome Web Store yet.<br><br>We're a week old and already moving real Bitcoin to real people just for browsing the internet.<br><br>Imagine month one.</div>
    </div>

    <div style="border-left:3px solid #374151;padding-left:14px;">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">6/6</div>
      <div style="color:#e5e7eb;font-size:13px;line-height:1.7;">"Mining" is open right now.<br><br>Install → browse → earn XP → cash out BTC.<br><br>scrollpay.app<br><br>#Bitcoin #ScrollPay #BTC</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;">
    <div style="color:#374151;font-size:12px;margin-bottom:4px;">
      <a href="https://scrollpay.app" style="color:#f7931a;text-decoration:none;font-weight:700;">scrollpay.app</a>
    </div>
    <div style="color:#374151;font-size:11px;">ScrollPay Internal — Sweep Summary Report</div>
  </div>

</div>
</body>
</html>`;

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

    await sendEmail({
      to: ADMIN_EMAIL,
      subject: '⚡ ScrollPay — Week 1 Sweep Summary + X Thread',
      html: SUMMARY_HTML,
    });

    await db.collection('sp_email_logs').add({
      type:    'sweep_summary_report',
      to:      ADMIN_EMAIL,
      sentAt:  new Date(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
