// PROTOTYPE: animation fixtures for the Animations frozen at their end state ticket. Copied into the Storybook under
// test before its build. Each fixture registers its moving elements in window.__vcFx, so the harness can read their
// computed state at capture, and logs the animation and transition events they receive.
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'
import { userEvent, within } from 'storybook/test'
import gifUrl from './assets/anim.gif'
import webmUrl from './assets/clip.webm'

type Fx = { els: Record<string, Element>; events: string[] }
declare global {
  interface Window { __vcFx?: Fx }
}
const fx = (): Fx => (window.__vcFx ??= { els: {}, events: [] })
const EVENTS = ['animationstart', 'animationend', 'animationcancel', 'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']
const seen = new WeakSet<Element>()
const track = (name: string, el: Element) => {
  fx().els[name] = el
  if (seen.has(el)) return
  seen.add(el)
  for (const t of EVENTS) el.addEventListener(t, (e) => { if (e.target === el) fx().events.push(`${name}:${t}`) })
}
const reg = (name: string) => (el: Element | null) => { if (el) track(name, el) }

const CSS = `
@keyframes vc-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes vc-from0 { from { opacity: 0 } }
@keyframes vc-slide { from { transform: translateX(100%) } }
@keyframes vc-spin { to { transform: rotate(360deg) } }
@keyframes vc-pulse { from { opacity: .2; transform: scale(.6) } to { opacity: 1; transform: scale(1.2) } }
@keyframes vc-move { from { transform: translateX(0) } to { transform: translateX(240px) } }
@keyframes vc-out { to { transform: translateX(400px) } }
.vc-stage { position: relative; width: 1000px; height: 560px; overflow: hidden; background: #f4f1ea; font: 18px/1.4 Montserrat, sans-serif; }
.vc-box { width: 160px; height: 120px; background: #e5175c; color: #fff; display: grid; place-items: center; }
.vc-marker { position: relative; }
.vc-marker::after { content: ''; position: absolute; top: 8px; left: 8px; width: 24px; height: 24px; background: #111; }
`
const Stage = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="vc-stage">
    <style>{CSS}</style>
    <h2 style={{ margin: 16 }}>{title}</h2>
    <div style={{ position: 'absolute', top: 80, left: 24, right: 24, bottom: 24 }}>{children}</div>
  </div>
)
const clickButton = (name: string) => async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
}
const awaitEvent = (el: Element, type: string, ms = 2000) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${type} never fired within ${ms} ms`)), ms)
    el.addEventListener(type, () => { clearTimeout(t); resolve() }, { once: true })
  })

// ---- drawers opened in play, as in Story readiness and page reuse ----
const DrawerTransition = () => {
  const [open, setOpen] = React.useState(false)
  return (
    <Stage title="Drawer: CSS transitions, opened in play">
      <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
      <div ref={reg('overlay')} style={{ position: 'absolute', inset: 0, background: '#000', opacity: open ? 0.5 : 0, transition: 'opacity 300ms ease', pointerEvents: 'none' }} />
      <aside ref={reg('panel')} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, background: '#e5175c', color: '#fff', padding: 16, transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 500ms cubic-bezier(.32,.72,0,1)' }}>Drawer content</aside>
    </Stage>
  )
}
const DrawerKeyframes = () => {
  const [open, setOpen] = React.useState(false)
  return (
    <Stage title="Drawer: keyframes with no fill, opened in play">
      <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
      {open && <div ref={reg('overlay')} style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0.5, animation: 'vc-from0 300ms ease', pointerEvents: 'none' }} />}
      {open && <aside ref={reg('panel')} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, background: '#e5175c', color: '#fff', padding: 16, animation: 'vc-slide 500ms cubic-bezier(.32,.72,0,1)' }}>Drawer content</aside>}
    </Stage>
  )
}

// ---- entrances whose end state exists only through fill-mode ----
const FadeInForwards = () => (
  <Stage title="Fade-in, forwards, from opacity 0, on mount">
    <div ref={reg('fade')} className="vc-box" style={{ opacity: 0, animation: 'vc-fade 400ms ease forwards' }}>visible?</div>
  </Stage>
)
const FadeInForwardsInPlay = () => {
  const [on, setOn] = React.useState(false)
  return (
    <Stage title="Fade-in, forwards, from opacity 0, started in play">
      <button type="button" onClick={() => setOn(true)}>Show</button>
      <div ref={reg('fade')} className="vc-box" style={{ marginTop: 16, opacity: 0, animation: on ? 'vc-fade 400ms ease forwards' : undefined }}>visible?</div>
    </Stage>
  )
}
const DelayedBoth = () => (
  <Stage title="Fade-in, 600 ms delay, fill both">
    <div ref={reg('fade')} className="vc-box" style={{ opacity: 0, animation: 'vc-fade 300ms ease 600ms both' }}>visible?</div>
  </Stage>
)
const TransitionDelay = () => {
  const [on, setOn] = React.useState(false)
  return (
    <Stage title="Transition with a 400 ms delay, started in play">
      <button type="button" onClick={() => setOn(true)}>Go</button>
      <div ref={reg('box')} className="vc-box" style={{ marginTop: 16, background: on ? '#14aa5a' : '#e5175c', transition: 'background-color 300ms ease 400ms' }}>green?</div>
    </Stage>
  )
}

// ---- infinite ----
const SpinnerInfinite = () => (
  <Stage title="Spinner: infinite, linear, no fill">
    <div ref={reg('spin')} className="vc-box vc-marker" style={{ animation: 'vc-spin 1s linear infinite' }} />
  </Stage>
)
const PulseAlternateBoth = () => (
  <Stage title="Pulse: infinite, alternate, fill both">
    <div ref={reg('pulse')} className="vc-box vc-marker" style={{ margin: 40, animation: 'vc-pulse 800ms ease-in-out infinite alternate both' }} />
  </Stage>
)

// ---- page logic that reacts to animation events ----
const Chained = () => {
  const [step, setStep] = React.useState(1)
  return (
    <Stage title="Chained: animationend of the first starts the second">
      <div ref={reg('first')} className="vc-box" style={{ opacity: 0, animation: 'vc-fade 300ms forwards' }} onAnimationEnd={() => setStep(2)}>first</div>
      <div ref={reg('second')} className="vc-box" style={{ marginTop: 16, background: '#0a8cff', animation: step === 2 ? 'vc-move 300ms forwards' : undefined }}>step {step}</div>
    </Stage>
  )
}
// Like Radix's Presence: on close, wait for the exit animation's end before unmounting, unless no animation applies
const ExitOnAnimationEnd = () => {
  const [state, setState] = React.useState<'open' | 'closing' | 'gone'>('open')
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (state !== 'closing' || !ref.current) return
    const el = ref.current
    if (getComputedStyle(el).animationName === 'none') return setState('gone')
    const done = () => setState('gone')
    el.addEventListener('animationend', done, { once: true })
    el.addEventListener('animationcancel', done, { once: true })
  }, [state])
  return (
    <Stage title="Exit: unmount on animationend, as Radix's Presence does">
      <button type="button" onClick={() => setState('closing')}>Close</button>
      <div style={{ marginTop: 16 }}>state: {state}</div>
      {state !== 'gone' && <div ref={(el) => { ref.current = el; if (el) track('exit', el) }} className="vc-box" style={{ marginTop: 16, animation: state === 'closing' ? 'vc-out 300ms ease forwards' : undefined }}>dialog</div>}
    </Stage>
  )
}
const AnimateButton = ({ kind }: { kind: 'animation' | 'transition' }) => {
  const [on, setOn] = React.useState(false)
  const style: React.CSSProperties = kind === 'animation'
    ? { animation: on ? 'vc-move 400ms ease forwards' : undefined }
    : { transform: on ? 'translateX(240px)' : 'translateX(0)', transition: 'transform 400ms ease' }
  return (
    <Stage title={`play awaits ${kind}end`}>
      <button type="button" onClick={() => setOn(true)}>Animate</button>
      <div ref={reg('mover')} data-testid="mover" className="vc-box" style={{ marginTop: 16, ...style }}>mover</div>
    </Stage>
  )
}
const playAwaits = (type: 'animationend' | 'transitionend') => async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const c = within(canvasElement)
  const mover = c.getByTestId('mover')
  const ended = awaitEvent(mover, type)
  await userEvent.click(c.getByRole('button', { name: 'Animate' }))
  await ended
}

// ---- Web Animations API from script, which no stylesheet reaches ----
const Waapi = ({ infinite }: { infinite: boolean }) => {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = ref.current!
    track('waapi', el)
    const a = infinite
      ? el.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 1000, iterations: Infinity })
      : el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }], { duration: 600, easing: 'ease-out', fill: 'forwards' })
    return () => a.cancel()
  }, [infinite])
  return (
    <Stage title={`element.animate(), ${infinite ? 'infinite' : 'finite with fill forwards'}`}>
      <div ref={ref} className="vc-box vc-marker" style={{ margin: 40 }} />
    </Stage>
  )
}

// ---- shadow roots, open and closed ----
const SHADOW_CSS = `${CSS}
.vc-row { display: flex; gap: 24px; align-items: flex-start; }
.panel { width: 160px; height: 120px; background: #0a8cff; transform: translateX(0); transition: transform 500ms ease; }
:host([open]) .panel { transform: translateX(200px); }`
class VcShadowFx extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return
    this.dataset.ready = '1'
    const mode = (this.getAttribute('mode') ?? 'open') as ShadowRootMode
    const root = this.attachShadow({ mode })
    root.innerHTML = `<style>${SHADOW_CSS}</style><div class="vc-row">
      <div class="vc-box fade" style="opacity:0;animation:vc-fade 400ms ease forwards">fade</div>
      <div class="vc-box vc-marker spin" style="animation:vc-spin 1s linear infinite"></div>
      <div class="panel"></div></div>`
    track(`${mode}-fade`, root.querySelector('.fade')!)
    track(`${mode}-spin`, root.querySelector('.spin')!)
    track(`${mode}-panel`, root.querySelector('.panel')!)
  }
}
if (!customElements.get('vc-shadow-fx')) customElements.define('vc-shadow-fx', VcShadowFx)
const Shadow = ({ mode }: { mode: 'open' | 'closed' }) => {
  const ref = React.useRef<HTMLElement>(null)
  return (
    <Stage title={`Shadow root (${mode}): fade forwards, infinite spinner, transition opened in play`}>
      <button type="button" onClick={() => ref.current?.setAttribute('open', '')}>Open panel</button>
      {React.createElement('vc-shadow-fx', { ref, mode, style: { display: 'block', marginTop: 16 } })}
    </Stage>
  )
}

// ---- media ----
const SMIL = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" fill="#f4f1ea"/>
<rect id="r" x="0" y="10" width="60" height="40" fill="#e5175c"><animate attributeName="x" from="0" to="260" dur="2s" repeatCount="indefinite"/></rect>
<circle id="c" cx="20" cy="90" r="20" fill="#0a8cff"><animate attributeName="cx" from="20" to="300" dur="600ms" fill="freeze"/></circle></svg>`
const Gif = () => (
  <Stage title="Animated GIF in img">
    <img src={gifUrl} width={320} height={240} style={{ imageRendering: 'pixelated' }} alt="gif" />
  </Stage>
)
const Video = () => (
  <Stage title="Video: autoplay, muted, loop">
    <video ref={reg('video')} src={webmUrl} width={320} height={240} autoPlay muted loop playsInline />
  </Stage>
)
const SvgSmil = () => (
  <Stage title="Inline SVG with SMIL: an infinite rect and a finite circle that freezes">
    <div ref={(el) => { if (el) { track('smil-rect', el.querySelector('#r')!); track('smil-circle', el.querySelector('#c')!) } }} dangerouslySetInnerHTML={{ __html: SMIL }} />
  </Stage>
)
const SvgInImg = () => (
  <Stage title="SVG with SMIL in img">
    <img src={`data:image/svg+xml,${encodeURIComponent(SMIL)}`} width={320} height={120} alt="svg" />
  </Stage>
)

const meta = { title: 'VC/Animations', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DrawerTransitionInPlay: Story = { render: () => <DrawerTransition />, play: clickButton('Open drawer') }
export const DrawerKeyframesInPlay: Story = { render: () => <DrawerKeyframes />, play: clickButton('Open drawer') }
export const FadeInForwardsOnMount: Story = { render: () => <FadeInForwards /> }
export const FadeInForwardsStartedInPlay: Story = { render: () => <FadeInForwardsInPlay />, play: clickButton('Show') }
export const FadeInDelayedFillBoth: Story = { render: () => <DelayedBoth /> }
export const TransitionDelayedInPlay: Story = { render: () => <TransitionDelay />, play: clickButton('Go') }
export const SpinnerInfiniteNoFill: Story = { render: () => <SpinnerInfinite /> }
export const PulseInfiniteAlternateBoth: Story = { render: () => <PulseAlternateBoth /> }
export const ChainedOnAnimationEnd: Story = { render: () => <Chained /> }
export const ExitUnmountsOnAnimationEnd: Story = { render: () => <ExitOnAnimationEnd />, play: clickButton('Close') }
export const PlayAwaitsAnimationEnd: Story = { render: () => <AnimateButton kind="animation" />, play: playAwaits('animationend') }
export const PlayAwaitsTransitionEnd: Story = { render: () => <AnimateButton kind="transition" />, play: playAwaits('transitionend') }
export const WaapiFinite: Story = { render: () => <Waapi infinite={false} /> }
export const WaapiInfinite: Story = { render: () => <Waapi infinite /> }
export const ShadowOpen: Story = { render: () => <Shadow mode="open" />, play: clickButton('Open panel') }
export const ShadowClosed: Story = { render: () => <Shadow mode="closed" />, play: clickButton('Open panel') }
export const AnimatedGif: Story = { render: () => <Gif /> }
export const VideoAutoplay: Story = { render: () => <Video /> }
export const SvgSmilInline: Story = { render: () => <SvgSmil /> }
export const SvgSmilInImg: Story = { render: () => <SvgInImg /> }
