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

// Wraps verifyIdToken with a single retry for the transient "String didn't match!"
// cold-start race condition that occurs when concurrent Vercel Lambdas all try to
// fetch Google's public keys at the same time.
async function verifyToken(token) {
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (e) {
    if (e.message === "String didn't match!") {
      return await admin.auth().verifyIdToken(token);
    }
    throw e;
  }
}

module.exports = { admin, db, initError, verifyToken };

