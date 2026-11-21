import type { Meta, StoryObj } from '@storybook/react-vite'
import { type CSSProperties, createElement, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { userEvent, within } from 'storybook/test'
import animatedGifDataUrl from './animated.gif?inline'
import animatedGifFileUrl from './animated.gif?no-inline'
import clipUrl from './clip.webm'
import smilSpinnerFileUrl from './smil-spinner.svg?no-inline'

/**
 * The keyframes and classes the stories animate with, in each stage's stylesheet and in each shadow root's.
 */
const animationStyles = `
@keyframes animations-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes animations-from-transparent { from { opacity: 0; } }
@keyframes animations-slide-in { from { transform: translateX(100%); } }
@keyframes animations-slide-out { to { opacity: 0; transform: translateX(240px); } }
@keyframes animations-move { from { transform: translateX(0); } to { transform: translateX(240px); } }
@keyframes animations-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes animations-pulse { from { opacity: 0.4; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes animations-slide-right { from { transform: translateX(0); } to { transform: translateX(64px); } }
@keyframes animations-red-to-green { from { background-color: #dc2626; } to { background-color: #16a34a; } }
.animations-pseudo::after {
  content: '';
  position: absolute;
  left: 8px;
  top: 8px;
  width: 16px;
  height: 16px;
  background-color: #18181b;
  animation: animations-slide-right 1s linear infinite;
}
.animations-scroll-driven {
  animation-name: animations-red-to-green;
  animation-timing-function: linear;
  animation-fill-mode: both;
  animation-timeline: scroll();
}
`

/**
 * What a stage shows.
 */
interface StageProps {
  /**
   * The line at the top of the stage, saying what moves on it.
   */
  title: string
  /**
   * What moves, laid out in the stage's area from its top left corner.
   */
  children: ReactNode
}

/**
 * A titled frame 640 px wide with the stories' keyframes. Its area below the title is 300 px tall, positions what's
 * placed absolutely in it, and clips what moves out of it.
 */
function Stage({ title, children }: StageProps) {
  return (
    <div
      style={{
        width: 640,
        boxSizing: 'border-box',
        padding: 16,
        border: '1px solid #a1a1aa',
        borderRadius: 6,
        backgroundColor: '#f4f4f5',
        fontFamily: 'sans-serif',
        fontSize: 16,
        lineHeight: 1.5,
      }}
    >
      <style>{animationStyles}</style>
      <div style={{ marginBottom: 16, fontWeight: 'bold' }}>{title}</div>
      <div style={{ position: 'relative', height: 300, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

/**
 * The style of a solid 120 by 80 px box in this colour, with its label centred in white.
 */
function boxStyle(colour: string): CSSProperties {
  return {
    position: 'relative',
    flex: 'none',
    width: 120,
    height: 80,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: colour,
    color: '#ffffff',
  }
}

/**
 * The style of a row of boxes.
 */
const rowStyle: CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-start' }

/**
 * The style of a column of boxes and lines.
 */
const columnStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }

/**
 * A small dark square in a box's top left corner, so the box's rotation shows.
 */
function Marker() {
  return <div style={{ position: 'absolute', left: 8, top: 8, width: 16, height: 16, backgroundColor: '#18181b' }} />
}

/**
 * The style of the frame a drawer opens in: a white page, 360 by 240 px, below the stage's button.
 */
const drawerFrameStyle: CSSProperties = {
  position: 'absolute',
  top: 40,
  left: 0,
  width: 360,
  height: 240,
  boxSizing: 'border-box',
  padding: 16,
  overflow: 'hidden',
  border: '1px solid #a1a1aa',
  backgroundColor: '#ffffff',
}

/**
 * The style of a drawer's overlay, which darkens the whole frame.
 */
const overlayStyle: CSSProperties = { position: 'absolute', inset: 0, backgroundColor: '#18181b' }

/**
 * The style of a drawer's panel, 200 px wide along the frame's right edge.
 */
const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 200,
  boxSizing: 'border-box',
  padding: 16,
  backgroundColor: '#2563eb',
  color: '#ffffff',
}

/**
 * The style of a chained step's box that fades in: its own `opacity: 0`, and a 300 ms fade-in to `opacity: 1` that keeps
 * its end with `forwards`. Steps 1 and 3 of the chained animation have it.
 */
const fadeInForwards: CSSProperties = { opacity: 0, animation: 'animations-fade-in 300ms ease forwards' }

/**
 * The keyframes of the script animations that move a box 300 px to the right.
 */
const moveRight: Keyframe[] = [{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }]

/**
 * What the stories' `play` functions read from Storybook's context.
 */
interface PlayContext {
  /**
   * The element the story renders into.
   */
  canvasElement: HTMLElement
}

/**
 * Gives a `play` that clicks the story's button with this name.
 */
function clickButton(name: string): (context: PlayContext) => Promise<void> {
  return async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name }))
  }
}

