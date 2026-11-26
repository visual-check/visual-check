# A full-page capture grows the viewport to the page

Before a full-page capture, visual-check grows the viewport's height to the page's, once, and captures at that height. Capturing beyond the viewport without resizing it, as the capture engine first did, lost because Chromium lays out fixed and sticky elements against the viewport, so on a page taller than it they were drawn mid-page: a sticky save bar at about 800 px over a form field of a 3,505 px page, and a scroll-locked page with an open drawer drew the drawer over the top 851 px, a blank band and then the end of the page, a raster that changed on every capture ([#164](https://github.com/visual-check/visual-check/issues/164)). Growing until the height stops changing, as some harnesses do, lost because a page with `min-height: 100vh` under a header grows by the header each time. A cap on that loop would still stretch every `100vh` section, so it buys nothing over one growth. Leaving the growth opt-in lost because every project with a sticky footer or a drawer would get mid-page snapshots until it found the option.

## Consequences

- A snapshot shows the page as a screen as tall as the page shows it, with fixed and sticky elements at the page's bottom, as harnesses that resize the viewport before capturing show it.
- `100vh` becomes the page's height, as it was measured once the story's images and fonts were ready, so a full-screen section grows with the page. `growViewport: false` keeps the viewport's height for a story that needs it.
- The viewport grows after the first check of images and fonts and before the `wait` hook, so the hook and the end state run at the grown size. When it grew, images and fonts are checked again, since a taller viewport can show lazy images.
- Content that grows with the viewport isn't chased: what lies below the grown viewport is captured beyond it, as before.
- Each tall story's snapshot changed once, so its baseline needs `update` after the upgrade.
- A page over 32,767 device pixels tall keeps its viewport, and its capture is `too-tall` as before.
