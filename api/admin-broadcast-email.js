const { admin, db, initError, verifyToken } = require('./_firebase');
const { sendEmail } = require('./_email');

const ADMIN_EMAIL = 'contactfire757@gmail.com';
const BATCH_SIZE  = 10;   // concurrent sends per wave
const WAVE_DELAY  = 300;  // ms between waves

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildBroadcastEmail({ nickname, btcAddress, solAddress, handle }) {
  const name      = nickname ? `@${nickname}` : 'Miner';
  const hasBtc    = !!btcAddress;
  const hasSol    = !!solAddress;
  const hasHandle = !!handle;

  const missingItems = [];
  if (!hasBtc)    missingItems.push('₿ BTC address (native Bitcoin network)');
  if (!hasSol)    missingItems.push('◎ Solana address (for wBTC / SOL payments)');
  if (!hasHandle) missingItems.push('🏷️ "Miner" handle / username');

  const missingHtml = missingItems.length > 0
    ? `<div style="background:#1a0a00;border:2px solid #dc2626;border-radius:14px;padding:20px 24px;margin-bottom:20px;">
         <div style="font-size:11px;color:#dc2626;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">⚠️ Missing from your profile</div>
         ${missingItems.map(i => `<div style="color:#fca5a5;font-size:13px;padding:5px 0;border-bottom:1px solid #2a1a1a;">${i}</div>`).join('')}
       </div>`
    : `<div style="background:#0f1a07;border:1px solid #16a34a;border-radius:14px;padding:16px 24px;margin-bottom:20px;text-align:center;">
         <div style="color:#4ade80;font-size:14px;font-weight:700;">✓ Your profile looks complete — you're all set to receive payments!</div>
       </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sweep Payouts Have Begun — ScrollPay</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px 40px;">

  <!-- Logo -->
  <div style="text-align:center;padding:28px 0 20px;">
    <div style="font-size:30px;font-weight:900;color:#f7931a;letter-spacing:-1px;">⚡ ScrollPay</div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px;letter-spacing:2.5px;text-transform:uppercase;">Bitcoin &ldquo;Mining&rdquo; Platform</div>
  </div>

  <!-- Hero -->
  <div style="background:linear-gradient(145deg,#0f1200 0%,#0a1a07 50%,#001a0a 100%);border:2px solid #f7931a;border-radius:22px;padding:44px 28px 36px;text-align:center;margin-bottom:20px;">
    <div style="font-size:52px;line-height:1;margin-bottom:14px;">🚀</div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">Important Update for ${name}</div>
    <div style="font-size:26px;font-weight:900;color:#ffffff;line-height:1.3;margin-bottom:16px;">
      Sweep Payouts<br>Have Begun ⚡
    </div>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 22px;">
      The first wave of Bitcoin payouts from XP sweep orders is going out <strong style="color:#f7931a;">right now.</strong>
      To make sure you receive your earnings — and unlock every upcoming feature — you need to complete your payment profile.
    </p>
    <div style="display:inline-block;background:rgba(247,147,26,0.15);border:1px solid #f7931a;border-radius:30px;padding:8px 24px;">
      <span style="color:#fbbf24;font-size:13px;font-weight:800;">Action Required — 2 minutes</span>
    </div>
  </div>

  <!-- Missing items -->
  ${missingHtml}

  <!-- What you need -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:22px 24px;margin-bottom:20px;">
    <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:18px;">What You Need &amp; Why</div>

    <!-- BTC -->
    <div style="display:flex;gap:14px;padding-bottom:16px;border-bottom:1px solid #1f2937;margin-bottom:16px;">
      <div style="font-size:28px;flex-shrink:0;line-height:1;">₿</div>
      <div>
        <div style="color:#f7931a;font-size:13px;font-weight:800;margin-bottom:4px;">Bitcoin Address (native BTC network)</div>
        <div style="color:#9ca3af;font-size:13px;line-height:1.6;">
          Required for direct Bitcoin payouts from XP sweep orders. Use a native Bitcoin wallet — Muun, BlueWallet, Coinbase, Kraken, etc. <span style="color:#6b7280;">Do not use a Solana or ETH address here.</span>
        </div>
        ${hasBtc ? `<div style="color:#4ade80;font-size:11px;font-weight:700;margin-top:6px;">✓ On file: ${btcAddress.slice(0,8)}…${btcAddress.slice(-6)}</div>` : `<div style="color:#dc2626;font-size:11px;font-weight:700;margin-top:6px;">✗ Not set — add this now</div>`}
      </div>
    </div>

    <!-- SOL -->
    <div style="display:flex;gap:14px;padding-bottom:16px;border-bottom:1px solid #1f2937;margin-bottom:16px;">
      <div style="font-size:28px;flex-shrink:0;line-height:1;">◎</div>
      <div>
        <div style="color:#9945ff;font-size:13px;font-weight:800;margin-bottom:4px;">Solana Address</div>
        <div style="color:#9ca3af;font-size:13px;line-height:1.6;">
          Needed for wrapped BTC (wBTC), SOL, and future on-chain P2P features. Phantom, Backpack, Solflare, or any Solana-compatible wallet.
        </div>
        ${hasSol ? `<div style="color:#4ade80;font-size:11px;font-weight:700;margin-top:6px;">✓ On file: ${solAddress.slice(0,8)}…${solAddress.slice(-6)}</div>` : `<div style="color:#dc2626;font-size:11px;font-weight:700;margin-top:6px;">✗ Not set — add this now</div>`}
      </div>
    </div>

    <!-- Handle -->
    <div style="display:flex;gap:14px;">
      <div style="font-size:28px;flex-shrink:0;line-height:1;">🏷️</div>
      <div>
        <div style="color:#60a5fa;font-size:13px;font-weight:800;margin-bottom:4px;">Your &ldquo;Miner&rdquo; Handle</div>
        <div style="color:#9ca3af;font-size:13px;line-height:1.6;">
          Your identity on the ScrollPay network. This is how you appear on leaderboards, how people find you to tip or follow, and your personal referral link — <span style="color:#f7931a;">scrollpay.app/r/yourhandle</span>. Set it once, keep it forever.
        </div>
        ${hasHandle ? `<div style="color:#4ade80;font-size:11px;font-weight:700;margin-top:6px;">✓ Your handle: @${handle}</div>` : `<div style="color:#dc2626;font-size:11px;font-weight:700;margin-top:6px;">✗ Not set — claim your handle now</div>`}
      </div>
    </div>
  </div>

  <!-- Why it matters for P2P -->
  <div style="background:linear-gradient(145deg,#080818 0%,#0a0820 100%);border:1px solid #3730a3;border-radius:14px;padding:22px 24px;margin-bottom:24px;">
    <div style="font-size:10px;color:#818cf8;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">Coming Next: P2P &amp; Social Features</div>
    <p style="color:#9ca3af;font-size:13px;line-height:1.7;margin:0 0 12px;">
      Your wallet addresses and handle aren't just for sweep payouts. They're the foundation for what's coming:
    </p>
    <div style="color:#c7d2fe;font-size:13px;line-height:1.9;">
      ⚡ &nbsp;<strong>Direct P2P tips</strong> — other &ldquo;miners&rdquo; can send you sats directly<br>
      🏆 &nbsp;<strong>Public leaderboard</strong> — ranked by your "mining" output<br>
      🔗 &nbsp;<strong>Referral payouts</strong> — automatically tracked to your handle<br>
      📣 &nbsp;<strong>Social profiles</strong> — your public page at scrollpay.app/profile/yourhandle<br>
      🎯 &nbsp;<strong>Advertiser bonuses</strong> — brands can tip top "miners" directly
    </div>
  </div>

  <!-- How to update -->
  <div style="background:#111;border:1px solid #1f2937;border-radius:14px;padding:22px 24px;margin-bottom:24px;">
    <div style="font-size:10px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">How to Update Your Info</div>
    <div style="color:#9ca3af;font-size:13px;line-height:2;">
      <span style="color:#f7931a;font-weight:700;">1.</span> &nbsp;Open the <strong style="color:#f3f4f6;">ScrollPay browser extension</strong><br>
      <span style="color:#f7931a;font-weight:700;">2.</span> &nbsp;Tap the <strong style="color:#f3f4f6;">Settings / Profile</strong> tab<br>
      <span style="color:#f7931a;font-weight:700;">3.</span> &nbsp;Add your BTC address, Solana address, and pick a handle<br>
      <span style="color:#f7931a;font-weight:700;">4.</span> &nbsp;Save — your profile is live instantly
    </div>
    <div style="margin-top:14px;font-size:12px;color:#6b7280;">Don't have the extension? Get it at <a href="https://scrollpay.app" style="color:#f7931a;text-decoration:none;font-weight:700;">scrollpay.app</a></div>
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:28px;">
    <a href="https://scrollpay.app" target="_blank"
      style="display:inline-block;background:linear-gradient(135deg,#f7931a,#f5a623);color:#000;text-decoration:none;padding:16px 52px;border-radius:50px;font-size:15px;font-weight:900;letter-spacing:.3px;">
      Update My Profile →
    </a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:16px 0;">
    <div style="color:#374151;font-size:12px;margin-bottom:6px;">
      <a href="https://scrollpay.app" style="color:#f7931a;text-decoration:none;font-weight:700;">scrollpay.app</a>
      &nbsp;·&nbsp;
      <a href="https://scrollpay.app/privacy" style="color:#6b7280;text-decoration:none;">Privacy</a>
    </div>
    <div style="color:#374151;font-size:11px;line-height:1.6;">
      Keep &ldquo;mining.&rdquo; ⚡<br>
      You're receiving this because you have a ScrollPay account.
    </div>
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

    // Fetch all users who have an email address
    const snap = await db.collection('sp_users').limit(2000).get();
    const targets = [];
    snap.forEach(d => {
      const u = d.data();
      if (u.email && u.email.includes('@')) {
        targets.push({
          userId:     d.id,
          email:      u.email,
          nickname:   u.nickname   || '',
          handle:     u.nickname   || '',
          btcAddress: u.btcAddress || '',
          solAddress: u.solAddress || '',
        });
      }
    });

    if (targets.length === 0) return res.status(200).json({ sent: 0, skipped: 0, total: 0 });

    let sent = 0;
    let errors = 0;
    const subject = '⚡ Sweep Payouts Have Begun — Update Your Payment Profile';
    const logAt   = admin.firestore.FieldValue.serverTimestamp();

    // Send in waves to stay within Resend rate limits
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const wave = targets.slice(i, i + BATCH_SIZE);
      await Promise.all(wave.map(async u => {
        const html = buildBroadcastEmail(u);
        try {
          await sendEmail({ to: u.email, subject, html });
          sent++;
        } catch (_) {
          errors++;
        }
      }));
      if (i + BATCH_SIZE < targets.length) await sleep(WAVE_DELAY);
    }

    // Log the broadcast
    await db.collection('sp_email_logs').add({
      type:      'broadcast_payment_profile',
      subject,
      total:     targets.length,
      sent,
      errors,
      sentBy:    ADMIN_EMAIL,
      sentAt:    logAt,
    });

    return res.status(200).json({ ok: true, total: targets.length, sent, errors });
  } catch (err) {
    const status = err.code?.startsWith('auth/') ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
};
