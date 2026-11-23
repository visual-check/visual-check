import { brokenImageTimeLimitMs, type CaptureSettings } from '../capture/capture-session.js'
import type { ResolvedConfig } from '../config/resolve-config.js'

/**
 * Builds the session's settings from the config. `listHosts` says whether each capture also lists the hosts its story
 * reaches, which only `update` asks for.
 */
export function captureSettingsOf(
  config: Pick<ResolvedConfig, 'readyTimeout' | 'timezone' | 'locale' | 'colorScheme' | 'maskColor'>,
  listHosts: boolean,
): CaptureSettings {
  return {
    readyTimeoutMs: config.readyTimeout,
    timezone: config.timezone,
    locale: config.locale,
    colorScheme: config.colorScheme,
    maskColor: config.maskColor,
    listHosts,
    brokenImageTimeLimitMs,
  }
}
