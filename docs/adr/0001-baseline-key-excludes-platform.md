# Baselines are keyed by story, mode and browser only

A baseline's key is its story ID, mode and browser. Platform (OS and CPU architecture), Docker image digest and browser version are left out. [Render parity measurement](https://github.com/visual-check/visual-check/issues/18) found that arm64 and amd64 render differently, but a platform key would mean one set of baselines per platform, doubling both storage and updates. A digest or version key would invalidate every baseline on each browser bump, even when pixels are identical. Users get parity another way: force `--platform` so local runs and CI render alike, or set a tolerance that absorbs the difference.

## Consequences

- File names are `<story-id>[.<mode>][.<browser>].png`. Chromium, v1's only browser, never carries a browser segment. A browser added later always does, so adding one renames nothing, and `chromium`, `webkit` and `firefox` can't be mode names. The default capture carries no mode segment.
- Changing the key later renames every baseline in every user's repo.
- A baseline written on another platform or by another browser build shows up as a visual diff, not as a missing baseline.
