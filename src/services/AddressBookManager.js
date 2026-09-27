import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase.js'

const MAX_ADDRESS_BOOK_ENTRIES_TO_LOAD = 51

function addressBookCollection(uid) {
  if (!uid) throw new Error('Sign in before accessing saved addresses.')
  return collection(db, 'users', uid, 'addressBook')
}

export async function listAddressBookEntries(uid) {
  const snapshot = await getDocs(query(addressBookCollection(uid), orderBy('label', 'asc'), limit(MAX_ADDRESS_BOOK_ENTRIES_TO_LOAD)))
  return snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() }))
}

export async function createAddressBookEntry(uid, entry) {
  if (!uid) throw new Error('Sign in before accessing saved addresses.')
  const save = httpsCallable(functions, 'saveUserAddressBookEntry')
  const { data } = await save({ entry })
  return data.id
}

export async function updateAddressBookEntry(uid, entryId, changes) {
  if (!uid) throw new Error('Sign in before accessing saved addresses.')
  const save = httpsCallable(functions, 'saveUserAddressBookEntry')
  await save({ entryId, entry: changes })
}

export async function deleteAddressBookEntry(uid, entryId) {
  if (!uid) throw new Error('Sign in before accessing saved addresses.')
  const remove = httpsCallable(functions, 'deleteUserAddressBookEntry')
  await remove({ entryId })
}