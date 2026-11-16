import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { checkStorybooks } from './check-storybooks.js'
import {
  cleanUpRuns,
  createProject,
  installStorybook,
  listen,
  startStorybook,
  takeUnusedUrl,
} from './run-cli.fixture.js'

afterEach(cleanUpRuns)

describe('checkStorybooks', () => {
  it('names each unreachable Storybook and its URL, in config order', async () => {
    const project = createProject({})
    const [docs, web] = [await takeUnusedUrl(), await takeUnusedUrl()]
    const checks = await checkStorybooks(
      [
        { name: 'docs', dir: project, url: docs },
        { name: 'shop', dir: project, url: await startStorybook(['a']) },
        { name: 'web', dir: project, url: web },
      ],
      project,
    )

    expect(checks).toMatchObject({
      unreachable: [
        { name: 'docs', url: docs },
        { name: 'web', url: web },
      ],
    })
  })

  it('names no unreachable Storybook for one that answers with an error', async () => {
    const project = createProject({})
    const url = await listen(
      createServer((_request, response) => {
        response.statusCode = 500
        response.end()
      }),
    )
    const checks = await checkStorybooks([{ name: 'web', dir: project, url }], project)

    expect(checks).toMatchObject({ problems: [expect.any(String)], unreachable: [] })
  })

  it('names no unreachable Storybook for one whose version is too old', async () => {
    const project = createProject({})

    installStorybook(project, '8.6.0')

    const checks = await checkStorybooks([{ name: 'web', dir: project, url: await takeUnusedUrl() }], project)

    expect(checks).toMatchObject({ problems: [expect.any(String)], unreachable: [] })
  })
})
