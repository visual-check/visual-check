import type { Meta, StoryObj } from '@storybook/react-vite'

/**
 * The name of visual-check's own marker in every store: a `localStorage` key, a `sessionStorage` key, a cookie and an
 * IndexedDB database. The stories check only for it, not for empty stores, because Storybook may keep its own keys.
 */
const marker = 'visual-check-storage'

/**
 * A store the stories mark.
 */
interface MarkedStore {
  /**
   * The store's name, as the stories' error names it.
   */
  name: string
  /**
   * Resolves with whether the store holds the marker.
   */
  holdsMarker: () => Promise<boolean>
}

/**
 * Every store the stories mark.
 */
const markedStores: MarkedStore[] = [
  { name: 'localStorage', holdsMarker: async () => localStorage.getItem(marker) !== null },
  { name: 'sessionStorage', holdsMarker: async () => sessionStorage.getItem(marker) !== null },
  { name: 'cookies', holdsMarker: async () => (await cookieStore.get(marker)) !== null },
  {
    name: 'IndexedDB',
    holdsMarker: async () => (await indexedDB.databases()).some((database) => database.name === marker),
  },
]

/**
 * Lists the stores that hold the marker.
 */
async function storesWithMarker(): Promise<string[]> {
  const held = await Promise.all(markedStores.map((store) => store.holdsMarker()))

  return markedStores.filter((_store, index) => held[index]).map((store) => store.name)
}

/**
 * Writes the marker to IndexedDB: opens the database at version 1, creates its object store, puts one record, and
 * closes the database once the write is done.
 */
function writeMarkerDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(marker, 1)

    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(marker)
    }

    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const transaction = database.transaction(marker, 'readwrite')

      transaction.objectStore(marker).put('written', marker)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }

      transaction.onerror = () => reject(transaction.error)
    }
  })
}

/**
 * Writes the marker to every store.
 */
async function writeMarkers(): Promise<void> {
  localStorage.setItem(marker, 'written')
  sessionStorage.setItem(marker, 'written')
  await cookieStore.set({ name: marker, value: 'written', path: '/' })
  await writeMarkerDatabase()
}

/**
 * Checks that no store holds the marker, writes it to every store, and checks that every store now holds it, so a
 * write that didn't stick can't let the next story pass. Throws, naming the stores, when a story before this one on
 * the same page left the marker behind, or when a store doesn't hold it after the write, which makes the story broken.
 */
async function checkThenFillStorage(): Promise<void> {
  const leftBehind = await storesWithMarker()

  if (leftBehind.length > 0) {
    throw new Error(`A story before this one left storage behind in: ${leftBehind.join(', ')}.`)
  }

  await writeMarkers()

  const kept = await storesWithMarker()
  const lost = markedStores.map((store) => store.name).filter((name) => !kept.includes(name))

  if (lost.length > 0) {
    throw new Error(`The marker didn't stick in: ${lost.join(', ')}.`)
  }
}

/**
 * A plain note saying the story found storage empty and filled it.
 */
function StorageNote() {
  return (
    <p
      style={{
        width: 320,
        margin: 0,
        padding: 16,
        border: '1px solid #65a30d',
        borderRadius: 6,
        background: '#ecfccb',
        fontFamily: 'sans-serif',
        fontSize: 16,
      }}
    >
      Storage was empty, then filled
    </p>
  )
}

const meta = {
  title: 'Storage',
  component: StorageNote,
  loaders: [checkThenFillStorage],
} satisfies Meta<typeof StorageNote>

export default meta

type Story = StoryObj<typeof meta>

export const First: Story = {}

export const Second: Story = {}
