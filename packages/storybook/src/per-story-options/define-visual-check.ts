import type { StoryContext } from 'storybook/internal/types'

/**
 * A value of a Storybook global: what a mode sets and what the story's URL carries.
 *
 * @public
 */
export type GlobalValue = string | number | boolean

/**
 * The size and device a story is laid out and captured at.
 *
 * @public
 */
export interface Viewport {
  /**
   * The width in CSS pixels.
   */
  width?: number
  /**
   * The height in CSS pixels.
   */
  height?: number
  /**
   * The device pixel ratio.
   */
  deviceScaleFactor?: number
  /**
   * Whether the browser emulates a touch device.
   */
  touch?: boolean
}

/**
 * How much a snapshot may differ from its baseline before it fails.
 *
 * @public
 */
export interface Tolerance {
  /**
   * How far a pixel's color may move and still count as unchanged, from 0 to 1 (pixelmatch's threshold).
   */
  color?: number
  /**
   * How many pixels may differ. A whole number of 0 or more counts differing CSS pixels: at device scale factor `s` it
   * allows `⌊pixels × s²⌋` image pixels. A string from `'0%'` to `'100%'` is a share of the image's own pixels.
   */
  pixels?: number | `${number}%`
}

/**
 * A region that is painted over before the capture, found by a CSS selector or by the host of its remote content.
 *
 * @public
 */
export type Mask = { selector: string; host?: never } | { host: string; selector?: never }

/**
 * A mask as the helper writes it: both keys, the unused one `null`. Storybook merges two masks of the same name key by
 * key, so a mask that set only `selector` would pick up a `host` from a less specific level. With `null` in the unused
 * key, a more specific level always replaces the kind.
 *
 * @public
 */
export type WrittenMask = { selector: string; host: null } | { host: string; selector: null }

/**
 * What a generic that types a mode's globals must look like: global names that map to global values. It takes a `type`
 * alias and an `interface` alike.
 */
type GlobalsConstraint<Globals> = object & { [Name in keyof Globals]: GlobalValue }

/**
 * The shape of globals when no generic types them: any name, any global value.
 */
type GlobalsShape = Record<string, GlobalValue>

/**
 * The globals a mode may set. A typed `Globals` makes every global optional, since a mode sets some of them. The
 * untyped shape stays as it is, so that a global can't be set to `undefined`.
 */
type ModeGlobals<Globals> = string extends keyof Globals ? Globals : Partial<Globals>

/**
 * A named set of globals and viewport that a story can be captured in besides its default capture.
 *
 * @public
 */
export interface ModeDefinition<Globals extends GlobalsConstraint<Globals> = GlobalsShape> {
  /**
   * The Storybook globals the mode sets, which go into the story's URL. A mode sets some of the globals, not all.
   */
  globals?: ModeGlobals<Globals>
  /**
   * The viewport the mode sets. It merges over the story's own viewport, so the mode wins.
   */
  viewport?: Viewport
}

/**
 * The modes a Storybook declares, once, for its project.
 *
 * @public
 */
export interface VisualCheckDeclaration<
  ModeName extends string,
  Globals extends GlobalsConstraint<Globals> = GlobalsShape,
> {
  /**
   * The Storybook's modes by name. A name takes lowercase letters, digits and `-`.
   */
  modes: Record<ModeName, ModeDefinition<Globals>>
}

/**
 * A hook that runs after a story renders and before it is captured. The capture waits until it settles.
 *
 * It gets only the story's context as Storybook builds it, its `viewMode` and `canvasElement`, and, when the Storybook
 * has `storybook/test`, `canvas` and `userEvent` as `play` gets them. Its type is Storybook's `StoryContext`, which
 * names more than that.
 *
 * @public
 */
export type WaitHook = (context: StoryContext) => void | Promise<void>

/**
 * What a project sets for a Storybook, a stories file or a story. A key set to `undefined` counts as not set.
 *
 * @public
 */
export interface VisualCheckOptions<ModeName extends string> {
  /**
   * The modes to capture besides the default capture, as the exact set for these stories. `[]` captures the default
   * only.
   */
  modes?: readonly ModeName[] | undefined
  /**
   * The default capture's viewport. Deep-merges over the inherited one.
   */
  viewport?: Viewport | undefined
  /**
   * A CSS selector for the element to capture instead of the full page. `null` returns to the full page.
   */
  element?: string | null | undefined
  /**
   * Whether a full-page capture first grows the viewport's height to the page's, so fixed and sticky elements sit where
   * they would on a screen as tall as the page. `false` keeps the viewport's height, so `100vh` stays it. Defaults to
   * `true`. An element's capture never grows it.
   */
  growViewport?: boolean | undefined
  /**
   * The regions to paint over, by name. A name set to `null` drops the inherited mask. `null` drops them all.
   */
  masks?: Record<string, Mask | null> | null | undefined
  /**
   * How much a snapshot may differ from its baseline. Deep-merges over the inherited one.
   */
  tolerance?: Tolerance | undefined
  /**
   * Whether to leave the stories out. `false` on a story brings it back from a disabled file.
   */
  disable?: boolean | undefined
  /**
   * A hook to wait for before the capture. `null` turns an inherited hook off.
   */
  wait?: WaitHook | null | undefined
}

