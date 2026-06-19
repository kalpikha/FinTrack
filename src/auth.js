import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile as fbUpdateProfile,
  updatePassword as fbUpdatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured, adminConfig } from './firebase.js';

export const isAdminOnly = false;

const SESSION_CACHE_KEY = 'fintrack:auth-user-cache:v1';

let authInstance = null;
let ready = false;
let initError = null;
let currentUser = null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function getAdminEmail() {
  return normalizeEmail(adminConfig.email || '');
}

function assertReady() {
  if (!ready || !authInstance) {
    throw new Error('Firebase is not configured. Update your .env file first.');
  }
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.uid,
    name: user.displayName || 'Admin',
    email: user.email || '',
  };
}

function setUserCache(user) {
  if (!user) {
    localStorage.removeItem(SESSION_CACHE_KEY);
    return;
  }
  localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(user));
}

function getUserCache() {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function ensureAdminAccount() {
  const email = normalizeEmail(adminConfig.email);
  const password = String(adminConfig.password || '');
  const displayName = String(adminConfig.name || 'Admin').trim() || 'Admin';

  if (!email || password.length < 6) return;
  try {
    const cred = await createUserWithEmailAndPassword(authInstance, email, password);
    await fbUpdateProfile(cred.user, { displayName });
    await fbSignOut(authInstance);
  } catch (err) {
    const code = err?.code || '';
    if (code === 'auth/email-already-in-use') return;
    console.warn('Admin bootstrap skipped:', code || err?.message || err);
  }
}

export async function login({ email, password }) {
  assertReady();
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new Error('Email is required');

  const cred = await signInWithEmailAndPassword(authInstance, cleanEmail, String(password || ''));
  currentUser = cred.user;
  const user = toPublicUser(currentUser);
  setUserCache(user);
  return user;
}

export async function register({ name, email, password }) {
  assertReady();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');
  const cleanName = String(name || '').trim();

  if (!cleanName) throw new Error('Name is required');
  if (!cleanEmail) throw new Error('Email is required');
  if (cleanPassword.length < 6) throw new Error('Password must be at least 6 characters');

  const cred = await createUserWithEmailAndPassword(authInstance, cleanEmail, cleanPassword);
  await fbUpdateProfile(cred.user, { displayName: cleanName });
  currentUser = cred.user;
  const user = toPublicUser(currentUser);
  setUserCache(user);
  return user;
}

export function logout() {
  assertReady();
  setUserCache(null);
  return fbSignOut(authInstance);
}

function requireCurrentUser() {
  const user = getCurrentUser();
  if (!user) throw new Error('No active session');
  return user;
}

export async function updateProfile({ name }) {
  assertReady();
  requireCurrentUser();
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Name is required');
  await fbUpdateProfile(authInstance.currentUser, { displayName: cleanName });
  currentUser = authInstance.currentUser;
  return toPublicUser(currentUser);
}

export async function changePassword({ currentPassword, newPassword }) {
  assertReady();
  requireCurrentUser();
  const cleanNew = String(newPassword || '');
  if (cleanNew.length < 6) throw new Error('New password must be at least 6 characters');

  const credential = EmailAuthProvider.credential(
    authInstance.currentUser.email,
    String(currentPassword || '')
  );
  await reauthenticateWithCredential(authInstance.currentUser, credential);
  await fbUpdatePassword(authInstance.currentUser, cleanNew);
}

export function getCurrentUser() {
  return toPublicUser(currentUser || authInstance?.currentUser) || getUserCache();
}

export async function init() {
  if (ready) return;
  initError = null;

  if (!isFirebaseConfigured()) {
    initError = new Error('Firebase config is missing. Copy .env.example to .env and fill in your project keys.');
    throw initError;
  }

  try {
    authInstance = getFirebaseAuth();
  } catch (err) {
    initError = err;
    throw err;
  }

  try {
    await ensureAdminAccount();
  } catch (err) {
    console.warn('Admin bootstrap failed but continuing:', err?.message || err);
  }

  await new Promise(resolve => {
    const off = onAuthStateChanged(authInstance, user => {
      currentUser = user || null;
      setUserCache(toPublicUser(currentUser));
      off();
      resolve();
    });
  });

  ready = true;
}

export function isReady() { return ready; }
export function getInitError() { return initError; }
