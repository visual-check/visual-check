import { describe, expect, it } from 'vitest'
import { frameworkProblemsOf, importProblemsOf, type PackageEntry } from './no-framework.ts'

/**
 * Makes an error with a Node error code, as `require.resolve` throws.
 */
function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('importProblemsOf', () => {
  const root: PackageEntry = { specifier: '@visual-check/storybook' }
  const react: PackageEntry = { specifier: '@visual-check/storybook/react', framework: 'react' }
  const vue: PackageEntry = { specifier: '@visual-check/storybook/vue', framework: 'vue' }

  it('finds no problem when the root entry imports', () => {
    expect(importProblemsOf(root, { status: 0, stderr: '' })).toEqual([])
  })

  it("names the root entry and the error's last line when it doesn't import", () => {
    const stderr = 'node:internal/modules/esm/resolve:1\n  throw error\nSyntaxError: Unexpected token\n'

    expect(importProblemsOf(root, { status: 1, stderr })).toEqual([
      "@visual-check/storybook didn't import: SyntaxError: Unexpected token",
    ])
  })

  it('finds no problem when a framework entry fails because its framework is missing', () => {
    const stderr = [
      'node:internal/modules/package_json_reader:255',
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react' imported from /tmp/project/node_modules/x.js",
      "  code: 'ERR_MODULE_NOT_FOUND'",
    ].join('\n')

    expect(importProblemsOf(react, { status: 1, stderr })).toEqual([])
  })

  it('names a framework entry that imports without its framework', () => {
    expect(importProblemsOf(react, { status: 0, stderr: '' })).toEqual([
      '@visual-check/storybook/react imported, but should fail without react',
    ])
  })

  it('names a framework entry that fails for another reason, with the first line that has an error', () => {
    const stderr = [
      'node:internal/modules/esm/resolve:314',
      'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./react\' is not defined by "exports"',
      "  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'",
    ].join('\n')

    expect(importProblemsOf(react, { status: 1, stderr })).toEqual([
      '@visual-check/storybook/react failed for another reason than a missing react: ' +
        'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./react\' is not defined by "exports"',
    ])
  })

  it('takes a missing package other than its framework for another reason', () => {
    const stderr = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react-dom' imported from /tmp/x.js"

    expect(importProblemsOf(react, { status: 1, stderr })).toEqual([
      `@visual-check/storybook/react failed for another reason than a missing react: ${stderr}`,
    ])
  })

  it('finds no problem when the Vue entry fails because vue is missing', () => {
    const stderr =
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vue' imported from /tmp/project/node_modules/x.js"

    expect(importProblemsOf(vue, { status: 1, stderr })).toEqual([])
  })

  it("takes a missing @vue/runtime-dom for another reason than a missing vue, though its name holds 'vue'", () => {
    const stderr = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@vue/runtime-dom' imported from /tmp/x.js"

    expect(importProblemsOf(vue, { status: 1, stderr })).toEqual([
      `@visual-check/storybook/vue failed for another reason than a missing vue: ${stderr}`,
    ])
  })
})

describe('frameworkProblemsOf', () => {
  it('finds no problem when no framework resolves', () => {
    expect(
      frameworkProblemsOf(() => {
        throw errorWithCode('MODULE_NOT_FOUND')
      }),
    ).toEqual([])
  })

  it('names a framework that resolves', () => {
    expect(
      frameworkProblemsOf((specifier) => {
        if (specifier !== 'vue/package.json') {
          throw errorWithCode('MODULE_NOT_FOUND')
        }
      }),
    ).toEqual(['vue is installed'])
  })

  it('takes another error code for a framework that is there', () => {
    expect(
      frameworkProblemsOf((specifier) => {
        throw errorWithCode(specifier === 'react/package.json' ? 'ERR_PACKAGE_PATH_NOT_EXPORTED' : 'MODULE_NOT_FOUND')
      }),
    ).toEqual(['react is installed'])
  })

  it('asks for the package.json of each framework', () => {
    const specifiers: string[] = []

    frameworkProblemsOf((specifier) => {
      specifiers.push(specifier)

      throw errorWithCode('MODULE_NOT_FOUND')
    })

    expect(specifiers).toEqual([
      'react/package.json',
      'react-dom/package.json',
      'vue/package.json',
      '@angular/core/package.json',
    ])
  })
})
