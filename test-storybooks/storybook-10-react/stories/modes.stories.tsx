import type { Meta, StoryObj } from '@storybook/react-vite'
import { visualCheck } from '../.storybook/visual-check.ts'

/**
 * What the page looked like to the story as it rendered.
 */
interface Measured {
  /**
   * The window's inner width and height, as `<width> × <height>`.
   */
  viewport: string
  /**
   * The window's `devicePixelRatio`.
   */
  scale: number
  /**
   * Whether `(hover: none)` matches.
   */
  hoverNone: boolean
  /**
   * Whether `(pointer: coarse)` matches.
   */
  pointerCoarse: boolean
  /**
   * The navigator's `maxTouchPoints`.
   */
  touchPoints: number
}

/**
 * Measures the page as the story renders. It reads each value once, so the snapshot shows what the story rendered
 * with, whatever the page does after.
 */
function measure(): Measured {
  return {
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    scale: window.devicePixelRatio,
    hoverNone: window.matchMedia('(hover: none)').matches,
    pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints,
  }
}

/**
 * The stylesheet of the hover box: its text says whether the `(hover: hover)` rule applies, and the rule gives it a
 * green background, so the snapshot shows it either way.
 */
const hoverBoxStyle = `
.modes-hover-box::after { content: 'no hover style'; }
@media (hover: hover) {
  .modes-hover-box { background: #86efac; color: #111; }
  .modes-hover-box::after { content: 'hover style applied'; }
}
`

/**
 * What the environment panel shows.
 */
interface EnvironmentProps {
  /**
   * The story's `theme` global.
   */
  theme: unknown
}

/**
 * A bordered panel that shows the story's `theme` global and what the page looked like as the story rendered: the
 * viewport, the scale, whether the page has no hover and a coarse pointer, and how many touch points it has. Below it,
 * a box that only a `(hover: hover)` rule colors. It takes its colors from the page, so the dark theme shows through.
 */
function Environment({ theme }: EnvironmentProps) {
  const measured = measure()

  return (
    <div
      style={{
        width: 320,
        padding: 16,
        border: '1px solid #a1a1aa',
        borderRadius: 6,
        fontFamily: 'sans-serif',
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      <style>{hoverBoxStyle}</style>
      <div>theme: {String(theme)}</div>
      <div>viewport: {measured.viewport}</div>
      <div>scale: {measured.scale}</div>
      <div>hover none: {String(measured.hoverNone)}</div>
      <div>pointer coarse: {String(measured.pointerCoarse)}</div>
      <div>touch points: {measured.touchPoints}</div>
      <div className="modes-hover-box" style={{ marginTop: 8, padding: 8, border: '1px dashed #a1a1aa' }} />
    </div>
  )
}

/**
 * How tall the space between the two panels of `TallTouch` is, in pixels, so the story is about 3000 px tall.
 */
const tallSpacerHeight = 2600

declare global {
  /**
   * Which invalid modes the end-to-end check's invalid-modes case asks `InvalidModeWhenAsked` for, through a script
   * the check's server adds to every story page before Storybook imports any stories file: `undeclared` for a mode
   * whose global Storybook doesn't declare, `pinned` for a mode whose global the story pins.
   */
  var __visualCheckE2eInvalidModes: 'undeclared' | 'pinned' | undefined
}

/**
 * Every story lists `dark` unless it sets its own modes, and is 640 px wide unless it sets its own width.
 */
const meta = {
  title: 'Modes',
  parameters: { ...visualCheck({ modes: ['dark'], viewport: { width: 640 } }) },
  render: (_args, context) => <Environment theme={context.globals.theme} />,
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * Lists `dark` and `mobile`, so it has three snapshots: its default capture, `.dark` on the dark surface, and
 * `.mobile` at 375 × 667 and scale 2, with no hover, a coarse pointer and 5 touch points.
 */
export const DarkAndMobile: Story = {
  parameters: { ...visualCheck({ modes: ['dark', 'mobile'] }) },
}

/**
 * Sets no modes, so it inherits the meta's `dark`: its default capture and `.dark`.
 */
export const InheritsMetaModes: Story = {}

/**
 * Lists only `narrow`, so the meta's `dark` doesn't reach it: its default capture and `.narrow`, and no `.dark`.
 */
export const OwnModesOnly: Story = {
  parameters: { ...visualCheck({ modes: ['narrow'] }) },
}

/**
 * Sets a width of 500, over the meta's 640 and the config's 1280, so its default capture is 500 × 720, the height the
 * config's. Its `.narrow` mode's width wins over the story's, so that one is 375 × 720.
 */
export const ViewportPrecedence: Story = {
  parameters: { ...visualCheck({ modes: ['narrow'], viewport: { width: 500 } }) },
}

/**
 * Sets `defaultCapture: false` and lists `dark` and `narrow`, so it has only those two snapshots: `.dark` at the meta's
 * 640 px on the dark surface, and `.narrow` at 375 px. No default capture is taken, and the modes keep their keys.
 */
export const ModesOnly: Story = {
  parameters: { ...visualCheck({ defaultCapture: false, modes: ['dark', 'narrow'] }) },
}

/**
 * About 3000 px tall, with the environment panel at the top and again at the bottom. Its `.mobile` capture is the full
 * page at scale 2, and both panels show no hover, a coarse pointer, 5 touch points and no hover style.
 */
export const TallTouch: Story = {
  parameters: { ...visualCheck({ modes: ['mobile'] }) },
  render: (_args, context) => (
    <div>
      <Environment theme={context.globals.theme} />
      <div style={{ height: tallSpacerHeight }} />
      <Environment theme={context.globals.theme} />
    </div>
  ),
}

/**
 * The story the invalid-modes case asks for invalid modes, as `__visualCheckE2eInvalidModes` says.
 */
function invalidModeStory(asked: typeof globalThis.__visualCheckE2eInvalidModes): Story {
  if (asked === 'undeclared') {
    return { parameters: { visualCheck: { modes: { 'e2e-undeclared': { globals: { e2eNever: 'x' } } } } } }
  }

  if (asked === 'pinned') {
    return { globals: { theme: 'light' }, parameters: { ...visualCheck({ modes: ['dark'] }) } }
  }

  return { parameters: { ...visualCheck({ modes: [] }) } }
}

/**
 * Valid, with only its default capture, unless the end-to-end check asks for invalid modes. For `undeclared`, its
 * hand-written `parameters.visualCheck` lists the mode `e2e-undeclared`, which sets the global `e2eNever` that
 * Storybook doesn't declare. For `pinned`, it lists `dark` and pins `theme` in its own `globals`. Either way `test`
 * exits 2 naming the story and the key before any capture.
 */
export const InvalidModeWhenAsked: Story = invalidModeStory(globalThis.__visualCheckE2eInvalidModes)
