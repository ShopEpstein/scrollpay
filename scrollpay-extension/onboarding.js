// ScrollPay Onboarding Script

const USER_KEY = 'scrollpay_user_id';
const USER_REF_CODE_KEY = 'scrollpay_ref_code';

let currentScreen = 0;
const totalScreens = 4;

// Collected data across screens
const userData = {
  email: '',
  referredBy: '',
  userId: ''
};

function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false });
        } else {
          resolve(response || { success: false });
        }
      });
    } catch (e) {
      resolve({ success: false });
    }
  });
}

function showScreen(index) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.dot').forEach(d => d.classList.remove('active'));

  // Show target
  const screen = document.getElementById(`screen-${index}`);
  const dot = document.querySelector(`.dot[data-screen="${index}"]`);

  if (screen) screen.classList.add('active');
  if (dot) dot.classList.add('active');

  currentScreen = index;
}

function setStatus(msg, type = '') {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ` ${type}` : '');
}

// Screen 0 → 1
document.getElementById('btn-screen-0').addEventListener('click', () => {
  showScreen(1);
});

// Screen 1 → 2
function proceedFromScreen1() {
  userData.email = document.getElementById('email-input').value.trim();
  showScreen(2);
}

document.getElementById('btn-screen-1').addEventListener('click', proceedFromScreen1);
document.getElementById('skip-screen-1').addEventListener('click', proceedFromScreen1);

// Screen 2 → 3
function proceedFromScreen2() {
  const code = document.getElementById('refcode-input').value.trim().toUpperCase();
  userData.referredBy = code;
  showScreen(3);
}

document.getElementById('btn-screen-2').addEventListener('click', proceedFromScreen2);
document.getElementById('skip-screen-2').addEventListener('click', proceedFromScreen2);

// Screen 3 → Create user + open Twitter
document.getElementById('btn-screen-3').addEventListener('click', async () => {
  const btn = document.getElementById('btn-screen-3');
  btn.textContent = 'Setting up...';
  btn.disabled = true;
  setStatus('Creating your account...');

  try {
    // Use extension ID as anonymous user seed if no email
    const anonymousSeed = chrome.runtime.id + '_' + Date.now();
    userData.userId = userData.email
      ? 'user_' + userData.email.replace(/[^a-zA-Z0-9]/g, '_')
      : 'anon_' + anonymousSeed;

    const response = await sendToBackground({
      type: 'CREATE_USER',
      userData: {
        userId: userData.userId,
        email: userData.email,
        referredBy: userData.referredBy
      }
    });

    if (response.success) {
      // Save userId and refCode locally
      await chrome.storage.local.set({
        [USER_KEY]: response.userId || userData.userId,
        [USER_REF_CODE_KEY]: response.refCode || ''
      });

      setStatus('Account created! Opening Twitter...', 'success');

      setTimeout(() => {
        chrome.tabs.create({ url: 'https://twitter.com' });
        window.close();
      }, 1000);
    } else {
      // Fallback: save anonymous user locally even if Firebase failed
      await chrome.storage.local.set({
        [USER_KEY]: userData.userId,
        [USER_REF_CODE_KEY]: ''
      });
      setStatus('Offline mode — account saved locally.', 'success');
      setTimeout(() => {
        chrome.tabs.create({ url: 'https://twitter.com' });
        window.close();
      }, 1200);
    }
  } catch (e) {
    setStatus('Something went wrong. Please retry.', 'error');
    btn.textContent = 'Start Earning XP →';
    btn.disabled = false;
  }
});

// Init: check if already onboarded, and pre-fill any captured referral code
(async function init() {
  const result = await chrome.storage.local.get([USER_KEY, 'scrollpay_pending_ref']);
  if (result[USER_KEY]) {
    chrome.tabs.create({ url: 'https://twitter.com' });
    window.close();
    return;
  }
  if (result.scrollpay_pending_ref) {
    const refInput = document.getElementById('refcode-input');
    if (refInput) refInput.value = result.scrollpay_pending_ref;
    await chrome.storage.local.remove(['scrollpay_pending_ref']);
  }
})();
