# @visual-check/test-storybook-10-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 10 with a few plain stories and a set of [hazard stories](#the-hazard-stories), their committed baselines in `.visual-check/baselines/` and the expected outcome of every story in `expected-outcomes.json`.

`e2e.ts` is its end-to-end check. It serves the static build on `127.0.0.1`, runs the built CLI against it and checks six cases. Inside visual-check's image the last is replaced; see below.

- `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes.
- `update` into an empty folder writes every story that isn't broken, `test` then passes them and finds the broken ones missing, and the baselines of the stories expected to pass are byte-identical to the committed ones. When they aren't, the written baselines are copied to `e2e-output/`. Both commands take 2 workers from the config.
- With 1 worker, the two storage stories run one after the other on the same page and both pass. Each checks that visual-check's markers aren't in cookies, `localStorage`, `sessionStorage` or IndexedDB, then writes them and checks they stuck, so the second fails when storage isn't cleared between captures. A broken storage story's line gives only Storybook's generic status: the stores it found are named in the error it throws in its page, which the CLI doesn't print. Opening the story in an ordinary browser won't show them, because nothing clears storage there, so every store holds the marker from the second visit on.
- With 1 worker, the hazard stories run one after the other, and `test` gives exactly their expected outcomes. The story that navigates away says it went to `/categories/burgers`, and the server is asked for its page 3 times: once, then on each of its 2 retries. The story that crashes says its page crashed. The stories after `BeforeUnload` and `Crashes` pass: the first loads once the `beforeunload` dialog is accepted, the second on a fresh page.
- A stylesheet that changes the card story makes `test` exit 1 with that story differing.
- Killing the CLI while it captures leaves none of its containers behind.

The last two run with the default `workers`, `'auto'`.

## The hazard stories

`stories/hazards.stories.tsx` has one story for each thing a page can do that visual-check deals with itself. They're in this order, so that with 1 worker `BeforeUnload` and `Crashes` are each followed by a story that passes:

- `Alert`, `Confirm` and `Prompt` open their dialog as they render. visual-check accepts the alert and dismisses the other two, so the snapshots show `alert() returned`, `confirm() returned false` and `prompt() returned null`.
- `BeforeUnload` leaves a `beforeunload` handler that asks to stay, so the next story's `goto` on the same page opens a dialog. visual-check accepts it, so that story loads; dismissing it would cancel the navigation and break that story.
- `Popup` opens a popup in a loader, which visual-check closes. The loader waits until it's closed, so a popup left open breaks the story. The wait is in a loader because Storybook 10 reports a story whose `play` throws as a success.
- `Crashes` allocates in `play` until its page runs out of memory and its renderer crashes, within a few seconds. It's broken, `crashed`, and isn't retried; the next story gets a fresh page.
- `Download` clicks a download link, which visual-check denies. The page can't tell a denied download from an allowed one, so this only checks that a download doesn't hold up the capture.
- `Permissions` asks for the notification and geolocation permissions in a loader. visual-check denies both, so the snapshot shows `denied` and geolocation's `PERMISSION_DENIED` error.
- `SrcdocIframe` shows an iframe with a `srcdoc` document, which visual-check captures with the page. `play` waits for that document's own text, since the iframe's first, empty document is complete at once.
- `NavigatesAway` follows a link to `/categories/burgers` in `play`, then waits forever, so its page always leaves before Storybook reports it finished. It's broken, `navigated-away`, after 2 retries.

`test` captures only a story that has a baseline, so the two broken stories have one too, though `update` never writes a broken story's: each is the story as it renders without its `play`. `test` never gets as far as comparing it.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react
```

Turbo builds the CLI and the Storybook first. The check prints one line per case, then each of its problems, and exits 1 when any case fails.

## Running it inside visual-check's image

`--inside-image` runs the check the way a job container on visual-check's image would: the CLI starts the browser itself, with no Docker. It needs the image's marker (`/etc/visual-check/chromium.json`) and no `docker` on the `PATH`, and it doesn't need `TEST_STORYBOOK_IMAGE`. It runs the first five cases above, then these two in place of the kill case:

- With `platform: 'host'`, `test` uses the image's browser and gives exactly the expected outcomes.
- With `platform: 'linux/arm64'`, `test` exits 2 before any capture, and its message names the image's architecture and the configured platform.

The host case takes 2 workers from the config. The deliberate change runs with `'auto'`, which here reads the machine's own CPUs and memory, since no Docker is used.

Mount the repo and a Linux Node into the image, with no network so that nothing can be downloaded. Build the CLI and the Storybook first, as in the next section, and `$NODE_DIR` is a Linux amd64 Node installation (the committed baselines are linux/amd64, so only the amd64 image works):

```sh
docker run --rm --network none -e CI=true -v "$PWD:$PWD" -v "$NODE_DIR:/opt/node:ro" -w "$PWD/test-storybooks/storybook-10-react" \
  -e PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  visual-check-chromium:amd64 node e2e.ts --inside-image
```

CI's "Inside the image" job does this on every PR.

## Rewriting the baselines

Baselines must come from the default `linux/amd64` platform, the one CI renders on. Build the CLI and the Storybook:

```sh
pnpm turbo run build build-storybook --filter @visual-check/test-storybook-10-react...
```

Serve `storybook-static/` on `127.0.0.1` with any static server, then from this folder, with `CI` unset:

```sh
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm exec visual-check update --all --url http://127.0.0.1:<port>
```

Run `test` the same way to check them, update `expected-outcomes.json` when a story is added or its outcome changes, and commit both.

`update` leaves the baselines of the two broken hazard stories as they are. To rewrite one, take the story's `play` out, build the Storybook, run `update --filter` with the story's ID, then put `play` back and build again.
