// ScrollPay Background Service Worker
// Handles all Firebase operations and messaging from content scripts

import {
  initializeApp,
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc,
  collection, query, where, getDocs, increment, serverTimestamp
} from './vendor/firebase/firebase-bundle.js';

const firebaseConfig = {
  apiKey: "AIzaSyCeJ0Egs5CZjzRDXCMoEL54GbvRR-14Z14",
  authDomain: "scrollpay-1ce29.firebaseapp.com",
  projectId: "scrollpay-1ce29",
  storageBucket: "scrollpay-1ce29.firebasestorage.app",
  messagingSenderId: "710989126022",
  appId: "1:710989126022:web:50324119c803af284f7407"
};

const DEFAULT_ADS = [
  {
    id: 'ad_001',
    brandName: 'ScrollPay',
    brandLogo: '',
    headline: 'Invite friends. Earn 100 XP per install + build your downline.',
    ctaText: 'Share now',
    ctaUrl: 'https://scrollpay.app',
    pointsPerImpression: 5
  }
];

// ── XP Halving ────────────────────────────────────────────────
// Starts at 40 XP/ad, halves every 24h for 7 periods → settles at 1 XP/ad.
const HALVING_START_MS   = new Date('2026-06-14T21:25:00Z').getTime();
const HALVING_INTERVAL_MS = 24 * 60 * 60 * 1000;
const GENESIS_XP_RATE    = 40;
const MAX_HALVINGS        = 7;

function getCurrentXpRate() {
  const elapsed  = Math.max(0, Date.now() - HALVING_START_MS);
  const halvings = Math.min(Math.floor(elapsed / HALVING_INTERVAL_MS), MAX_HALVINGS);
  return Math.max(1, Math.round(GENESIS_XP_RATE / Math.pow(2, halvings)));
}

const POINTS_CONFIG = {
  get perImpression() { return getCurrentXpRate(); },
  perClick: 25,
  referralBonusL1: 100,       // direct recruit (paid in ≤50 XP writes)
  referralBonusL2: 25,        // L2 downline — your recruit recruits someone
  referralBonusL3: 10,        // L3 downline
  earlyAdopterThreshold: 500, // first N users get the early bonus
  earlyAdopterMultiplier: 1.5,// +50% referral XP for early adopters
  dailyCap: 50000,
  payoutThreshold: 1000
};

let app;
let db;

function initFirebase() {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    return true;
  } catch (e) {
    console.error('[ScrollPay] Firebase init failed:', e);
    return false;
  }
}

// Largest XP a single Firestore write may add (must match maxAward() in
// firestore.rules). Batched XP flushes are clamped to this.
const MAX_AWARD = 50;

// Ad cache: { domain: { ads, fetchedAt } }
const adCache = {};
const AD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Returns all active ads (cached per domain) so the content script can rotate
// through them client-side without re-querying every few seconds.
async function getActiveAds(domain) {
  const cached = adCache[domain];
  if (cached && Date.now() - cached.fetchedAt < AD_CACHE_TTL) {
    return cached.ads;
  }

  if (!db) {
    return DEFAULT_ADS;
  }

  try {
    const adsRef = collection(db, 'sp_ads');
    const q = query(adsRef, where('active', '==', true));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return DEFAULT_ADS;
    }

    const ads = [];
    snapshot.forEach(d => {
      const data = d.data();
      // Only serve campaigns that have been explicitly approved
      if (!data.status || data.status === 'approved') {
        ads.push({ id: d.id, ...data });
      }
    });

    adCache[domain] = { ads, fetchedAt: Date.now() };
    return ads;
  } catch (e) {
    console.error('[ScrollPay] getActiveAds error:', e);
    return DEFAULT_ADS;
  }
}

