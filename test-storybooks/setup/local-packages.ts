// The packages a project installs, packed from this repo, and the registry on 127.0.0.1 that serves them, for the
// checks that set up a project the way a user would before those versions are on npm.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename } from 'node:path'

/**
 * The folders under `packages/` of the packages a project installs, which the checks pack.
 */
export const packedPackages = ['cli', 'chromium', 'storybook', 'storybook-addon']

/**
 * The fields of a packed `package.json` the checks read.
 */
export interface PackedManifest {
  /**
   * The package's name, such as `@visual-check/cli`.
   */
  name: string
  /**
   * The package's version.
   */
  version: string
  /**
   * The peer dependencies, with the range of each.
   */
  peerDependencies?: Record<string, string>
  /**
   * The dependencies, with the spec of each.
   */
  dependencies?: Record<string, string>
  /**
   * The dev dependencies, with the spec of each.
   */
  devDependencies?: Record<string, string>
  /**
   * The optional dependencies, with the spec of each.
   */
  optionalDependencies?: Record<string, string>
}

/**
 * A packed package.
 */
export interface Tarball {
  /**
   * The `package.json` inside the tarball, as the package manager wrote it when packing: every field, though only some
   * are typed.
   */
  manifest: PackedManifest
  /**
   * The tarball's path.
   */
  path: string
}

/**
 * The local registry that serves the packed packages.
 */
export interface Registry {
  /**
   * Its address, such as `http://127.0.0.1:50123`, with no trailing slash.
   */
  url: string
  /**
   * Each request it answered with anything but 200, as `<method> <url>: <status>`, in order.
   */
  unexpectedRequests: string[]
  /**
   * Stops it.
   */
  stop: () => Promise<void>
}

/**
 * What the registry answers for one request.
 */
interface RegistryAnswer {
  /**
   * The HTTP status.
   */
  status: number
  /**
   * The answer's `content-type`.
   */
  contentType: string
  /**
   * The answer's body.
   */
  body: string | Buffer
}

/**
 * How the config ends: the end of the `storybooks` block, then of the config. The image goes in between.
 */
const configEnd = '\n  },\n})\n'

/**
 * What the registry answers for a request it has nothing for.
 */
const notFoundAnswer: RegistryAnswer = { status: 404, contentType: 'application/json', body: '{"error":"Not found"}' }

/**
 * What the registry answers for a URL it can't decode.
 */
const malformedAnswer: RegistryAnswer = { status: 400, contentType: 'application/json', body: '{"error":"Bad URL"}' }

/**
 * Gives a tarball's `integrity` and `shasum`, as a registry lists them for each version.
 */
function checksumsOf(bytes: Buffer): { integrity: string; shasum: string } {
  return {
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
  }
}

/**
 * Gives what the registry answers for each request, keyed `<method> <path>`: for `GET /<name>`, the package's
 * document, which lists its one version with its tarball's URL under `url`; for `GET` on that URL's path, the tarball.
 */
function registryAnswersOf(tarballs: readonly Tarball[], url: string): Map<string, RegistryAnswer> {
  const answers = new Map<string, RegistryAnswer>()

  for (const { manifest, path } of tarballs) {
    const { name, version } = manifest
    const bytes = readFileSync(path)
    const tarballPath = `/${name}/-/${basename(path)}`
    const dist = { tarball: `${url}${tarballPath}`, ...checksumsOf(bytes) }
    const document = { name, 'dist-tags': { latest: version }, versions: { [version]: { ...manifest, dist } } }

    answers.set(`GET /${name}`, { status: 200, contentType: 'application/json', body: JSON.stringify(document) })
    answers.set(`GET ${tarballPath}`, { status: 200, contentType: 'application/octet-stream', body: bytes })
  }

  return answers
}

/**
 * Gives a request URL's path with its escapes decoded, or `undefined` when it can't be decoded.
 */
function decodedPathOf(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  } catch {
    return undefined
  }
}

/**
 * Gives the registry's answer for a request: the one for its method and decoded path, 404 when there's none, and 400
 * when its URL can't be decoded.
 */
function registryAnswerOf(
  answers: ReadonlyMap<string, RegistryAnswer>,
  method: string | undefined,
  url: string | undefined,
): RegistryAnswer {
  const pathname = decodedPathOf(url ?? '/')

  if (pathname === undefined) {
    return malformedAnswer
  }

  return answers.get(`${method} ${pathname}`) ?? notFoundAnswer
}

