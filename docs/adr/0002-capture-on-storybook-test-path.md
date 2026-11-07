# Snapshots are captured on Storybook's test path with animations off

Storybook sleeps a fixed 100 ms per story before `storyRendered`, about half of each capture. visual-check skips it by ending the user agent in `StorybookTestRunner`, which puts Storybook 9 and later on its test path, and injects `*,*::before,*::after{animation:none!important;transition:none!important}` at document start. [Story readiness and page reuse](https://github.com/visual-check/visual-check/issues/21) measured a story ready in 80 ms instead of 170 ms. The test path alone wasn't pixel-safe, because Storybook pauses animations only after `play`: a drawer opened in `play` varied by up to 13,449 pixels between runs. With the stylesheet, it varied by 0.

## Consequences

- There's no option to turn it off. Baselines from this path don't match the normal path, by about 12,000 pixels on the drawer story, so switching later changes every baseline.
- The trigger is internal to Storybook. If it's dropped, the 100 ms wait comes back: slower, still correct.
- JS-driven animations are the project's job, as is any element that's visible only through an animation with `animation-fill-mode: forwards`. Without animations it shows its base state.
