// The service worker of the remote content story `ServiceWorkerMocked` and the network story `MockedFetch`, registered
// with the scope `/sw-scope/`, so it controls only the frames in this folder, `frame.html` and `fetch.html`, and never
// another story's page. It answers a request whose URL has the marker `visual-check-e2e-mocked`, an image's or a
// `fetch`'s, with `mocked.png`, which it fetches itself and wraps in a response of its own, so the response isn't
// opaque, as a mocking library's isn't. It leaves every other request alone, so the browser fetches it.

/**
 * The marker in the URL of a request the worker mocks.
 */
const mockedMarker = 'visual-check-e2e-mocked'

/**
 * Gives the mocked image: `mocked.png`, fetched from the worker's own origin, in a response the worker makes itself.
 */
async function mockedImage() {
  const response = await fetch(new URL('mocked.png', self.location.href))

  return new Response(await response.blob(), { headers: { 'content-type': 'image/png' } })
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes(mockedMarker)) {
    event.respondWith(mockedImage())
  }
})
