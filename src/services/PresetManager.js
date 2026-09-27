import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase.js'

function presetsCollection(uid) {
  if (!uid) throw new Error('Sign in before accessing saved routes.')
  return collection(db, 'users', uid, 'presets')
}

export async function listPresets(uid) {
  const snapshot = await getDocs(query(presetsCollection(uid), orderBy('updatedAt', 'desc')))
  return snapshot.docs.map((presetDoc) => ({ id: presetDoc.id, ...presetDoc.data() }))
}

export async function createPreset(uid, preset) {
  const now = serverTimestamp()
  const reference = await addDoc(presetsCollection(uid), {
    ...preset,
    createdAt: now,
    updatedAt: now,
  })
  return reference.id
}

export async function updatePreset(uid, presetId, changes) {
  await updateDoc(doc(db, 'users', uid, 'presets', presetId), {
    ...changes,
    updatedAt: serverTimestamp(),
  })
}

export async function deletePreset(uid, presetId) {
  await deleteDoc(doc(db, 'users', uid, 'presets', presetId))
}