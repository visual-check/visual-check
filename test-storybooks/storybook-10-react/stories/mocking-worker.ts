/**
 * Promises that a service worker has activated.
 */
function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (worker.state === 'activated') {
        resolve()
      }
    }

    worker.addEventListener('statechange', check)
    check()
  })
}

/**
 * Registers the mocking service worker, `/sw-scope/sw.js`, with the scope `/sw-scope/`, and waits until it's active, so
 * it controls the frame a story then renders from that folder. The story page itself is outside the scope, so the
 * worker never controls it, or any other story's page.
 */
export async function registerMockingWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw-scope/sw.js', { scope: '/sw-scope/' })
  const worker = registration.installing ?? registration.waiting ?? registration.active

  if (worker === null) {
    throw new Error('visual-check: the mocking service worker has no worker')
  }

  await activated(worker)
}
