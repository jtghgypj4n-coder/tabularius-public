# Contributing

See [the contributing guide](../CONTRIBUTING.md) for setup and pull request rules.

## Before you push

Run `npm run precheck`. Push only when its final line says `precheck: PASS`, and include that line in the pull request description. If a failure cannot be fixed, start the PR title with `[precheck failing]` and explain why. The opt-in pre-push hook runs `npm run precheck -- --quick`; `git push --no-verify` skips the hook.
