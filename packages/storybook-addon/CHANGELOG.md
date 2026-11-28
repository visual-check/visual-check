# Changelog

## [0.2.0](https://github.com/visual-check/visual-check/compare/storybook-addon-v0.1.2...storybook-addon-v0.2.0) (2026-11-28)


### ⚠ BREAKING CHANGES

* **cli:** test fails on page errors that aren't expected ([#190](https://github.com/visual-check/visual-check/issues/190))

### Features

* **cli:** a story whose capture would cut its content is broken as overflows ([#189](https://github.com/visual-check/visual-check/issues/189)) ([46c8df3](https://github.com/visual-check/visual-check/commit/46c8df3d2239800087c20b8ab0c4e2d8276a99bb)), closes [#179](https://github.com/visual-check/visual-check/issues/179)
* **cli:** test fails on page errors that aren't expected ([#190](https://github.com/visual-check/visual-check/issues/190)) ([a1526a6](https://github.com/visual-check/visual-check/commit/a1526a6e019f43f3680a279b6869e29a8b50294a)), closes [#177](https://github.com/visual-check/visual-check/issues/177)
* **cli:** update keeps the images of a story it marks broken ([#200](https://github.com/visual-check/visual-check/issues/200)) ([aaf17fe](https://github.com/visual-check/visual-check/commit/aaf17fed99745c2e503120ee1c11fcc188be2b09))

## [0.1.2](https://github.com/visual-check/visual-check/compare/storybook-addon-v0.1.1...storybook-addon-v0.1.2) (2026-11-27)


### Miscellaneous Chores

* **storybook-addon:** Synchronize visual-check versions

## [0.1.1](https://github.com/visual-check/visual-check/compare/storybook-addon-v0.1.0...storybook-addon-v0.1.1) (2026-11-26)


### Miscellaneous Chores

* **storybook-addon:** Synchronize visual-check versions

## 0.1.0 (2026-11-26)


### Features

* **cli:** launch Chromium over raw CDP and read its version ([9f361a4](https://github.com/visual-check/visual-check/commit/9f361a42bef2da11a834f7e3212c472468ca603b))
* **storybook-addon:** add the @visual-check/storybook-addon package ([87e37c7](https://github.com/visual-check/visual-check/commit/87e37c76630439570fa4899cb22b74a2c55568e9))
* **storybook-addon:** relay checks between Storybook and the CLI's child process ([20123cf](https://github.com/visual-check/visual-check/commit/20123cf67a90d6fbcab254151e8933ac3a768187))
* **storybook-addon:** relay updates between Storybook and the CLI's child process ([862b985](https://github.com/visual-check/visual-check/commit/862b985c65fad968c8427bbe1f223d04298c1450))
* **storybook-addon:** say which package to upgrade when the addon and the CLI differ ([6720eab](https://github.com/visual-check/visual-check/commit/6720eab86028cb3861728f8a1c0f1483e2902530))
* **storybook-addon:** show a static build's commands for the current story on a loopback host ([26c05f6](https://github.com/visual-check/visual-check/commit/26c05f6f8ca43dcc9db8cb10f75c26cb34fc52f1))
* **storybook-addon:** the Visual check panel, menu item and status icons ([849d673](https://github.com/visual-check/visual-check/commit/849d67301442883e5d6aee033d69f993e95a2a67))
* **storybook-addon:** update a story's baselines from its panel or its menu ([6319869](https://github.com/visual-check/visual-check/commit/63198692ba812522701919d9cf6839096585a73c))
* **storybook-addon:** wipe between the baseline and the snapshot, or show the visual diff ([2dd2319](https://github.com/visual-check/visual-check/commit/2dd2319bd9d71d1b854ee2eba93608768b9c817d))
* the Storybook addon checks the current story ([#87](https://github.com/visual-check/visual-check/issues/87)) ([#148](https://github.com/visual-check/visual-check/issues/148)) ([117ab54](https://github.com/visual-check/visual-check/commit/117ab54b00db8745cd9fbc04c99aeefc0b894183))
* the Storybook addon updates a story's baselines, and static builds show the commands ([#88](https://github.com/visual-check/visual-check/issues/88)) ([#150](https://github.com/visual-check/visual-check/issues/150)) ([76e1a41](https://github.com/visual-check/visual-check/commit/76e1a413b960478fa7ca04a975bebb75cc13fb3e))
