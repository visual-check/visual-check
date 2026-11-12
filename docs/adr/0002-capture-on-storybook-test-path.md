# Snapshots are captured on Storybook's test path and brought to their end state only at capture

Storybook sleeps a fixed 100 ms per story before `storyRendered`, about half of each capture. visual-check skips it by ending the user agent in `StorybookTestRunner`, which puts Storybook 9.1 and later on its test path: [Story readiness and page reuse](https://github.com/visual-check/visual-check/issues/21) measured a story ready in 80 ms instead of 170 ms. Otherwise the story runs as it does in plain Storybook. visual-check adds no stylesheet and emulates `prefers-reduced-motion: no-preference`. Only at capture does it bring the page to its end state:

1. It calls `finish()` on every running finite animation, CSS or script, in the document and in every shadow root.
2. It lets a frame pass, so end events run page logic.
3. It repeats until two checks a frame apart find nothing finite running.
4. It puts infinite animations on their first keyframe, and video, inline SVG animation and GIFs on their first frame.

Three alternatives lost ([Animations frozen at their end state](https://github.com/visual-check/visual-check/issues/44)):

- **A stylesheet from document start,** `animation:none` as this ADR first had it, or zero durations. Either changes how the story runs: transitions never start, so `transitionend` never fires. With `none`, `animationend` doesn't fire either, and an entrance animation with `forwards` never becomes visible.
- **A single `finish()`:** page logic that reacts to the end events, such as a chained animation or an exit that unmounts, runs after the screenshot.
- **Pausing where the animation is,** as Storybook's test path does after `play`: a drawer opened in `play` then froze at a different point on each run, by up to 902,594 pixels.

## Consequences

- There's no option to turn any of this off. Changing which frame a snapshot shows later changes every baseline with an animation.
- On Storybook 9 and 10, the test path adds its own pause stylesheet after `play`, with `animation-direction: reverse` and the animations paused. visual-check empties it as it's added, so the story keeps running as in plain Storybook. Storybook 11 pauses with `finish()` and `currentTime = 0` instead, which agrees with this end state. visual-check still pins the infinite animations Storybook 11 parks on their first frame, as it pins its own ([Storybook 9 floor and Storybook 11](https://github.com/visual-check/visual-check/issues/48)).
- The trigger is internal to Storybook. 9.0 checks for a Playwright page global instead, which is one reason 9.1 is the floor. If the trigger is dropped, Storybook's own wait comes back: 100 ms, plus any running finite animations, up to 5 s. Slower, still correct. A run sees the wait between Storybook's "completing" and "completed" render steps and warns once.
- Two kinds of animation are written into the element's inline style and then removed:
  - an infinite animation, at its first keyframe;
  - a finished animation whose fill mode still holds its end.

  Chromium can keep painting an earlier frame of a composited animation after `pause()` or `finish()` on a busy machine.
- Closed shadow roots are reached by wrapping `attachShadow` at document start. Declarative shadow roots are reached only when open.
- These are left to the project, through masks or a `wait` hook: SVG in `<img>`, GIFs as CSS backgrounds or cross-origin without CORS, APNG and animated WebP, canvas, Lottie and JS-driven motion.
- A grid story that forces states rewrites its own page's stylesheets, through code it imports, the same way in plain Storybook (ADR 0009). The capture still adds nothing.