/**
 * What the helper writes into `parameters.visualCheck`. The same keys as the options, except two. `modes` lists every
 * declared mode: its definition when the level names it, `null` when it doesn't. Each mask is written with both keys,
 * the unused one `null` (see `WrittenMask`).
 *
 * @public
 */
export interface VisualCheckParameter {
  /**
   * One entry per declared mode, in the declaration's key order.
   */
  modes?: Record<string, ModeDefinition | null>
  /**
   * The default capture's viewport.
   */
  viewport?: Viewport
  /**
   * A CSS selector for the element to capture, or `null` for the full page.
   */
  element?: string | null
  /**
   * Whether a full-page capture first grows the viewport's height to the page's.
   */
  growViewport?: boolean
  /**
   * The regions to paint over, by name, or `null` for none.
   */
  masks?: Record<string, WrittenMask | null> | null
  /**
   * How much a snapshot may differ from its baseline.
   */
  tolerance?: Tolerance
  /**
   * Whether to leave the stories out.
   */
  disable?: boolean
  /**
   * A hook to wait for before the capture, or `null` for none.
   */
  wait?: WaitHook | null
}

/**
 * The function that writes `parameters.visualCheck` for one level, with mode names checked against the declaration.
 *
 * @public
 */
export type VisualCheck<ModeName extends string> = (options: VisualCheckOptions<NoInfer<ModeName>>) => {
  visualCheck: VisualCheckParameter
}

/**
 * Declares a Storybook's modes once and returns the function that writes `parameters.visualCheck`.
 *
 * The project calls it in `<configDir>/visual-check.ts` and exports the result as `visualCheck`. Stories files import
 * that `visualCheck`, not this package, and spread its result into `parameters` of `preview`, a meta or a story:
 * `parameters: { ...visualCheck({ modes: ['dark'] }) }`. Mode names are checked against the declaration.
 *
 * To type the globals a mode sets, pass them as a generic and call the result: `defineVisualCheck<Globals>()({ modes })`.
 *
 * Storybook merges the three levels, and the most specific level wins:
 *
 * - `modes`: the most specific list.
 * - `viewport` and `tolerance`: merged key by key.
 * - `masks`: merged by name. A name set to `null` drops one mask, and `masks: null` drops all of them.
 * - `wait`, `element`, `growViewport` and `disable`: the most specific value.
 *
 * A key set to `undefined` is left out, so it never hides an inherited value. `null` is kept, and turns one off. The
 * helper checks nothing at run time. visual-check validates the merged options before it captures.
 *
 * @public
 */
export function defineVisualCheck<const ModeName extends string>(
  declaration: VisualCheckDeclaration<ModeName>,
): VisualCheck<ModeName>
/**
 * Types the globals a mode sets. It takes no argument and returns the function that takes the declaration, because
 * TypeScript can't infer the mode names when it is given only the generic. To type the globals, pass them as a generic
 * and call the result: `defineVisualCheck<Globals>()({ modes })`.
 *
 * @public
 */
export function defineVisualCheck<Globals extends GlobalsConstraint<Globals>>(): <const ModeName extends string>(
  declaration: VisualCheckDeclaration<ModeName, Globals>,
) => VisualCheck<ModeName>
/**
 * Implements both call forms: without a declaration it returns the declarer, with one it declares the modes.
 *
 * @public
 */
export function defineVisualCheck(declaration?: VisualCheckDeclaration<string>): unknown {
  if (declaration === undefined) {
    return declareModes
  }

  return declareModes(declaration)
}

/**
 * Returns the function that writes `parameters.visualCheck` for the declared modes.
 */
function declareModes(declaration: VisualCheckDeclaration<string>): VisualCheck<string> {
  /**
   * Writes the parameter for one level.
   */
  return function visualCheck(options) {
    const { modes, masks, ...rest } = options
    const parameter: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        parameter[key] = value
      }
    }

    if (modes !== undefined) {
      parameter.modes = writeModes(declaration.modes, modes)
    }

    if (masks !== undefined) {
      parameter.masks = masks === null ? null : writeMasks(masks)
    }

    return { visualCheck: parameter as VisualCheckParameter }
  }
}

/**
 * Writes one entry per declared mode, in the key order of the declaration: the definition when the list names the mode,
 * `null` when it doesn't.
 */
function writeModes(
  declared: Record<string, ModeDefinition>,
  listed: readonly string[],
): Record<string, ModeDefinition | null> {
  const names = new Set<string>(listed)
  const written: Record<string, ModeDefinition | null> = {}

  for (const [name, definition] of Object.entries(declared)) {
    written[name] = names.has(name) ? definition : null
  }

  return written
}

/**
 * Writes each mask with both keys, the unused one `null`, and keeps a `null` mask as it is. It keeps extra keys and a
 * two-kind mask as they are, so that visual-check's validation sees them.
 */
function writeMasks(masks: Record<string, Mask | null>): Record<string, WrittenMask | null> {
  const written: Record<string, WrittenMask | null> = {}

  for (const [name, mask] of Object.entries(masks)) {
    written[name] =
      mask === null ? null : ({ ...mask, selector: mask.selector ?? null, host: mask.host ?? null } as WrittenMask)
  }

  return written
}
