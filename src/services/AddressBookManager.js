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

function addressBookCollection(uid) {
  if (!uid) throw new Error('Sign in before accessing saved addresses.')
  return collection(db, 'users', uid, 'addressBook')
}

export async function listAddressBookEntries(uid) {
  const snapshot = await getDocs(query(addressBookCollection(uid), orderBy('label', 'asc')))
  return snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() }))
}

export async function createAddressBookEntry(uid, entry) {
  const now = serverTimestamp()
  const reference = await addDoc(addressBookCollection(uid), {
    ...entry,
    createdAt: now,
    updatedAt: now,
  })
  return reference.id
}

export async function updateAddressBookEntry(uid, entryId, changes) {
  await updateDoc(doc(db, 'users', uid, 'addressBook', entryId), {
    ...changes,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAddressBookEntry(uid, entryId) {
  await deleteDoc(doc(db, 'users', uid, 'addressBook', entryId))
}