// Awards a batch of XP accrued from continuous viewing. Enforces the daily cap
// server-side and clamps the per-write amount to MAX_AWARD (the rules ceiling).
// Returns { awarded, capped }.
async function awardXp(userId, amount) {
  if (!db || !userId || !(amount > 0)) return { awarded: 0, capped: false };

  try {
    const userRef = doc(db, 'sp_users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return { awarded: 0, capped: false };

    const userData = userSnap.data();
    const today = new Date().toDateString();
    const lastActiveDate = userData.lastActiveAt?.toDate?.()?.toDateString?.() || '';
    const satsToday = lastActiveDate === today ? (userData.satsToday || 0) : 0;

    const remaining = POINTS_CONFIG.dailyCap - satsToday;
    if (remaining <= 0) return { awarded: 0, capped: true };

    const award = Math.min(amount, remaining, MAX_AWARD);

    await updateDoc(userRef, {
      totalSats: increment(award),
      satsToday: lastActiveDate === today ? increment(award) : award,
      totalImpressions: increment(1),
      impressionsToday: lastActiveDate === today ? increment(1) : 1,
      lastActiveAt: serverTimestamp()
    });

    return { awarded: award, capped: (satsToday + award) >= POINTS_CONFIG.dailyCap };
  } catch (e) {
    console.error('[ScrollPay] awardXp error:', e);
    return { awarded: 0, capped: false };
  }
}

async function recordImpression(userId, adId, domain, duration) {
  if (!db || !userId) return null;

  try {
    const impressionRef = await addDoc(collection(db, 'sp_impressions'), {
      userId,
      adId,
      domain,
      duration,
      clicked: false,
      satsAwarded: POINTS_CONFIG.perImpression,
      timestamp: serverTimestamp()
    });

    // Update ad stats
    const adRef = doc(db, 'sp_ads', adId);
    await updateDoc(adRef, {
      impressions: increment(1),
      budgetUsed: increment(POINTS_CONFIG.perImpression)
    });

    return impressionRef.id;
  } catch (e) {
    console.error('[ScrollPay] recordImpression error:', e);
    return null;
  }
}

async function awardPoints(userId, points, type = 'impression') {
  if (!db || !userId) return false;

  try {
    const userRef = doc(db, 'sp_users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return false;

    const userData = userSnap.data();
    const today = new Date().toDateString();
    const lastActiveDate = userData.lastActiveAt?.toDate?.()?.toDateString?.() || '';

    // Reset daily stats if new day
    const satsToday = lastActiveDate === today ? (userData.satsToday || 0) : 0;
    const impressionsToday = lastActiveDate === today ? (userData.impressionsToday || 0) : 0;

    // Enforce daily cap
    if (satsToday >= POINTS_CONFIG.dailyCap) return false;

    const actualPoints = Math.min(points, POINTS_CONFIG.dailyCap - satsToday);

    await updateDoc(userRef, {
      totalSats: increment(actualPoints),
      satsToday: lastActiveDate === today ? increment(actualPoints) : actualPoints,
      totalImpressions: type === 'impression' ? increment(1) : increment(0),
      impressionsToday: type === 'impression'
        ? (lastActiveDate === today ? increment(1) : 1)
        : (lastActiveDate === today ? impressionsToday : 0),
      lastActiveAt: serverTimestamp()
    });

    return true;
  } catch (e) {
    console.error('[ScrollPay] awardPoints error:', e);
    return false;
  }
}

// Awards `total` XP in ≤MAX_AWARD chunks so each write satisfies firestore.rules.
async function awardPointsBatched(userId, total, type = 'referral') {
  let remaining = total;
  while (remaining > 0) {
    const batch = Math.min(remaining, MAX_AWARD);
    await awardPoints(userId, batch, type);
    remaining -= batch;
  }
}

async function recordClick(userId, adId, impressionId) {
  if (!db || !userId) return false;

  try {
    // Update impression record
    if (impressionId) {
      const impRef = doc(db, 'sp_impressions', impressionId);
      await updateDoc(impRef, { clicked: true });
    }

    // Update ad click count
    const adRef = doc(db, 'sp_ads', adId);
    await updateDoc(adRef, { clicks: increment(1) });

    // Award click bonus
    await awardPoints(userId, POINTS_CONFIG.perClick, 'click');

    return true;
  } catch (e) {
    console.error('[ScrollPay] recordClick error:', e);
    return false;
  }
}

async function getUserBalance(userId) {
  if (!db || !userId) return null;

  try {
    const userRef = doc(db, 'sp_users', userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    console.error('[ScrollPay] getUserBalance error:', e);
    return null;
  }
}

async function createUser(userData) {
  if (!db) return null;

  try {
    const userId = userData.userId || ('anon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const refCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // Assign a signup number for early-adopter bonus tracking.
    const statsRef = doc(db, 'sp_meta', 'stats');
    let signupNumber = 1;
    try {
      const statsSnap = await getDoc(statsRef);
      if (statsSnap.exists()) {
        signupNumber = (statsSnap.data().userCount || 0) + 1;
        await updateDoc(statsRef, { userCount: increment(1) });
      } else {
        await setDoc(statsRef, { userCount: 1 });
      }
    } catch (e) {
      console.error('[ScrollPay] signup counter error:', e);
    }

    // Resolve up to 3 levels of the referrer chain.
    let l1Id = null, l2Id = null, l3Id = null;

    if (userData.referredBy) {
      const refQuery = query(collection(db, 'sp_users'), where('refCode', '==', userData.referredBy));
      const refSnap = await getDocs(refQuery);
      if (!refSnap.empty) {
        const l1Doc = refSnap.docs[0];
        l1Id = l1Doc.id;
        const l1Data = l1Doc.data();
        l2Id = l1Data.referrerId || null;
        if (l2Id) {
          const l2Snap = await getDoc(doc(db, 'sp_users', l2Id));
          l3Id = (l2Snap.exists() ? l2Snap.data().referrerId : null) || null;
        }
      }
    }

    await setDoc(doc(db, 'sp_users', userId), {
      id: userId,
      email: userData.email || '',
      lightningAddress: userData.lightningAddress || '',
      totalSats: 0,
      satsToday: 0,
      totalImpressions: 0,
      impressionsToday: 0,
      refCode,
      referredBy: userData.referredBy || '',
      referrerId: l1Id || '',
      signupNumber,
      referralCount: 0,
      downlineSize: 0,
      downlineXp: 0,
      installedAt: serverTimestamp(),
      lastActiveAt: serverTimestamp()
    });

    // Compute bonus XP for a referrer, applying early-adopter multiplier if eligible.
    async function bonusFor(uid, baseAmount) {
      try {
        const snap = await getDoc(doc(db, 'sp_users', uid));
        if (!snap.exists()) return baseAmount;
        const sn = snap.data().signupNumber || 999999;
        const mult = sn <= POINTS_CONFIG.earlyAdopterThreshold
          ? POINTS_CONFIG.earlyAdopterMultiplier
          : 1.0;
        return Math.round(baseAmount * mult);
      } catch (e) {
        return baseAmount;
      }
    }

    // Award multi-level bonuses and update downline stats.
    if (l1Id) {
      const l1Award = await bonusFor(l1Id, POINTS_CONFIG.referralBonusL1);
      await awardPointsBatched(l1Id, l1Award, 'referral');
      await updateDoc(doc(db, 'sp_users', l1Id), {
        referralCount: increment(1),
        downlineSize: increment(1),
        downlineXp: increment(l1Award)
      });
    }

    if (l2Id) {
      const l2Award = await bonusFor(l2Id, POINTS_CONFIG.referralBonusL2);
      await awardPointsBatched(l2Id, l2Award, 'referral');
      await updateDoc(doc(db, 'sp_users', l2Id), {
        downlineSize: increment(1),
        downlineXp: increment(l2Award)
      });
    }

    if (l3Id) {
      const l3Award = await bonusFor(l3Id, POINTS_CONFIG.referralBonusL3);
      await awardPointsBatched(l3Id, l3Award, 'referral');
      await updateDoc(doc(db, 'sp_users', l3Id), {
        downlineSize: increment(1),
        downlineXp: increment(l3Award)
      });
    }

    return { userId, refCode, signupNumber };
  } catch (e) {
    console.error('[ScrollPay] createUser error:', e);
    return null;
  }
}

async function updateLightningAddress(userId, lightningAddress) {
  if (!db || !userId) return false;
  try {
    const userRef = doc(db, 'sp_users', userId);
    await updateDoc(userRef, { lightningAddress });
    return true;
  } catch (e) {
    console.error('[ScrollPay] updateLightningAddress error:', e);
    return false;
  }
}

const NICKNAME_RE = /^[a-z0-9_]{3,20}$/;

async function getReceivedTransfers(userId) {
  if (!db || !userId) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'sp_transfers'),
      where('toUid', '==', userId)
    ));
    const transfers = [];
    snap.forEach(d => transfers.push({ id: d.id, ...d.data() }));
    transfers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    return transfers.slice(0, 10);
  } catch (e) {
    console.error('[ScrollPay] getReceivedTransfers error:', e);
    return [];
  }
}