/**
 * Resolves on the target's next event of this type. Rejects when none comes within 5 s, and stops listening then.
 */
function nextEvent(target: EventTarget, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      target.removeEventListener(type, onEvent)
      reject(new Error(`visual-check: no ${type} event came within 5 s`))
    }, 5_000)

    target.addEventListener(type, onEvent, { once: true })
  })
}

/**
 * A button that opens a drawer and turns a box green through CSS transitions: the drawer's overlay fades to 0.5 over
 * 300 ms and its panel slides in over 500 ms, and the box's colour changes over 300 ms after a 400 ms delay.
 */
function TransitionDrawer() {
  const [open, setOpen] = useState(false)

  return (
    <Stage title="Transitions started in play">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <div style={drawerFrameStyle}>
        Page
        <div style={{ ...overlayStyle, opacity: open ? 0.5 : 0, transition: 'opacity 300ms ease' }} />
        <div
          style={{
            ...panelStyle,
            transform: open ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 500ms ease',
          }}
        >
          Drawer
        </div>
      </div>
      <div
        style={{
          ...boxStyle(open ? '#16a34a' : '#dc2626'),
          position: 'absolute',
          top: 40,
          left: 400,
          transition: 'background-color 300ms ease 400ms',
        }}
      >
        delayed
      </div>
    </Stage>
  )
}

/**
 * A button that mounts a drawer whose keyframe animations have no fill: its overlay fades in from `opacity: 0` to its
 * own 0.5 over 300 ms, and its panel slides in from the right over 500 ms.
 */
function KeyframeDrawer() {
  const [open, setOpen] = useState(false)

  return (
    <Stage title="Keyframe animations without fill, started in play">
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <div style={drawerFrameStyle}>
        Page
        {open ? (
          <div style={{ ...overlayStyle, opacity: 0.5, animation: 'animations-from-transparent 300ms ease' }} />
        ) : null}
        {open ? <div style={{ ...panelStyle, animation: 'animations-slide-in 500ms ease' }}>Drawer</div> : null}
      </div>
    </Stage>
  )
}

/**
 * Two boxes whose own style is `opacity: 0`, each fading in on mount: one over 400 ms with `forwards`, the other over
 * 400 ms after a 600 ms delay with `both`. Only their fill mode makes them visible.
 */
function EntranceBoxes() {
  return (
    <Stage title="Entrance animations from opacity 0, on mount">
      <div style={rowStyle}>
        <div style={{ ...boxStyle('#16a34a'), opacity: 0, animation: 'animations-fade-in 400ms ease forwards' }}>
          forwards
        </div>
        <div style={{ ...boxStyle('#2563eb'), opacity: 0, animation: 'animations-fade-in 400ms ease 600ms both' }}>
          delay, both
        </div>
      </div>
    </Stage>
  )
}

/**
 * Two boxes that `element.animate()` moves 300 px to the right over 600 ms on mount: the first with
 * `fill: 'forwards'`, the second without a fill.
 */
function ScriptAnimatedBoxes() {
  const filled = useRef<HTMLDivElement>(null)
  const unfilled = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const animations = [
      filled.current?.animate(moveRight, { duration: 600, easing: 'ease-out', fill: 'forwards' }),
      unfilled.current?.animate(moveRight, { duration: 600, easing: 'ease-out' }),
    ]

    return () => {
      for (const animation of animations) {
        animation?.cancel()
      }
    }
  }, [])

  return (
    <Stage title="Finite element.animate()">
      <div style={columnStyle}>
        <div ref={filled} style={boxStyle('#16a34a')}>
          forwards
        </div>
        <div ref={unfilled} style={boxStyle('#d97706')}>
          no fill
        </div>
      </div>
    </Stage>
  )
}

/**
 * Three boxes that fade in one after the other: step 1 on mount, and each next one mounted by the last one's
 * `animationend`. Steps 1 and 3 start at `opacity: 0` and keep their end with `forwards`. Step 2 has no fill, so once
 * it ends its animation is gone and its box is at its own style. A line says which step ended last.
 */
