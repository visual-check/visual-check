// The Chromium switches and features below are the ones Playwright v1.65.1 launches Chromium with, listed here as data,
// in Playwright's order, for a headless, non-Android, non-persistent launch with PLAYWRIGHT_LEGACY_SCREENSHOT unset.
// The notes beside them are visual-check's own summaries of why each one is there. Sources:
// https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
// https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright-core/src/server/chromium/chromium.ts
// (`defaultArgs` and `_innerDefaultArgs`). Playwright is licensed under the Apache License 2.0. Review this list
// against Playwright's latest release on every Chromium bump.

/**
 * The Chromium features Playwright turns off.
 */
const disabledFeatures = [
  // https://github.com/microsoft/playwright/issues/14047
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'DestroyProfileOnBrowserClose',
  // Both stop Chromium from switching plain-HTTP pages to HTTPS on its own:
  // https://github.com/microsoft/playwright/issues/43871
  'HttpsUpgrades',
  'HttpsFirstBalancedModeAutoEnable',
  // Lens in the address bar, which fails in builds that aren't Google's.
  'LensOverlay',
  // Casting: https://github.com/microsoft/playwright/pull/8162
  'MediaRouter',
  // Holding the old page's paint during a navigation: https://github.com/microsoft/playwright/issues/28023
  'PaintHolding',
  // Partitioned third-party storage: https://github.com/microsoft/playwright/issues/32230
  'ThirdPartyStoragePartitioning',
  // From Chromium 155, intercepted cross-origin redirects after a preflight fail with net::ERR_ABORTED:
  // https://github.com/microsoft/playwright/issues/43242
  'AvoidCorsURLLoaderRestartOnRedirect',
  // Random TCP ports on Windows, which now and then fail with ERR_NO_BUFFER_SPACE: https://crbug.com/572515601
  'TcpPortRandomizationWin',
  // The next four stop requests to Google at startup: optimization hints, network time, AI Mode eligibility, and
  // preconnects to the default search engine (https://github.com/microsoft/playwright/issues/42910).
  'OptimizationHints',
  'NetworkTimeServiceQuerying',
  'AimEnabled',
  'PreconnectToSearch',
  // The last two only matter to Edge: forced sign-in, and its macOS LaunchServices updates.
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
]

/**
 * The Chromium features Playwright turns on.
 */
const enabledFeatures = [
  // The screenshot path Playwright uses unless PLAYWRIGHT_LEGACY_SCREENSHOT is set.
  'CDPScreenshotNewSurface',
  // Stops a /ListAccounts request to accounts.google.com at startup:
  // https://github.com/microsoft/playwright/issues/42910 and https://issues.chromium.org/565837024
  'SkipListAccountsWithoutGaiaCookies',
]

/**
 * The switches Playwright passes to every Chromium launch, in its order.
 */
const chromiumSwitches = [
  // Leaves out the field trial testing config, so features keep their defaults:
  // https://source.chromium.org/chromium/chromium/src/+/main:testing/variations/README.md
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  // Going back reloads the page instead of restoring it from memory, so its requests happen again.
  '--disable-back-forward-cache',
  '--disable-breakpad',
  '--disable-component-extensions-with-background-pages',
  // No component downloads after startup.
  '--disable-component-update',
  '--no-default-browser-check',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  // Edge's updater on macOS.
  '--disable-edgeupdater',
  '--disable-extensions',
  `--disable-features=${disabledFeatures.join(',')}`,
  `--enable-features=${enabledFeatures.join(',')}`,
  '--allow-pre-commit-input',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  // Keeps Edge on macOS from launching its updater.
  '--disable-updater-scheduler',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  // https://chromium-review.googlesource.com/c/chromium/src/+/2436773
  '--no-service-autorun',
  // https://chromium-review.googlesource.com/c/chromium/src/+/4853540
  '--disable-search-engine-choice-screen',
  // https://issues.chromium.org/41491762
  '--unsafely-disable-devtools-self-xss-warnings',
  // Software WebGL: https://issues.chromium.org/issues/40277080
  '--enable-unsafe-swiftshader',
  // Edge on Windows can relaunch itself and lose its output and CDP pipes.
  '--edge-skip-compat-layer-relaunch',
  // Chrome for Testing's stack sampling profiler crashes it on Windows:
  // https://github.com/microsoft/playwright/issues/43327
  '--disable-stack-profiler',
  // Hides Chrome for Testing's infobar, which only a persistent profile shows.
  '--disable-infobars',
  // Avoids a crash from the browser menu in profiles that aren't kept.
  '--disable-sync',
  // Keeps Chromium on Windows from relaunching without admin rights: https://issues.chromium.org/u/1/issues/435410220
  '--do-not-de-elevate',
]

/**
 * The switches Playwright adds for a headless launch.
 */
const headlessSwitches = [
  '--headless',
  '--hide-scrollbars',
  '--mute-audio',
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
]

/**
 * Builds the arguments Chromium is launched with: Playwright's switches for a headless launch, `--no-sandbox` when the
 * sandbox is off, `--disable-skia-runtime-opts`, then the profile folder and the CDP pipe.
 *
 * `--disable-skia-runtime-opts` is visual-check's own: it turns off Skia's code paths picked by CPU at run time, so
 * gradients come out the same under Rosetta as on real amd64 runners.
 */
export function launchArguments(options: { sandbox: boolean; profileDir: string }): string[] {
  return [
    ...chromiumSwitches,
    ...headlessSwitches,
    ...(options.sandbox ? [] : ['--no-sandbox']),
    '--disable-skia-runtime-opts',
    `--user-data-dir=${options.profileDir}`,
    '--remote-debugging-pipe',
    '--no-startup-window',
  ]
}
