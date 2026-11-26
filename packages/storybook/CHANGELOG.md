# Changelog

## [0.1.1](https://github.com/visual-check/visual-check/compare/storybook-v0.1.0...storybook-v0.1.1) (2026-11-26)


### Bug Fixes

* a full-page capture grows the viewport to the page, so fixed and sticky elements sit where the page puts them ([#166](https://github.com/visual-check/visual-check/issues/166)) ([42c5d7b](https://github.com/visual-check/visual-check/commit/42c5d7bffcfb84786b8d3fc18f88f1f32119882b)), closes [#164](https://github.com/visual-check/visual-check/issues/164)

## 0.1.0 (2026-11-26)


### Features

* Angular grid port ([#93](https://github.com/visual-check/visual-check/issues/93)) ([#155](https://github.com/visual-check/visual-check/issues/155)) ([c9bec99](https://github.com/visual-check/visual-check/commit/c9bec998f914a5551c59ac7c27fabac53d3f9b53))
* **cli:** bring the page to its end state at capture ([#121](https://github.com/visual-check/visual-check/issues/121)) ([2265bc9](https://github.com/visual-check/visual-check/commit/2265bc927dfbb0eb5dc4565ada486faaabc60174))
* **cli:** launch Chromium over raw CDP and read its version ([9f361a4](https://github.com/visual-check/visual-check/commit/9f361a42bef2da11a834f7e3212c472468ca603b))
* **cli:** run each story's wait hook before capturing ([be637d3](https://github.com/visual-check/visual-check/commit/be637d384ace236da9c02f11de36ea8a661e4857))
* forced states in grid stories, and forceStates ([#90](https://github.com/visual-check/visual-check/issues/90)) ([#152](https://github.com/visual-check/visual-check/issues/152)) ([f99bbbd](https://github.com/visual-check/visual-check/commit/f99bbbdc27d481934780fcd95c4edb24e3a8b343))
* grid stories with Combinations from @visual-check/storybook/react ([#89](https://github.com/visual-check/visual-check/issues/89)) ([#151](https://github.com/visual-check/visual-check/issues/151)) ([382328f](https://github.com/visual-check/visual-check/commit/382328fa31d9e16de3c27c97528b01e878c24aa4))
* modes and viewport ([#122](https://github.com/visual-check/visual-check/issues/122)) ([829712b](https://github.com/visual-check/visual-check/commit/829712b4eaf64a31671156c0f684e5237874b5ef))
* per-story options: reading, validation, `disable` and `wait` ([#120](https://github.com/visual-check/visual-check/issues/120)) ([66098c5](https://github.com/visual-check/visual-check/commit/66098c5f77089756c8fccb1005d345e15dbdb03e))
* plain-DOM grid port ([#91](https://github.com/visual-check/visual-check/issues/91)) ([#153](https://github.com/visual-check/visual-check/issues/153)) ([27cd998](https://github.com/visual-check/visual-check/commit/27cd99840b88614a556d35e6cddd0ab132e78067))
* **storybook:** add defineVisualCheck for per-story options ([de95495](https://github.com/visual-check/visual-check/commit/de954956795565a2f2fe195c9c9890488c790b8d))
* **storybook:** add the @visual-check/storybook package ([0d8fcc6](https://github.com/visual-check/visual-check/commit/0d8fcc67ad6455ed3e65dbd037583769cb27ee6e))
* **storybook:** draw state columns and the header row in React, and force their states while the grid is shown ([857a4ab](https://github.com/visual-check/visual-check/commit/857a4abb48646997ba3d911db4453b937be8d5c5))
* **storybook:** draw the grid in Angular with combinations() from @visual-check/storybook/angular ([1485426](https://github.com/visual-check/visual-check/commit/14854268669fa42287f4e27e50f57c27bb9738d8))
* **storybook:** draw the grid in plain DOM with combinations() from @visual-check/storybook ([0302b2b](https://github.com/visual-check/visual-check/commit/0302b2b1d10d44f284449477abf295446f173429))
* **storybook:** draw the grid in React with Combinations from @visual-check/storybook/react ([30d5ee7](https://github.com/visual-check/visual-check/commit/30d5ee7079f45fd20d17c4b73e8e7ff1faeb83c7))
* **storybook:** draw the grid in Vue with Combinations from @visual-check/storybook/vue ([74238ac](https://github.com/visual-check/visual-check/commit/74238acab6506b2fd01fcda327ad15b7ae09200b))
* **storybook:** force a plain-DOM grid's states from when it's drawn until it leaves the page ([dc40548](https://github.com/visual-check/visual-check/commit/dc405480cd6a75ff62b7b9eb1d41e2da710f6064))
* **storybook:** force a Vue grid's states from just before it mounts until it unmounts ([1a6e9b2](https://github.com/visual-check/visual-check/commit/1a6e9b2bc239f0279a80aa295ff12737ac38956c))
* **storybook:** force an Angular grid's states from when its element is created until it's destroyed ([3025c51](https://github.com/visual-check/visual-check/commit/3025c513931d499ed9eabb2848bd7ce3785737c9))
* **storybook:** force states on a page with forceStates, through every stylesheet and shadow root, as styles change ([ad91374](https://github.com/visual-check/visual-check/commit/ad9137410bca8a6f28919d4e1b4e280502ca8c5c))
* **storybook:** give each stylesheet rule that uses a forced state a twin selector at the same specificity ([a81ec39](https://github.com/visual-check/visual-check/commit/a81ec390e643dabf818dd3d88b2784930f85c48b))
* **storybook:** rewrite a stylesheet's rules in place for forced states, grouped, nested and imported rules included ([2b605e3](https://github.com/visual-check/visual-check/commit/2b605e3460e1fdeae4413991c849d65039111966))
* **storybook:** type a mode's globals with a generic ([1722275](https://github.com/visual-check/visual-check/commit/1722275fa5236a914087c1cac874f8c0d37e4077))
* **storybook:** work out a grid's rows, captions and inline styles without a framework ([84d6109](https://github.com/visual-check/visual-check/commit/84d6109f47cf8527407284e731df5a85a73d8347))
* **storybook:** work out a grid's state columns, header row and state classes ([22e7b17](https://github.com/visual-check/visual-check/commit/22e7b17a94e65bcec361055c151f4d4b728b9d29))
* Vue grid port ([#92](https://github.com/visual-check/visual-check/issues/92)) ([#154](https://github.com/visual-check/visual-check/issues/154)) ([dcdf4d2](https://github.com/visual-check/visual-check/commit/dcdf4d2cd000abde4e4a871f3aa1d25f7a336673))