async function transferXp(fromUserId, to, amount, note = '') {
  if (!db || !fromUserId) return { success: false, error: 'Not ready' };
  const amt = Math.round(amount);
  if (!Number.isInteger(amt) || amt < 10) return { success: false, error: 'Minimum transfer is 10 XP.' };
  try {
    const toStr = String(to).trim();

    // Resolve recipient: nickname (lowercase) then refCode (uppercase)
    let recipientSnap = null;
    const byNickname = await getDocs(query(collection(db, 'sp_users'), where('nickname', '==', toStr.toLowerCase())));
    if (!byNickname.empty) {
      recipientSnap = byNickname.docs[0];
    } else {
      const byRefCode = await getDocs(query(collection(db, 'sp_users'), where('refCode', '==', toStr.toUpperCase())));
      if (!byRefCode.empty) recipientSnap = byRefCode.docs[0];
    }

    if (!recipientSnap) return { success: false, error: 'Recipient not found. Check the handle or referral code.' };
    const toUid = recipientSnap.id;
    if (toUid === fromUserId) return { success: false, error: 'Cannot transfer XP to yourself.' };

    const fromRef = doc(db, 'sp_users', fromUserId);
    const fromSnap = await getDoc(fromRef);
    if (!fromSnap.exists()) return { success: false, error: 'Account not found.' };

    const fromData = fromSnap.data();
    const balance = fromData.totalSats || 0;
    if (balance < amt) return { success: false, error: `Insufficient XP. You have ${balance} XP.` };

    const toData = recipientSnap.data();
    const toHandle = toData.nickname || `Miner #${toData.signupNumber || '?'}`;
    const fromHandle = fromData.nickname || `Miner #${fromData.signupNumber || '?'}`;

    await updateDoc(fromRef, { totalSats: increment(-amt) });
    await updateDoc(doc(db, 'sp_users', toUid), { totalSats: increment(amt) });

    // Audit log (best-effort)
    addDoc(collection(db, 'sp_transfers'), {
      fromUid: fromUserId, toUid, amount: amt,
      fromHandle, toHandle,
      note: note ? String(note).slice(0, 200) : '',
      createdAt: serverTimestamp()
    }).catch(() => {});

    return { success: true, toHandle, amount: amt };
  } catch (e) {
    console.error('[ScrollPay] transferXp error:', e);
    return { success: false, error: e.message };
  }
}