function ChainedSteps() {
  const [ended, setEnded] = useState(0)

  return (
    <Stage title="Chained animations, each started by the last one's animationend">
      <div style={columnStyle}>
        <div style={rowStyle}>
          <div style={{ ...boxStyle('#dc2626'), ...fadeInForwards }} onAnimationEnd={() => setEnded(1)}>
            step 1
          </div>
          {ended >= 1 ? (
            <div
              style={{ ...boxStyle('#d97706'), animation: 'animations-from-transparent 300ms ease' }}
              onAnimationEnd={() => setEnded(2)}
            >
              step 2
            </div>
          ) : null}
          {ended >= 2 ? (
            <div style={{ ...boxStyle('#16a34a'), ...fadeInForwards }} onAnimationEnd={() => setEnded(3)}>
              step 3
            </div>
          ) : null}
        </div>
        <div>{ended === 0 ? 'No step has ended' : `step ${ended} ended`}</div>
      </div>
    </Stage>
  )
}

/**
 * Where the exiting dialog is: shown, running its exit animation, or unmounted.
 */
type DialogState = 'open' | 'closing' | 'gone'

/**
 * A dialog that, like Radix's Presence, runs an exit animation once Close is clicked, and unmounts on its
 * `animationend` or `animationcancel`, at once when no animation applies. A line shows the dialog's state.
 */
function ExitingDialog() {
  const [state, setState] = useState<DialogState>('open')
  const dialog = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = dialog.current

    if (state !== 'closing' || element === null) {
      return undefined
    }

    if (getComputedStyle(element).animationName === 'none') {
      setState('gone')

      return undefined
    }

    const unmount = (): void => setState('gone')

    element.addEventListener('animationend', unmount)
    element.addEventListener('animationcancel', unmount)

    return () => {
      element.removeEventListener('animationend', unmount)
      element.removeEventListener('animationcancel', unmount)
    }
  }, [state])

  return (
    <Stage title="Exit animation that unmounts on animationend">
      <div style={columnStyle}>
        <button type="button" onClick={() => setState('closing')}>
          Close
        </button>
        <div>state: {state}</div>
        {state === 'gone' ? null : (
          <div
            ref={dialog}
            style={{
              ...boxStyle('#7c3aed'),
              animation: state === 'closing' ? 'animations-slide-out 300ms ease forwards' : undefined,
            }}
          >
            dialog
          </div>
        )}
      </div>
    </Stage>
  )
}

/**
 * A button that moves two boxes 240 px to the right over 400 ms: the first through a `transform` transition, the
 * second through a keyframe animation with `forwards`. The line below is what `play` writes once it has seen both end
 * events.
 */
function EndEventBoxes() {
  const [moving, setMoving] = useState(false)

  return (
    <Stage title="play awaits transitionend and animationend">
      <div style={columnStyle}>
        <button type="button" onClick={() => setMoving(true)}>
          Move
        </button>
        <div
          data-testid="transitioned"
          style={{
            ...boxStyle('#2563eb'),
            transform: moving ? 'translateX(240px)' : 'translateX(0)',
            transition: 'transform 400ms ease',
          }}
        >
          transition
        </div>
        <div
          data-testid="animated"
          style={{ ...boxStyle('#16a34a'), animation: moving ? 'animations-move 400ms ease forwards' : undefined }}
        >
          animation
        </div>
        <div data-testid="end-events">play hasn't seen the end events</div>
      </div>
    </Stage>
  )
}

/**
 * Clicks Move, then waits for both boxes' end events and measures how long they took from the click. Throws when they
 * came in under 390 ms, as they would if something finished the animations while `play` ran. Then it writes that it
 * saw them, leaving the time out of the page, since it varies.
 */
async function awaitEndEvents({ canvasElement }: PlayContext): Promise<void> {
  const canvas = within(canvasElement)
  const ended = Promise.all([
    nextEvent(canvas.getByTestId('transitioned'), 'transitionend'),
    nextEvent(canvas.getByTestId('animated'), 'animationend'),
  ])
  const start = performance.now()

  await userEvent.click(canvas.getByRole('button', { name: 'Move' }))
  await ended

  const milliseconds = Math.round(performance.now() - start)

  if (milliseconds < 390) {
    throw new Error(`visual-check: the end events came after ${milliseconds} ms, expected at least 390`)
  }

  canvas.getByTestId('end-events').textContent = 'play saw transitionend and animationend'
}

