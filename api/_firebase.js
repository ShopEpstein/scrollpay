const admin = require('firebase-admin');

let initError = null;

try {
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa) throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. ' +
      'In Vercel: Settings → Environment Variables → add FIREBASE_SERVICE_ACCOUNT ' +
      '(paste the full JSON from Firebase Console → Project Settings → Service Accounts → Generate new private key).'
    );
    const parsed = JSON.parse(sa);
    // Vercel sometimes stores `\n` as literal two-character sequences — fix them.
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({ credential: admin.credential.cert(parsed) });
  }
} catch (e) {
  initError = e;
}

const db = initError ? null : admin.firestore();

// Wraps verifyIdToken with retries for the transient cold-start race condition
// where concurrent Vercel Lambdas all try to fetch Google's public keys at once.
// The error message varies across Firebase Admin SDK versions.
async function verifyToken(token) {
  const isKeyRace = msg =>
    msg && (msg.includes("did not match") || msg.includes("didn't match"));

  try {
    return await admin.auth().verifyIdToken(token);
  } catch (e) {
    if (!isKeyRace(e.message)) throw e;
    // First retry
    try {
      return await admin.auth().verifyIdToken(token);
    } catch (e2) {
      if (!isKeyRace(e2.message)) throw e2;
      // Second retry
      return await admin.auth().verifyIdToken(token);
    }
  }
}

module.exports = { admin, db, initError, verifyToken };

