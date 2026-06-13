// Seeds ad documents into the sp_ads collection.
//
// Usage:
//   1. In the Firebase Console: Project settings -> Service accounts ->
//      "Generate new private key". Save the downloaded file next to this
//      script as serviceAccountKey.json (or point
//      GOOGLE_APPLICATION_CREDENTIALS at it).
//   2. From this folder: npm install && node seed.js
//
// The Admin SDK bypasses Firestore security rules, so this works even
// though client writes to sp_ads are blocked. Re-running updates an ad's
// content without resetting its impression/click counters.

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function loadCredential() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }
  const keyPath = path.join(__dirname, 'serviceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    console.error(
      'Missing credentials. Save a service account key as ' +
      'serviceAccountKey.json next to this script (see header comment).'
    );
    process.exit(1);
  }
  return admin.credential.cert(require(keyPath));
}

admin.initializeApp({ credential: loadCredential() });
const db = admin.firestore();

// Ad content. `id` is the Firestore document id (used so re-running is
// idempotent). Counters are initialized only when the doc is first created.
const ADS = [
  {
    id: 'staccana',
    brandName: 'Staccana',
    brandLogo: '',
    headline: 'Discover Staccana — shop the drop.',
    ctaText: 'Shop now',
    ctaUrl: 'https://staccana.com',
    pointsPerImpression: 5,
    active: true,
    totalBudget: 10000,
  },
];

async function seed() {
  for (const { id, ...content } of ADS) {
    const ref = db.collection('sp_ads').doc(id);
    const snap = await ref.get();
    const counters = snap.exists
      ? {}
      : { budgetUsed: 0, impressions: 0, clicks: 0 };
    await ref.set({ ...content, ...counters }, { merge: true });
    console.log(`Seeded ad "${id}" (${content.brandName})`);
  }
  console.log('Done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