/**
 * Four boxes with infinite animations: a CSS spinner, linear without fill; a CSS pulse, alternating with `both`; a CSS
 * animation on the `::after` pseudo-element, the dark square, sliding right; and an `element.animate()` rotation. The
 * rotating boxes have a dark square in a corner, so their angle shows.
 */
function InfiniteBoxes() {
  const scripted = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const animation = scripted.current?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 1000,
      iterations: Number.POSITIVE_INFINITY,
    })

    return () => animation?.cancel()
  }, [])

  return (
    <Stage title="Infinite animations">
      <div style={rowStyle}>
        <div style={{ ...boxStyle('#2563eb'), animation: 'animations-spin 1s linear infinite' }}>
          <Marker />
          spinner
        </div>
        <div
          style={{ ...boxStyle('#16a34a'), animation: 'animations-pulse 800ms ease-in-out infinite alternate both' }}
        >
          pulse
        </div>
        <div className="animations-pseudo" style={boxStyle('#d97706')}>
          ::after
        </div>
        <div ref={scripted} style={boxStyle('#7c3aed')}>
          <Marker />
          animate()
        </div>
      </div>
    </Stage>
  )
}

/**
 * The name of the custom element the shadow root story renders.
 */
const shadowHostName = 'animations-shadow-host'

/**
 * The stylesheet of each shadow root: the stories' keyframes, which a document's stylesheet doesn't give a shadow root,
 * then its boxes. The panel slides 120 px to the right over 500 ms once its host has the `open` attribute.
 */
const shadowStyles = `${animationStyles}
.row { display: flex; gap: 16px; }
.box {
  position: relative;
  width: 120px;
  height: 80px;
  display: grid;
  place-items: center;
  color: #ffffff;
  font: 16px/1.5 sans-serif;
}
.fade { background-color: #16a34a; opacity: 0; animation: animations-fade-in 400ms ease forwards; }
.spinner { background-color: #2563eb; animation: animations-spin 1s linear infinite; }
.marker { position: absolute; left: 8px; top: 8px; width: 16px; height: 16px; background-color: #18181b; }
.panel { background-color: #d97706; transition: transform 500ms ease; }
:host([open]) .panel { transform: translateX(120px); }
`

/**
 * What each shadow root holds: a box fading in with `forwards`, an infinite spinner, and a panel with a `transform`
 * transition.
 */
const shadowMarkup = `<style>${shadowStyles}</style>
<div class="row">
  <div class="box fade">fade</div>
  <div class="box spinner"><div class="marker"></div>spinner</div>
  <div class="box panel">panel</div>
</div>`

/**
 * A custom element that, once connected, puts the shadow markup in a shadow root of the mode its `mode` attribute
 * names: `closed`, or else `open`.
 */
class AnimationsShadowHost extends HTMLElement {
  /**
   * The shadow root it attached, kept here since a closed one can't be read from outside.
   */
  #root: ShadowRoot | undefined

  /**
   * Attaches the shadow root and fills it, the first time the element is connected.
   */
  connectedCallback(): void {
    if (this.#root !== undefined) {
      return
    }

    this.#root = this.attachShadow({ mode: this.getAttribute('mode') === 'closed' ? 'closed' : 'open' })
    this.#root.innerHTML = shadowMarkup
  }
}

if (customElements.get(shadowHostName) === undefined) {
  customElements.define(shadowHostName, AnimationsShadowHost)
}

/**
 * Two shadow hosts, one with an open shadow root and one with a closed one, and a button that gives both the `open`
 * attribute, which starts their panels' transitions.
 */
function ShadowHosts() {
  const openHost = useRef<HTMLElement>(null)
  const closedHost = useRef<HTMLElement>(null)

  const openPanels = (): void => {
    openHost.current?.setAttribute('open', '')
    closedHost.current?.setAttribute('open', '')
  }

  return (
    <Stage title="Shadow roots, open and closed">
      <div style={{ ...columnStyle, gap: 8 }}>
        <button type="button" onClick={openPanels}>
          Open panels
        </button>
        <div>open shadow root</div>
        {createElement(shadowHostName, { ref: openHost, mode: 'open' })}
        <div>closed shadow root</div>
        {createElement(shadowHostName, { ref: closedHost, mode: 'closed' })}
      </div>
    </Stage>
  )
}

