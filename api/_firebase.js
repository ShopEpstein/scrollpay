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
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
  }
} catch (e) {
  initError = e;
}

const db = initError ? null : admin.firestore();

module.exports = { admin, db, initError };