/**
 * Serves the packed packages on a free port of 127.0.0.1, as a registry does: `GET /<name>` gives the package's
 * document, and `GET` on a tarball's URL gives the tarball. A package manager asks for a scoped name with its `/`
 * encoded, as `/@visual-check%2fcli`. Every other request gets 404, or 400 when its URL can't be decoded, and is
 * recorded.
 */
export async function startRegistry(tarballs: readonly Tarball[]): Promise<Registry> {
  const unexpectedRequests: string[] = []
  let answers = new Map<string, RegistryAnswer>()
  const server = createServer((request, response) => {
    const answer = registryAnswerOf(answers, request.method, request.url)

    if (answer.status !== 200) {
      unexpectedRequests.push(`${request.method} ${request.url}: ${answer.status}`)
    }

    response.writeHead(answer.status, { 'content-type': answer.contentType }).end(answer.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  answers = registryAnswersOf(tarballs, url)

  return {
    url,
    unexpectedRequests,
    stop: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/**
 * The fields of a `package.json` that list dependencies, each with its spec.
 */
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/**
 * The dependency lists of a `package.json`, a packed one or a project's.
 */
type DependencyLists = Partial<Record<(typeof dependencyFields)[number], Record<string, string>>>

/**
 * Gives a `package.json` with the spec of each dependency named in `versions`, in every dependency list, set to that
 * exact version. Every other field stays as it was.
 */
function withDependencyVersions<Manifest extends DependencyLists>(
  manifest: Manifest,
  versions: ReadonlyMap<string, string>,
): Manifest {
  const rewritten: DependencyLists = { ...manifest }

  for (const field of dependencyFields) {
    const specs = manifest[field]

    if (specs !== undefined) {
      rewritten[field] = Object.fromEntries(
        Object.entries(specs).map(([name, spec]) => [name, versions.get(name) ?? spec]),
      )
    }
  }

  return rewritten as Manifest
}

/**
 * Gives a version of its own for one try of a packed package: its version with `local.` and the UTC time, to the
 * second, as a prerelease, such as `1.2.0-local.20261123153045`. A version that is a prerelease already gets `.local.`
 * and the time added to it.
 */
export function localVersionOf(version: string, date: Date): string {
  const time = date.toISOString().replace(/\D/g, '').slice(0, 14)

  return `${version}${version.includes('-') ? '.' : '-'}local.${time}`
}

/**
 * Gives a packed `package.json` with the versions in `versions`, keyed by package name: its own `version` when its name
 * is there, and the spec of each dependency, dev dependency, peer dependency and optional dependency that is there,
 * which becomes that exact version. Every other field stays as it was.
 */
export function manifestWithVersions(manifest: PackedManifest, versions: ReadonlyMap<string, string>): PackedManifest {
  return withDependencyVersions({ ...manifest, version: versions.get(manifest.name) ?? manifest.version }, versions)
}

/**
 * Gives the text of a project's `package.json` with each dependency, dev dependency, peer dependency and optional
 * dependency named in `versions` at that exact version, indented as it was and with its final newline, if any. Gives
 * `undefined` when it lists none of them.
 */
export function packageJsonWithVersions(text: string, versions: ReadonlyMap<string, string>): string | undefined {
  const manifest = JSON.parse(text) as DependencyLists
  const listsOne = dependencyFields.some((field) =>
    Object.keys(manifest[field] ?? {}).some((name) => versions.has(name)),
  )

  if (!listsOne) {
    return undefined
  }

  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '

  return `${JSON.stringify(withDependencyVersions(manifest, versions), null, indent)}${text.endsWith('\n') ? '\n' : ''}`
}

/**
 * Gives the config `init` wrote with `image` added after `storybooks`, as the test Storybooks' configs have it until the
 * browser package names a published image. Gives `undefined` when the config doesn't end as `init` writes it.
 */
export function configWithImage(config: string, image: string): string | undefined {
  const quotedImage = `'${image.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  const withImage = config.replace(configEnd, `\n  },\n  image: ${quotedImage},\n})\n`)

  return withImage === config ? undefined : withImage
}