/**
 * Two animations visual-check leaves alone: an `element.animate()` that moves a box 300 px over 1 s and keeps its end
 * with `fill: 'forwards'`, which the page pauses halfway on mount, and a scroll-driven CSS animation from red to green
 * on a grey box in a scroll container at scroll 0.
 */
function LeftAloneAnimations() {
  const paused = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const animation = paused.current?.animate(moveRight, { duration: 1000, fill: 'forwards' })

    if (animation !== undefined) {
      animation.pause()
      animation.currentTime = 500
    }

    return () => animation?.cancel()
  }, [])

  return (
    <Stage title="Animations visual-check leaves alone">
      <div style={columnStyle}>
        <div ref={paused} style={boxStyle('#7c3aed')}>
          paused
        </div>
        <div
          style={{ width: 240, height: 120, overflowY: 'auto', scrollbarWidth: 'none', border: '1px solid #a1a1aa' }}
        >
          <div className="animations-scroll-driven" style={boxStyle('#a1a1aa')}>
            scroll-driven
          </div>
          <div style={{ height: 400 }} />
        </div>
      </div>
    </Stage>
  )
}

/**
 * A muted video that plays on its own, in a loop.
 */
function AutoplayVideo() {
  return (
    <Stage title="Video: autoplay, muted, loop">
      <video autoPlay loop muted playsInline src={clipUrl} width={320} height={240} style={{ display: 'block' }} />
    </Stage>
  )
}

/**
 * Whether a video is playing: not paused, with enough data to go on.
 */
function isPlaying(video: HTMLVideoElement): boolean {
  return !video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
}

/**
 * Resolves once the story's video is playing: at once when it already is, else on its `playing` event. Rejects when
 * that doesn't come within 5 s.
 */
async function awaitVideoPlaying({ canvasElement }: PlayContext): Promise<void> {
  const video = canvasElement.querySelector('video')

  if (video === null) {
    throw new Error('visual-check: the video story rendered no video')
  }

  if (isPlaying(video)) {
    return
  }

  await nextEvent(video, 'playing')
}

/**
 * A small player around the muted clip, playing on its own in a loop, whose state follows the video's `play` and
 * `pause` events. While the video is paused, its controls cover it, a Play button and the label `paused` over a dark
 * shade, and the bar under it is blue. While it plays, the controls are hidden and the bar is green. The controls fade
 * through a 300 ms `opacity` transition, and the bar changes colour through a 300 ms `background-color` transition.
 */
function VideoPlayer() {
  const video = useRef<HTMLVideoElement>(null)
  const [paused, setPaused] = useState(true)

  return (
    <Stage title="Video player whose controls fade in when it pauses">
      <div style={{ position: 'relative', width: 320, height: 240 }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          ref={video}
          src={clipUrl}
          width={320}
          height={240}
          style={{ display: 'block' }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(24, 24, 27, 0.6)',
            color: '#ffffff',
            opacity: paused ? 1 : 0,
            transition: 'opacity 300ms ease',
          }}
        >
          <button type="button" onClick={() => void video.current?.play()}>
            Play
          </button>
          <div>{paused ? 'paused' : 'playing'}</div>
        </div>
      </div>
      <div
        style={{
          width: 320,
          height: 16,
          backgroundColor: paused ? '#2563eb' : '#16a34a',
          transition: 'background-color 300ms ease',
        }}
      />
    </Stage>
  )
}

/**
 * An inline SVG with SMIL animations: a red rect moving right over 2 s, forever, and a blue circle moving right once
 * over 600 ms, which then keeps its end with `fill="freeze"`.
 */
function SmilSvg() {
  return (
    <Stage title="Inline SVG with SMIL animations">
      <svg width={320} height={120} viewBox="0 0 320 120" style={{ display: 'block' }}>
        <title>A moving rect and circle</title>
        <rect width={320} height={120} fill="#ffffff" />
        <rect x={0} y={10} width={60} height={40} fill="#dc2626">
          <animate attributeName="x" from="0" to="260" dur="2s" repeatCount="indefinite" />
        </rect>
        <circle cx={20} cy={90} r={20} fill="#2563eb">
          <animate attributeName="cx" from="20" to="300" dur="600ms" fill="freeze" />
        </circle>
      </svg>
    </Stage>
  )
}

/**
 * An SVG with SMIL animations, inlined into a stylesheet as a `data:image/svg+xml` URL: a red square sliding right and
 * back over 2 s, forever.
 */
const smilSlideSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">' +
  '<rect y="20" width="40" height="40" fill="#dc2626">' +
  '<animate attributeName="x" values="0;80;0" dur="2s" repeatCount="indefinite"/>' +
  '</rect></svg>'

/**
 * The rules that show SVG with SMIL animations as CSS images: the sliding square as the background of a box's
 * `::before`, and the spinner file as the `content` of another box's `::after`.
 */
const cssSvgStyles = `
.animations-css-svg { position: relative; width: 120px; height: 80px; background-color: #ffffff; }
.animations-css-svg-background::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,${encodeURIComponent(smilSlideSvg)}");
}
.animations-css-svg-content::after {
  content: url("${smilSpinnerFileUrl}");
  position: absolute;
  inset: 0;
}
`

/**
 * Two boxes showing SVG with SMIL animations as CSS images: one as a `::before`'s background, from a `data:` URL, and
 * one as an `::after`'s `content`, from a file URL, whose path ends in `.svg`.
 */
function CssSvgs() {
  return (
    <Stage title="SVG with SMIL animations as CSS images">
      <style>{cssSvgStyles}</style>
      <div style={rowStyle}>
        <div className="animations-css-svg animations-css-svg-background" />
        <div className="animations-css-svg animations-css-svg-content" />
      </div>
    </Stage>
  )
}

/**
 * What a GIF figure shows.
 */
interface GifFigureProps {
  /**
   * The GIF's URL.
   */
  src: string
  /**
   * What kind of URL it is, shown under the image.
   */
  caption: string
}

/**
 * An animated GIF in an `<img>` at its own 160 by 120 px, with a caption under it.
 */
function GifFigure({ src, caption }: GifFigureProps) {
  return (
    <div>
      <img src={src} width={160} height={120} alt="" style={{ display: 'block' }} />
      <div>{caption}</div>
    </div>
  )
}

/**
 * The same animated GIF twice, side by side: from a file URL, whose path ends in `.gif`, and from a `data:image/gif`
 * URL.
 */
function AnimatedGifs() {
  return (
    <Stage title="Animated GIFs in img">
      <div style={rowStyle}>
        <GifFigure src={animatedGifFileUrl} caption="file URL" />
        <GifFigure src={animatedGifDataUrl} caption="data URL" />
      </div>
    </Stage>
  )
}

