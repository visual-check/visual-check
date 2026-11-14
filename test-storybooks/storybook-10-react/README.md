# @visual-check/test-storybook-10-react

One of this repo's own test Storybooks ([PRD 18](../../docs/prd/18-repo-ci.md#this-repos-own-test-storybooks)): a private React Storybook on Storybook 10 with a few plain stories, their committed baselines in `.visual-check/baselines/` and the expected outcome of every story in `expected-outcomes.json`.

`e2e.ts` is its end-to-end check. It serves the static build on `127.0.0.1`, runs the built CLI against it and checks five cases. Inside visual-check's image the last is replaced, and on the host other cases run; see below.

- `test` against the committed baselines, with 2 workers, gives exactly the expected outcomes.
- `update` into an empty folder writes every story that isn't broken, `test` then passes them, and the baselines of the stories expected to pass are byte-identical to the committed ones. When they aren't, the written baselines are copied to `e2e-output/`. Both commands take 2 workers from the config.
- With 1 worker, the two storage stories run one after the other on the same page and both pass. Each checks that visual-check's markers aren't in cookies, `localStorage`, `sessionStorage` or IndexedDB, then writes them and checks they stuck, so the second fails when storage isn't cleared between captures. A broken storage story's line gives only Storybook's generic status: the stores it found are named in the error it throws in its page, which the CLI doesn't print. Opening the story in an ordinary browser won't show them, because nothing clears storage there, so every store holds the marker from the second visit on.
- A stylesheet that changes the card story makes `test` exit 1 with that story differing.
- Killing the CLI while it captures leaves none of its containers behind.

The last two run with the default `workers`, `'auto'`.

## Running the end-to-end check

Until the browser image is published, every run names a locally built image through `TEST_STORYBOOK_IMAGE`. From the repo root:

```sh
packages/chromium/image/build.sh amd64 --output type=docker,name=visual-check-chromium:amd64
TEST_STORYBOOK_IMAGE=visual-check-chromium:amd64 pnpm turbo run e2e --filter @visual-check/test-storybook-10-react
```

Turbo builds the CLI and the Storybook first. The check prints one line per case, then each of its problems, and exits 1 when any case fails.

## Running it inside visual-check's image

`--inside-image` runs the check the way a job container on visual-check's image would: the CLI starts the browser itself, with no Docker. It needs the image's marker (`/etc/visual-check/chromium.json`) and no `docker` on the `PATH`, and it doesn't need `TEST_STORYBOOK_IMAGE`. It runs the first four cases above, then these two in place of the kill case:

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

## Running it on the host

`--host` checks `platform: 'host'` on your machine, in place of all the cases above. It needs no `TEST_STORYBOOK_IMAGE` and no Docker. Two cases capture `card--default` against baselines the run writes, since the committed ones need the image's fonts:

- With an empty cache, `update` (with `CI` unset) downloads the headless shell, says so, writes the baseline, and leaves the cache's marker for this machine's build.
- `test` then downloads nothing and passes.

The cache is `VISUAL_CHECK_CACHE_DIR` when set, which must name an empty or missing folder, else a temporary folder removed at the end. `--no-docker` adds a case for a machine with no `docker` on the `PATH`: with the default platform, `test` exits 2 with the no-Docker error before any capture.

```sh
pnpm turbo run e2e --filter @visual-check/test-storybook-10-react -- --host --no-docker
```

CI's "Ubuntu host" job runs `--host` where Chromium's sandbox can't start, so the CLI relaunches without it. "macOS without Docker" runs `--host --no-docker`.

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
