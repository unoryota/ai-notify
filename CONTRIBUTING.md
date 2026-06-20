# Contributing to ai-notify

Thanks for helping out! Issues and PRs are welcome from anyone.

## Quick start

```sh
git clone https://github.com/unoryota/ai-notify
cd ai-notify
node --test          # run the test suite
node src/cli.mjs doctor
```

No build step, no dependencies — it's plain Node ESM.

## Adding support for a new agent

This is the most valuable kind of contribution. Each agent is one self-contained
file in [`src/providers/`](src/providers/) exporting this interface:

```js
export const id = 'myagent';          // short, kebab-case
export const displayName = 'My Agent';
export const detect = () => /* boolean: is this agent installed? */;
export const status = () => ({ installed, wired });
export const wire = ({ node, cliPath, dryRun }) => ({ changed, detail, file });
export const unwire = ({ dryRun }) => ({ changed, detail, file });
```

- `wire` registers a hook that runs `"<node> <cliPath> hook --source myagent"`.
- Make `wire`/`unwire` **idempotent** and **non-destructive**: never overwrite a
  user's pre-existing config; detect your own entries with the shared `MARKER`.
- Register the module in [`src/providers/index.mjs`](src/providers/index.mjs).
- Add a test in [`test/`](test/).

See [`claude.mjs`](src/providers/claude.mjs) (JSON settings) and
[`codex.mjs`](src/providers/codex.mjs) (TOML) for the two common shapes.

## Adding a notifier backend

Sound / speech / banner live in [`src/notify.mjs`](src/notify.mjs). New backends
(e.g. ntfy, Pushover, Slack webhooks for "route to phone") should be best-effort
and degrade silently when their tool/credentials are absent.

## Pull requests

- Keep PRs focused. Update tests and docs.
- We use the **Developer Certificate of Origin (DCO)**. Sign off your commits:
  ```sh
  git commit -s -m "your message"
  ```
  This adds a `Signed-off-by:` line certifying you wrote the patch and can submit
  it under the project's MIT license. No CLA, no paperwork.
- CI runs `node --test` and a privacy scrub (`npm run scrub`). Both must pass.

## Reporting bugs

Open an issue with your OS, Node version, the agent(s) involved, and the output
of `ai-notify doctor`.
