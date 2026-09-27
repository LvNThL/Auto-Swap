import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase.js'

const MAX_PRESETS_TO_LOAD = 26

function presetsCollection(uid) {
  if (!uid) throw new Error('Sign in before accessing saved routes.')
  return collection(db, 'users', uid, 'presets')
}

export async function listPresets(uid) {
  const snapshot = await getDocs(query(presetsCollection(uid), orderBy('updatedAt', 'desc'), limit(MAX_PRESETS_TO_LOAD)))
  return snapshot.docs.map((presetDoc) => ({ id: presetDoc.id, ...presetDoc.data() }))
}

export async function createPreset(uid, preset) {
  if (!uid) throw new Error('Sign in before accessing saved routes.')
  const save = httpsCallable(functions, 'saveUserPreset')
  const { data } = await save({ preset })
  return data.id
}

export async function updatePreset(uid, presetId, changes) {
  if (!uid) throw new Error('Sign in before accessing saved routes.')
  const save = httpsCallable(functions, 'saveUserPreset')
  await save({ presetId, preset: changes })
}

export async function deletePreset(uid, presetId) {
  if (!uid) throw new Error('Sign in before accessing saved routes.')
  const remove = httpsCallable(functions, 'deleteUserPreset')
  await remove({ presetId })
}