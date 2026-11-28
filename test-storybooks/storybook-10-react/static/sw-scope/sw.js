// The service worker of the remote content story `ServiceWorkerMocked`, the network story `MockedFetch` and the page
// errors stories `WorkerError` and `ExpectedWorkerError`, registered with the scope `/sw-scope/`, so it controls only
// the frames in this folder, `frame.html`, `fetch.html` and `orders.html`, and never another story's page. It answers a
// request whose URL has the marker `visual-check-e2e-mocked`, an image's or a `fetch`'s, with `mocked.png`, which it
// fetches itself and wraps in a response of its own, so the response isn't opaque, as a mocking library's isn't. It
// answers a request whose URL has the query parameter `visual-check-e2e-status` with a JSON response of that status,
// built as a mocking library builds an error response, such as MSW's `HttpResponse.json(body, { status: 500 })`. It
// leaves every other request alone, so the browser fetches it.

/**
 * The marker in the URL of a request the worker mocks.
 */
const mockedMarker = 'visual-check-e2e-mocked'

/**
 * The query parameter that gives the status of the JSON response the worker answers a request with.
 */
const statusParameter = 'visual-check-e2e-status'

/**
 * Gives the mocked image: `mocked.png`, fetched from the worker's own origin, in a response the worker makes itself.
 */
async function mockedImage() {
  const response = await fetch(new URL('mocked.png', self.location.href))

  return new Response(await response.blob(), { headers: { 'content-type': 'image/png' } })
}

/**
 * Gives a JSON response of the status, which the worker makes itself: an error's body for a status of 400 or more,
 * else an empty list of orders.
 */
function jsonResponse(status) {
  const body = status >= 400 ? { error: `Mocked ${status}` } : { orders: [] }

  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const status = new URL(event.request.url).searchParams.get(statusParameter)

  if (event.request.url.includes(mockedMarker)) {
    event.respondWith(mockedImage())
  } else if (status !== null) {
    event.respondWith(jsonResponse(Number(status)))
  }
})
