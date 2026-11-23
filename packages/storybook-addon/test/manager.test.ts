import { addons, mockChannel } from 'storybook/manager-api'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

/**
 * The listeners the manager leaves with Storybook's stores.
 */
const storeListeners = vi.hoisted(() => new Map<string, () => void>())

// It needs `document` at import.
vi.mock('storybook/internal/components', () => ({ AddonPanel: () => null }))

vi.mock('storybook/manager-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('storybook/manager-api')>()),
  experimental_getStatusStore: (typeId: string) => ({
    onSelect: (listener: () => void) => storeListeners.set(`select ${typeId}`, listener),
    onAllStatusChange: () => undefined,
  }),
  experimental_getTestProviderStore: (id: string) => ({
    onClearAll: (listener: () => void) => storeListeners.set(`clear ${id}`, listener),
  }),
}))

/**
 * What the manager did with Storybook.
 */
interface LoadedManager {
  /**
   * What it added, by ID.
   */
  added: Map<string, object>
  /**
   * The API that it got.
   */
  api: { setSelectedPanel: Mock; togglePanel: Mock }
  /**
   * The names of the events it emitted.
   */
  emitted: () => string[]
}

/**
 * Loads the manager entry afresh in a Storybook of the config type, and runs what it registers.
 */
async function load(configType: string): Promise<LoadedManager> {
  const added = new Map<string, object>()
  const api = { setSelectedPanel: vi.fn(), togglePanel: vi.fn() }
  const channel = mockChannel()
  const emit = vi.spyOn(channel, 'emit')

  vi.stubGlobal('CONFIG_TYPE', configType)
  addons.setChannel(channel)
  vi.spyOn(addons, 'add').mockImplementation((id, addon) => {
    added.set(id, addon)
  })
  vi.spyOn(addons, 'register').mockImplementation((_id, callback) => {
    callback(api as unknown as Parameters<typeof callback>[0])
  })

  await import('../src/manager.js')

  return { added, api, emitted: () => emit.mock.calls.map(([event]) => event) }
}

/**
 * Gives the props the panel the manager added renders with, when it is active.
 */
function panelPropsOf(added: Map<string, object>): unknown {
  const { render } = added.get('visual-check/panel') as { render: (props: { active: boolean }) => { props: unknown } }

  return render({ active: true }).props
}

beforeEach(() => {
  vi.resetModules()
  storeListeners.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the manager', () => {
  it('adds the panel and the test provider in storybook dev, and asks for the state', async () => {
    const { added, emitted } = await load('DEVELOPMENT')

    expect([...added.keys()]).toEqual(['visual-check/panel', 'visual-check/test-provider'])
    expect(added.get('visual-check/panel')).toMatchObject({ type: 'panel', title: 'Visual check' })
    expect(added.get('visual-check/test-provider')).toMatchObject({ type: 'test-provider' })
    expect(emitted()).toEqual(['visual-check/get-state'])
  })

  it('clears the results when Storybook clears its test providers', async () => {
    const { emitted } = await load('DEVELOPMENT')

    storeListeners.get('clear visual-check/test-provider')?.()

    expect(emitted()).toEqual(['visual-check/get-state', 'visual-check/clear'])
  })

  it('shows the panel when a status of it is selected in this tab alone', async () => {
    const { api } = await load('DEVELOPMENT')
    const hasFocus = vi.fn(() => false)

    vi.stubGlobal('document', { hasFocus })
    storeListeners.get('select visual-check')?.()

    expect(api.setSelectedPanel).not.toHaveBeenCalled()

    hasFocus.mockReturnValue(true)
    storeListeners.get('select visual-check')?.()

    expect(api.setSelectedPanel.mock.calls).toEqual([['visual-check/panel']])
    expect(api.togglePanel.mock.calls).toEqual([[true]])
  })

  it.each(['127.0.0.1', 'localhost', '[::1]'])('adds the panel alone in a static build on %s', async (hostname) => {
    vi.stubGlobal('location', { hostname, href: `http://${hostname}:6006/?path=/story/a--b` })
    vi.stubEnv('VISUAL_CHECK_STORYBOOK', 'web')

    const { added, emitted } = await load('PRODUCTION')

    expect([...added.keys()]).toEqual(['visual-check/panel'])
    expect(added.get('visual-check/panel')).toMatchObject({ type: 'panel', title: 'Visual check' })
    expect(panelPropsOf(added)).toEqual({ active: true, storybook: 'web', address: `http://${hostname}:6006` })
    expect(emitted()).toEqual([])
    expect([...storeListeners.keys()]).toEqual([])
  })

  it('registers nothing in a static build on any other host', async () => {
    vi.stubGlobal('location', { hostname: 'storybook.example.com', href: 'https://storybook.example.com/' })
    vi.stubEnv('VISUAL_CHECK_STORYBOOK', 'web')

    const { added, emitted } = await load('PRODUCTION')

    expect(addons.register).not.toHaveBeenCalled()
    expect([...added.keys()]).toEqual([])
    expect(emitted()).toEqual([])
    expect([...storeListeners.keys()]).toEqual([])
  })
})
