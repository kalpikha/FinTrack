import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

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

export function getFirebaseApp() {
  if (!appInstance) appInstance = initializeApp(firebaseConfig);
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