const meta = {
  title: 'Animations',
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/**
 * `play` clicks Open, which starts three CSS transitions: the drawer's overlay fades to 0.5 over 300 ms, its panel
 * slides in over 500 ms, and the box turns from red to green over 300 ms after a 400 ms delay. They're still running
 * when `play` finishes. The snapshot shows them finished: the drawer open over the half-dark overlay, and the box
 * green.
 */
export const TransitionsInPlay: Story = {
  render: () => <TransitionDrawer />,
  play: clickButton('Open'),
}

/**
 * `play` clicks Open, which mounts a drawer whose keyframe animations have no fill: its overlay fades in from
 * `opacity: 0`, and its panel slides in from the right. The snapshot shows them finished, so the drawer is open at its
 * own styles: the panel in place over the overlay at 0.5.
 */
export const KeyframesInPlay: Story = {
  render: () => <KeyframeDrawer />,
  play: clickButton('Open'),
}

/**
 * Two boxes fade in from `opacity: 0` as they mount, one with `forwards` and one after a 600 ms delay with `both`.
 * Their own style is `opacity: 0`, so they're visible only at their animations' end. The snapshot shows both.
 */
export const EntranceForwards: Story = {
  render: () => <EntranceBoxes />,
}

/**
 * `element.animate()` moves two boxes 300 px to the right over 600 ms, one with `fill: 'forwards'` and one without.
 * The snapshot shows them finished: the first moved, the second back at its own style, on the left.
 */
export const ScriptAnimations: Story = {
  render: () => <ScriptAnimatedBoxes />,
}

/**
 * Three steps, each a box fading in, where step 1's `animationend` mounts step 2, and step 2's mounts step 3. Step 2's
 * animation has no fill, so once it's finished nothing is left of it but its pending `animationend`. Finishing one
 * animation starts the next, so the snapshot shows the chain's last step: all three boxes, step 2's at its own style,
 * and `step 3 ended`.
 */
export const ChainedAnimation: Story = {
  render: () => <ChainedSteps />,
}

/**
 * `play` clicks Close, which starts the dialog's exit animation; the dialog unmounts on its `animationend`, as Radix's
 * Presence does. The snapshot shows the animation finished and its page logic run: `state: gone`, and no dialog.
 */
export const ExitUnmounts: Story = {
  render: () => <ExitingDialog />,
  play: clickButton('Close'),
}

/**
 * `play` clicks Move, which starts a 400 ms transition on one box and a 400 ms animation with `forwards` on the other,
 * then waits for their `transitionend` and `animationend`. It throws when they come in under 390 ms, or not within
 * 5 s, which breaks the story: it passes only when `play` sees the animations run for their real durations and gets
 * every end event. The snapshot shows both boxes moved, and `play saw transitionend and animationend`.
 */
export const PlayAwaitsEndEvents: Story = {
  render: () => <EndEventBoxes />,
  play: awaitEndEvents,
}

/**
 * Infinite animations never end, so visual-check puts each on its first keyframe: the CSS spinner and the script
 * rotation unturned, with their dark square top left, the pulse at its smallest and faintest, and the `::after`
 * square at its start, on the left. The pseudo-element's animation can't be written into a style, so it stays paused
 * at 0.
 */
export const InfiniteAnimations: Story = {
  render: () => <InfiniteBoxes />,
}

/**
 * Two custom elements, one with an open shadow root and one with a closed one, each holding a fade-in with
 * `forwards`, an infinite spinner, and a panel whose `transform` transition `play` starts through the host's `open`
 * attribute. The snapshot shows both as in the document: the fade-in visible, the spinner unturned, the panel moved.
 */
export const ShadowRoots: Story = {
  render: () => <ShadowHosts />,
  play: clickButton('Open panels'),
}

/**
 * An `element.animate()` with `fill: 'forwards'` that the page paused halfway itself, and a scroll-driven CSS
 * animation, from red to green, in a scroll container at scroll 0. visual-check leaves both alone, so the snapshot shows
 * the first box halfway, 150 px to the right, and the second red. Finished, the first box would be 300 px to the right,
 * and put on its first keyframe, back on the left; finishing the second would turn it green.
 */
export const LeftAlone: Story = {
  render: () => <LeftAloneAnimations />,
}

/**
 * A muted video that plays on its own, in a loop: a white square moving right over a background that changes colour.
 * `play` waits until it plays, so it's playing at capture on any machine. The snapshot shows its first frame: the
 * square on the left, on pink.
 */
export const Video: Story = {
  render: () => <AutoplayVideo />,
  play: awaitVideoPlaying,
}

/**
 * The clip in a small player whose state follows the video's `play` and `pause` events: when the video pauses, its
 * controls, a Play button and the label `paused`, fade in over 300 ms, and the bar under it turns blue over 300 ms,
 * both through CSS transitions, which run the other way when it plays. `play` waits until the video plays. On 9.1 and
 * 10, the controls' fade-out and the bar's change to green have only just started then, and the end state's first pass
 * finishes them; Storybook 11 finishes them itself. visual-check pauses the video once the animations are finished, so
 * its `pause` event starts both transitions back then, and visual-check finishes them too. The snapshot shows the
 * video's first frame under the controls, fully faded in, with `paused`, and the bar blue.
 */
export const VideoPlayerControls: Story = {
  render: () => <VideoPlayer />,
  play: awaitVideoPlaying,
}

/**
 * An inline SVG with SMIL animations: a rect moving forever, and a circle moving once, then frozen at its end. The
 * snapshot shows the SVG at time 0, both shapes at their start, on the left.
 */
export const InlineSvgAnimation: Story = {
  render: () => <SmilSvg />,
}

/**
 * Two boxes showing SVG with SMIL animations as CSS images: a red square sliding right and back, as a `::before`'s
 * background from a `data:` URL, and a rotating bar and a growing dot, as an `::after`'s `content` from a file URL.
 * Their clocks are out of reach of scripts, so visual-check rewrites each SVG with its animations held. The snapshot
 * shows them at time 0: the square on the left, the bar upright and the dot at its smallest.
 */
export const CssSvgAnimations: Story = {
  render: () => <CssSvgs />,
}

/**
 * The same animated GIF twice: from a file URL, whose path ends in `.gif`, and from a `data:image/gif` URL. The
 * snapshot shows both on their first frame, the pink one.
 */
export const Gifs: Story = {
  render: () => <AnimatedGifs />,
}
