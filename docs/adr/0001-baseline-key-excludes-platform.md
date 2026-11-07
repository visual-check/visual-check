# Baselines are keyed by story, mode and browser only

A baseline's key is its story ID, mode and browser. Platform (OS and CPU architecture), Docker image digest, Playwright version and browser version are left out. [Render parity measurement](https://github.com/visual-check/visual-check/issues/18) found that arm64 and amd64 render differently, but a platform key would mean one set of baselines per platform, doubling both storage and updates. A digest or version key would invalidate every baseline on each Playwright bump, even when pixels are identical. Users get parity another way: force `--platform` so local runs and CI render alike, or set a tolerance that absorbs the difference.

## Consequences

- File names are `<story-id>[.<mode>][.<browser>].png`. The configured default browser (`browser`, Chromium unless set) never carries a browser segment, and each of `extraBrowsers` always does, so adding a browser renames nothing. The default capture carries no mode segment.
- Changing the key later renames every baseline in every user's repo.
- A baseline written on another platform shows up as a visual diff, not as a missing baseline.
