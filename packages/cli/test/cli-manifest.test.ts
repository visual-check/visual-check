import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  devDependencies?: Record<string, string>
}

describe("the CLI's package.json", () => {
  it('takes the workspace browser package as a devDependency, so pnpm pack writes the exact version init adds', () => {
    expect(manifest.devDependencies?.['@visual-check/chromium']).toBe('workspace:*')
  })
})
