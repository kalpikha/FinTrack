const STORAGE_KEY_PREFIX = 'fintrack-finance:user:v2:';
const LEGACY_STORAGE_KEY = 'lumen-finance:v2';

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseDb } from './firebase.js';

function userKey(userId) {
  return STORAGE_KEY_PREFIX + userId;
}

function userDocRef(userId) {
  return doc(getFirebaseDb(), 'users', userId, 'data', 'state');
}

export function getUserState(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(userKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setUserState(userId, value) {
  if (!userId) return;
  localStorage.setItem(userKey(userId), JSON.stringify(value));
}

export function clearUserState(userId) {
  if (!userId) return;
  localStorage.removeItem(userKey(userId));
}

export function getLegacyState() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getCloudState(userId) {
  if (!userId) return null;
  try {
    const snap = await getDoc(userDocRef(userId));
    if (!snap.exists()) return null;
    return snap.data()?.state || null;
  } catch (err) {
    console.warn('Cloud read failed:', err?.message || err);
    return null;
  }
}

export async function setCloudState(userId, value) {
  if (!userId) return;
  try {
    await setDoc(userDocRef(userId), {
      state: value,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Cloud write failed:', err?.message || err);
  }
}
