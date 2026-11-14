import { afterEach, describe, expect, it } from 'vitest'
import { ContainerError } from './container-error.js'
import { type FakeDocker, installFakeDocker, removeDockerFromPath } from './fake-docker.fixture.js'
import { pullMissingImage } from './image-pull.js'

const image = 'ghcr.io/visual-check/chromium@sha256:abc'

const plainInspect = ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', image]

/**
 * The inspect that asks for one platform's content.
 */
function inspectFor(platform: string): string[] {
  return ['image', 'inspect', '--platform', platform, '--format', '{{.Os}}/{{.Architecture}}', image]
}

describe('pullMissingImage', () => {
  let fake: FakeDocker | undefined
  let restorePath: (() => void) | undefined

  afterEach(() => {
    fake?.remove()
    restorePath?.()
    fake = undefined
    restorePath = undefined
  })

  it('pulls nothing when the image is present', async () => {
    fake = installFakeDocker({ imagePresent: true })

    const chunks: string[] = []

    await pullMissingImage(image, 'linux/amd64', (text) => chunks.push(text))

    expect(fake.calls()).toEqual([inspectFor('linux/amd64')])
    expect(chunks).toEqual([])
  })

  it('pulls a missing image for the platform and passes its progress through in order', async () => {
    fake = installFakeDocker({ imagePresent: false })

    let progress = ''

    await pullMissingImage(image, 'linux/arm64', (text) => {
      progress += text
    })

    expect(fake.calls()).toEqual([
      inspectFor('linux/arm64'),
      plainInspect,
      ['pull', '--platform', 'linux/arm64', image],
    ])
    expect(progress).toContain('pull progress 1\npull progress 2\n')
    expect(progress).toContain('pull progress 3\n')
  })

  it('pulls when the present image is for another platform', async () => {
    fake = installFakeDocker({ imagePresent: true, imagePlatform: 'linux/arm64' })

    await pullMissingImage(image, 'linux/amd64', () => undefined)

    expect(fake.calls().map((call) => call[0])).toEqual(['image', 'pull'])
  })

  it('pulls nothing when the containerd store holds the platform, whatever it prints without the flag', async () => {
    fake = installFakeDocker({ imagePresent: true, engine: 'containerd' })

    await pullMissingImage(image, 'linux/amd64', () => undefined)

    expect(fake.calls()).toEqual([inspectFor('linux/amd64')])
  })

  it('pulls when the containerd store holds another platform only', async () => {
    fake = installFakeDocker({ imagePresent: true, engine: 'containerd', imagePlatform: 'linux/arm64' })

    await pullMissingImage(image, 'linux/amd64', () => undefined)

    expect(fake.calls().map((call) => call[0])).toEqual(['image', 'pull'])
  })

  it('falls back to a plain inspect when the engine rejects --platform', async () => {
    fake = installFakeDocker({ imagePresent: true, engine: 'old' })

    await pullMissingImage(image, 'linux/amd64', () => undefined)

    expect(fake.calls()).toEqual([inspectFor('linux/amd64'), plainInspect])
  })

  it('pulls when an engine that rejects --platform holds another platform', async () => {
    fake = installFakeDocker({ imagePresent: true, engine: 'old', imagePlatform: 'linux/arm64' })

    await pullMissingImage(image, 'linux/amd64', () => undefined)

    expect(fake.calls().map((call) => call[0])).toEqual(['image', 'image', 'pull'])
  })

  it('fails with the image, the platform, the exit code and the fix when the pull fails', async () => {
    fake = installFakeDocker({ imagePresent: false, pullExitCode: 3 })

    const failure = pullMissingImage(image, 'linux/arm64', () => undefined)

    await expect(failure).rejects.toBeInstanceOf(ContainerError)
    await expect(failure).rejects.toThrow(`docker pull of ${image} for linux/arm64 failed with exit code 3.`)
    await expect(failure).rejects.toThrow('Docker is running')
  })

  it('says to install or start Docker when there is no docker command', async () => {
    restorePath = removeDockerFromPath()

    const failure = pullMissingImage(image, 'linux/amd64', () => undefined)

    await expect(failure).rejects.toBeInstanceOf(ContainerError)
    await expect(failure).rejects.toThrow('no `docker` command on PATH')
    await expect(failure).rejects.toThrow('Install or start Docker')
  })
})
