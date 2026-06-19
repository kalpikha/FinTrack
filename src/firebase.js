import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

function readEnv(key) {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID'),
};

export const adminConfig = {
  name: readEnv('VITE_ADMIN_NAME') || 'Admin',
  email: readEnv('VITE_ADMIN_EMAIL'),
  password: readEnv('VITE_ADMIN_PASSWORD'),
};

const appCheckSiteKey = readEnv('VITE_RECAPTCHA_SITE_KEY');
const appCheckDebugToken = readEnv('VITE_APPCHECK_DEBUG_TOKEN');

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
  );
}

let appInstance = null;
let authInstance = null;
let dbInstance = null;
let appCheckInstance = null;
let appCheckAttempted = false;

function ensureAppCheck(app) {
  if (appCheckAttempted) return;
  appCheckAttempted = true;
  if (!appCheckSiteKey) return;
  try {
    // Debug token lets localhost / CI bypass attestation. Never ship a real key as debug.
    if (appCheckDebugToken && typeof self !== 'undefined') {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
    } else if (import.meta.env.DEV && typeof self !== 'undefined' && !self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check init skipped:', err?.message || err);
  }
}

export function getFirebaseApp() {
  if (!appInstance) {
    appInstance = initializeApp(firebaseConfig);
    ensureAppCheck(appInstance);
  }
  return appInstance;
}

export function getFirebaseAuth() {
  if (!authInstance) authInstance = getAuth(getFirebaseApp());
  return authInstance;
}

export function getFirebaseDb() {
  if (!dbInstance) {
    dbInstance = initializeFirestore(getFirebaseApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return dbInstance;
}
