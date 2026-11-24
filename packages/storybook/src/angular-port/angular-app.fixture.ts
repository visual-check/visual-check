import {
  Component,
  type EnvironmentProviders,
  Input,
  type Provider,
  provideExperimentalZonelessChangeDetection,
  type Type,
} from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { provideServerRendering, renderApplication } from '@angular/platform-server'
import type { CombinationsStory } from './combinations.js'

/**
 * How a test places a story: what wraps its template, and what its root component imports and provides besides the
 * story's own, and what the app provides.
 */
export interface StoryRootOptions {
  /**
   * Wraps the story's template, as a parent component around the grid.
   */
  wrap?: (template: string) => string
  /**
   * What the root imports besides the story's `moduleMetadata.imports`, such as a parent component.
   */
  imports?: Type<unknown>[]
  /**
   * What the root component provides, as Storybook's wrapper provides the story's `moduleMetadata.providers`.
   */
  providers?: Provider[]
  /**
   * What the app provides.
   */
  appProviders?: (Provider | EnvironmentProviders)[]
}

/**
 * Registers each named field of the class as a signal input, the way Angular's CLI compiles `input()` in JIT mode,
 * and returns the class. A required input lists `true`.
 */
export function withSignalInputs<T extends Type<unknown>>(type: T, inputs: Record<string, boolean>): T {
  for (const [name, required] of Object.entries(inputs)) {
    // Safe: what Angular's CLI emits for `input()` in JIT mode, with no transform. `Input`'s public options lack `isSignal`.
    const options = { isSignal: true, alias: name, required } as Input

    Input(options)(type.prototype, name)
  }

  return type
}

/**
 * How many roots the tests have made: each root's own number, so Angular gives each a different component ID.
 */
let roots = 0

/**
 * A standalone root component, `<vc-root>`, that renders the story as Storybook's Angular renderer does: its template,
 * reading the story's props from the instance, with the story's module metadata imported.
 */
function storyRootOf(story: CombinationsStory, options: StoryRootOptions = {}): Type<unknown> {
  const { props } = story

  return Component({
    selector: 'vc-root',
    standalone: true,
    host: { 'data-vc-root': String(++roots) },
    template: options.wrap ? options.wrap(story.template) : story.template,
    imports: [...story.moduleMetadata.imports, ...(options.imports ?? [])],
    providers: options.providers ?? [],
  })(
    class {
      /**
       * What the story's template reads.
       */
      visualCheckGrid = props.visualCheckGrid
    },
  )
}

/**
 * The story's server-rendered markup inside `<vc-root>`, one tag per line. Only Angular's own spellings are rewritten
 * to React's, so the React port's snapshots apply verbatim: comments and the test components' host tags are dropped,
 * and a style's `: ` and `; ` lose their space and its trailing `;` is dropped.
 */
export async function markupOf(story: CombinationsStory, options: StoryRootOptions = {}): Promise<string> {
  const root = storyRootOf(story, options)
  const html = await renderApplication(
    (context) =>
      bootstrapApplication(
        root,
        {
          providers: [
            provideServerRendering(),
            provideExperimentalZonelessChangeDetection(),
            ...(options.appProviders ?? []),
          ],
        },
        context,
      ),
    { document: '<vc-root></vc-root>' },
  )
  const inner = /<vc-root[^>]*>(.*)<\/vc-root>/s.exec(html)?.[1]

  if (inner === undefined) {
    throw new Error(`No <vc-root> in the rendered page: ${html}`)
  }

  return inner
    .replaceAll(/<!--.*?-->/gs, '')
    .replaceAll(/<\/?vc-[a-z-]+[^>]*>/g, '')
    .replaceAll(
      /style="([^"]*)"/g,
      (_, style: string) => `style="${style.replaceAll(/([:;]) /g, '$1').replace(/;$/, '')}"`,
    )
    .replaceAll('><', '>\n<')
}
