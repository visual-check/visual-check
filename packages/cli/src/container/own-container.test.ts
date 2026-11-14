import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type FakeDocker, installFakeDocker, removeDockerFromPath } from './fake-docker.fixture.js'
import { containerIdOf, knownContainerIdOf } from './own-container.js'

/**
 * The ID of the container in the mountinfo lines.
 */
const id = '3f1c9a7d2b8e4f6a0c5d1e9b7a3f2c4d6e8b0a1c3d5f7e9a2b4c6d8e0f1a3b5c'

/**
 * Builds the `/etc/hostname` bind-mount line of a container whose files live under this root.
 */
function hostnameLine(root: string): string {
  return `1041 1032 8:1 ${root} /etc/hostname rw,relatime - ext4 /dev/sda1 rw,errors=remount-ro`
}

/**
 * The mountinfo lines of a host, which name no container.
 */
const hostLines = [
  '24 29 0:22 / /sys rw,nosuid,nodev,noexec,relatime shared:7 - sysfs sysfs rw',
  '29 1 8:1 / / rw,relatime shared:1 - ext4 /dev/sda1 rw,errors=remount-ro',
  '31 29 0:26 / /run rw,nosuid,nodev shared:5 - tmpfs tmpfs rw,size=1638492k,mode=755',
].join('\n')

describe('containerIdOf', () => {
  it.each([
    ['Docker Engine', `/var/lib/docker/containers/${id}/hostname`, '/etc/hostname'],
    ['/var/lib/docker on its own partition', `/containers/${id}/resolv.conf`, '/etc/resolv.conf'],
    ['Docker Desktop', `/docker/containers/${id}/hostname`, '/etc/hostname'],
    [
      'Podman',
      `/home/runner/.local/share/containers/storage/overlay-containers/${id}/userdata/hostname`,
      '/etc/hostname',
    ],
    ['the hosts file', `/var/lib/docker/containers/${id}/hosts`, '/etc/hosts'],
  ])('reads the ID from %s', (_name, root, mountPoint) => {
    const line = `1041 1032 8:1 ${root} ${mountPoint} rw,relatime - ext4 /dev/sda1 rw`

    expect(containerIdOf(`${hostLines}\n${line}\n`)).toBe(id)
  })

  it('reads the ID from an OrbStack line', () => {
    const line = `1094 1078 0:43 /docker/containers/${id}/hostname /etc/hostname rw,relatime - btrfs /dev/vdb1 rw,discard=async,space_cache=v2,subvolid=256,subvol=/docker`

    expect(containerIdOf(line)).toBe(id)
  })

  it('returns undefined on a host, which has no container mounts', () => {
    expect(containerIdOf(`${hostLines}\n`)).toBeUndefined()
  })

  it('ignores a container ID under another mount point', () => {
    const line = `1050 1032 8:1 /var/lib/docker/containers/${id}/mounts/shm /data rw,relatime - ext4 /dev/sda1 rw`

    expect(containerIdOf(line)).toBeUndefined()
  })

  it('ignores a short ID', () => {
    expect(containerIdOf(hostnameLine(`/var/lib/docker/containers/${id.slice(0, 12)}/hostname`))).toBeUndefined()
  })

  it('ignores an uppercase ID', () => {
    expect(containerIdOf(hostnameLine(`/var/lib/docker/containers/${id.toUpperCase()}/hostname`))).toBeUndefined()
  })

  it('takes the first match', () => {
    const other = 'b'.repeat(64)
    const lines = [
      hostnameLine(`/var/lib/docker/containers/${id}/hostname`),
      hostnameLine(`/var/lib/docker/containers/${other}/hostname`),
    ]

    expect(containerIdOf(lines.join('\n'))).toBe(id)
  })
})

describe('knownContainerIdOf', () => {
  let fake: FakeDocker | undefined
  let restorePath: (() => void) | undefined
  let dir: string | undefined

  afterEach(() => {
    fake?.remove()
    restorePath?.()

    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true })
    }

    fake = undefined
    restorePath = undefined
    dir = undefined
  })

  /**
   * Writes a mountinfo file with these lines and returns its path.
   */
  function mountinfoWith(lines: string): string {
    dir = mkdtempSync(join(tmpdir(), 'mountinfo-'))

    const path = join(dir, 'mountinfo')

    writeFileSync(path, `${lines}\n`)

    return path
  }

  /**
   * The mountinfo lines of a Docker Engine container.
   */
  const containerLines = `${hostLines}\n${hostnameLine(`/var/lib/docker/containers/${id}/hostname`)}`

  it('gives no ID without running docker when the mountinfo file is missing', async () => {
    fake = installFakeDocker({ containers: [id] })

    expect(await knownContainerIdOf('/nonexistent/mountinfo')).toBeUndefined()
    expect(fake.calls()).toEqual([])
  })

  it('gives no ID without running docker when the mountinfo names no container', async () => {
    fake = installFakeDocker({ containers: [id] })

    expect(await knownContainerIdOf(mountinfoWith(hostLines))).toBeUndefined()
    expect(fake.calls()).toEqual([])
  })

  it('gives the ID when Docker knows the container, after one inspect', async () => {
    fake = installFakeDocker({ containers: [id] })

    expect(await knownContainerIdOf(mountinfoWith(containerLines))).toBe(id)
    expect(fake.calls()).toEqual([['inspect', '--type', 'container', '--format', '{{.Id}}', id]])
  })

  it('gives no ID when Docker does not know the container', async () => {
    fake = installFakeDocker({ containers: [] })

    expect(await knownContainerIdOf(mountinfoWith(containerLines))).toBeUndefined()
    expect(fake.calls()).toHaveLength(1)
  })

  it('gives no ID when there is no docker on PATH', async () => {
    restorePath = removeDockerFromPath()

    expect(await knownContainerIdOf(mountinfoWith(containerLines))).toBeUndefined()
  })
})