async function setNickname(userId, nickname) {
  if (!db || !userId) return { success: false, error: 'Not ready' };
  if (!NICKNAME_RE.test(nickname)) return { success: false, error: 'Handle must be 3–20 lowercase letters, numbers, or underscores.' };
  try {
    const userRef = doc(db, 'sp_users', userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return { success: false, error: 'User not found' };
    if (snap.data().nickname) return { success: false, error: 'Handle already set — it cannot be changed.' };
    const takenSnap = await getDocs(query(collection(db, 'sp_users'), where('nickname', '==', nickname)));
    if (!takenSnap.empty) return { success: false, error: 'Handle already taken — choose another.' };
    await updateDoc(userRef, { nickname });
    return { success: true, nickname };
  } catch (e) {
    console.error('[ScrollPay] setNickname error:', e);
    return { success: false, error: e.message };
  }
}

// Message handler from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_AD': {
          const ads = await getActiveAds(message.domain || 'unknown');
          const ad = ads[Math.floor(Math.random() * ads.length)];
          sendResponse({ success: true, ad, ads });
          break;
        }
        case 'AWARD_XP': {
          const { userId, amount } = message;
          const result = await awardXp(userId, amount);
          sendResponse({ success: true, ...result });
          break;
        }
        case 'RECORD_IMPRESSION': {
          const { userId, adId, domain, duration } = message;
          const impressionId = await recordImpression(userId, adId, domain, duration);
          await awardPoints(userId, POINTS_CONFIG.perImpression, 'impression');
          sendResponse({ success: true, impressionId, satsAwarded: POINTS_CONFIG.perImpression });
          break;
        }
        case 'RECORD_CLICK': {
          const { userId, adId, impressionId } = message;
          await recordClick(userId, adId, impressionId);
          sendResponse({ success: true, satsAwarded: POINTS_CONFIG.perClick });
          break;
        }
        case 'GET_BALANCE': {
          const data = await getUserBalance(message.userId);
          sendResponse({ success: true, data });
          break;
        }
        case 'GET_XP_RATE': {
          const rate = getCurrentXpRate();
          const elapsed = Math.max(0, Date.now() - HALVING_START_MS);
          const halvings = Math.min(Math.floor(elapsed / HALVING_INTERVAL_MS), MAX_HALVINGS);
          const done = halvings >= MAX_HALVINGS;
          const msUntilNext = done ? null : HALVING_INTERVAL_MS - (elapsed % HALVING_INTERVAL_MS);
          const nextRate = done ? 1 : Math.max(1, Math.round(GENESIS_XP_RATE / Math.pow(2, halvings + 1)));
          sendResponse({ success: true, rate, nextRate, halvings, done, msUntilNext, genesisRate: GENESIS_XP_RATE, maxHalvings: MAX_HALVINGS });
          break;
        }
        case 'CREATE_USER': {
          const result = await createUser(message.userData);
          sendResponse({ success: !!result, ...result });
          break;
        }
        case 'UPDATE_LIGHTNING': {
          const ok = await updateLightningAddress(message.userId, message.lightningAddress);
          sendResponse({ success: ok });
          break;
        }
        case 'SET_NICKNAME': {
          const result = await setNickname(message.userId, message.nickname);
          sendResponse(result);
          break;
        }
        case 'TRANSFER_XP': {
          const result = await transferXp(message.userId, message.to, message.amount, message.note || '');
          sendResponse(result);
          break;
        }
        case 'GET_TRANSFERS': {
          const transfers = await getReceivedTransfers(message.userId);
          sendResponse({ success: true, transfers });
          break;
        }
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (e) {
      console.error('[ScrollPay] Message handler error:', e);
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true; // Keep message channel open for async response
});

// On install: open onboarding
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
  initFirebase();
});

// Init Firebase on service worker start
initFirebase();
