import { readFileSync } from 'node:fs'
import { createJiti, type JitiOptions } from 'jiti'

/**
 * How jiti reads the config file, following the spec: always through jiti, never Node's own type stripping, and
 * tsconfig `paths` aren't resolved. Each option is set here, so its `JITI_*` environment variable can't change it.
 */
const jitiOptions: JitiOptions = {
  // Never hand a file to Node's own loader first, nor a package by name.
  tryNative: false,
  nativeModules: [],
  // Read every file afresh on every load, so a config edited in a long-lived process loads as it is now.
  moduleCache: false,
  fsCache: false,
  // Keep each module as it is: a config with no default export has no `default`, and the config's own imports behave
  // closer to real ESM.
  interopDefault: false,
  // tsconfig `paths` aren't supported, and neither is any other alias.
  tsconfigPaths: false,
  alias: {},
}

/**
 * Runs the config file through jiti and returns its default export, or `undefined` when it has none. The default
 * export is awaited here, so a promise that rejects fails the load like any other error.
 */
export async function evaluateDefault(path: string): Promise<unknown> {
  // `jiti.import` would hand an `.mjs` config, or a `.js` one in a `"type": "module"` package, to Node's own
  // `import()`, which keeps the first version of a file for the life of the process. `forceTranspile` runs the config
  // file through jiti instead. The files it imports that Node treats as ESM (`.mjs`, and `.js` in a `"type": "module"`
  // package) still load through Node's own loader: the cost of jiti's async mode, which top-level await needs.
  const namespace: unknown = await createJiti(path, jitiOptions).evalModule(readFileSync(path, 'utf8'), {
    filename: path,
    async: true,
    forceTranspile: true,
  })

  return typeof namespace === 'object' && namespace !== null && 'default' in namespace
    ? await namespace.default
    : undefined
}
