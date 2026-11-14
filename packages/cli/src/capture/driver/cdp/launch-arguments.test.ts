import { describe, expect, it } from 'vitest'
import { launchArguments } from './launch-arguments.js'

describe('launchArguments', () => {
  it("lists Playwright's switches, headless mode, no sandbox, visual-check's own switch and the pipe, in order", () => {
    expect(launchArguments({ sandbox: false, profileDir: '/profile' })).toEqual([
      '--disable-field-trial-config',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-back-forward-cache',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-component-update',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-edgeupdater',
      '--disable-extensions',
      '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,AvoidCorsURLLoaderRestartOnRedirect,TcpPortRandomizationWin,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,PreconnectToSearch,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion',
      '--enable-features=CDPScreenshotNewSurface,SkipListAccountsWithoutGaiaCookies',
      '--allow-pre-commit-input',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-updater-scheduler',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--no-first-run',
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-service-autorun',
      '--disable-search-engine-choice-screen',
      '--unsafely-disable-devtools-self-xss-warnings',
      '--enable-unsafe-swiftshader',
      '--edge-skip-compat-layer-relaunch',
      '--disable-stack-profiler',
      '--disable-infobars',
      '--disable-sync',
      '--do-not-de-elevate',
      '--headless',
      '--hide-scrollbars',
      '--mute-audio',
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
      '--no-sandbox',
      '--disable-skia-runtime-opts',
      '--user-data-dir=/profile',
      '--remote-debugging-pipe',
      '--no-startup-window',
    ])
  })

  it('leaves out --no-sandbox when the sandbox is on, and keeps --disable-skia-runtime-opts', () => {
    const browserArguments = launchArguments({ sandbox: true, profileDir: '/profile' })

    expect(browserArguments).not.toContain('--no-sandbox')
    expect(browserArguments).toContain('--disable-skia-runtime-opts')
    expect(browserArguments).toHaveLength(launchArguments({ sandbox: false, profileDir: '/profile' }).length - 1)
  })

  it("sends every request through the proxy, loopback included, after visual-check's own switch", () => {
    const browserArguments = launchArguments({
      sandbox: false,
      profileDir: '/profile',
      proxyServer: 'socks5://host.docker.internal:40123',
    })

    expect(browserArguments.slice(-6)).toEqual([
      '--disable-skia-runtime-opts',
      '--proxy-server=socks5://host.docker.internal:40123',
      '--proxy-bypass-list=<-loopback>',
      '--user-data-dir=/profile',
      '--remote-debugging-pipe',
      '--no-startup-window',
    ])
    expect(browserArguments).toHaveLength(launchArguments({ sandbox: false, profileDir: '/profile' }).length + 2)
  })
})
