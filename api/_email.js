const API_URL = 'https://api.resend.com/emails';
const FROM    = 'ScrollPay <noreply@scrollpay.app>';

/**
 * Send a transactional email via Resend.
 * @param {{ to: string|string[], subject: string, html: string }} opts
 * @returns {Promise<void>}  — resolves silently, never throws (logs on failure)
 */
async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('[email] RESEND_API_KEY not set'); return; }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] Resend error', res.status, body);
    }
  } catch (err) {
    console.error('[email] fetch failed', err.message);
  }
}

module.exports = { sendEmail };
