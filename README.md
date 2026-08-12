# Phylax Security (GitHub Action)

Verify what your build pulls in, and fail the job before a risky artifact ships.

The action reads your lockfiles, verifies every pinned dependency against Phylax, writes a SARIF report for GitHub code scanning, and sets the job status from the strictest verdict. It is the same verification the CLI and the runtime gate perform, wired into a workflow.

## Install

```yaml
- uses: praxi-labs/phylax-action@v1
  with:
    api-token: ${{ secrets.PHYLAX_API_TOKEN }}
```

## Usage

<details open>
<summary><b>Verify dependencies on every pull request</b></summary>

```yaml
name: Verify artifacts with Phylax

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  security-events: write

jobs:
  phylax:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: praxi-labs/phylax-action@v1
        with:
          api-token: ${{ secrets.PHYLAX_API_TOKEN }}
          artifact-path: .
          fail-on: block
          format: sarif

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: phylax.sarif
```

Two lines in that workflow are doing more work than they look.

`permissions: security-events: write` is required by `upload-sarif`. Repositories that default `GITHUB_TOKEN` to read only will fail the upload with a 403 without it.

`if: always()` on the upload matters because `fail-on: block` fails the verification step. Without it the upload never runs, and you lose the findings in exactly the case you wanted to read them.

</details>

<details>
<summary><b>Verify specific artifacts instead of scanning a path</b></summary>

```yaml
- uses: praxi-labs/phylax-action@v1
  with:
    api-token: ${{ secrets.PHYLAX_API_TOKEN }}
    artifacts: pkg:npm/express@4.18.2, pkg:pypi/requests@2.32.3
```

</details>

<details>
<summary><b>Gate a release on your own policy</b></summary>

```yaml
- uses: praxi-labs/phylax-action@v1
  with:
    api-token: ${{ secrets.PHYLAX_API_TOKEN }}
    policy: prod-runtime-policy
    fail-on: warn
```

</details>

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `api-token` | required | Phylax API token. Store it as a secret. |
| `artifact-path` | `.` | Directory or lockfile to scan. |
| `artifacts` | none | Comma separated package URLs, instead of scanning. |
| `policy` | none | Named policy. Omit for the organization default. |
| `fail-on` | `block` | `block`, `warn` or `never`. |
| `format` | `sarif` | `sarif`, `json` or `none`. |
| `output` | `phylax.sarif` | Report path. |
| `base-url` | `https://api.phyi.dev` | |

## Outputs

| Output | Description |
| --- | --- |
| `verdict` | Strictest verdict across all artifacts. |
| `blocked-count` | Artifacts that returned BLOCK. |
| `warned-count` | Artifacts that returned WARN. |
| `report-path` | Path to the written report. |

## Supported manifests

`package-lock.json`, `npm-shrinkwrap.json` and `requirements.txt`. Lockfiles are used rather than manifests, because a manifest records ranges and a lockfile records what will actually install.

## Choosing what blocks

Blocking on everything is how a security check ends up disabled. New advisories land daily against dependencies you did not change, so a pipeline that fails on every finding fails on days when nothing about your code moved.

Start with `fail-on: block` and a policy that blocks only what is never a false alarm: a leaked secret, a malicious package, a failed provenance check. Let a new advisory in an unchanged dependency come through as `WARN` and track the trend. Tighten once your baseline is clean.

## Pull requests from forks

GitHub does not pass secrets to workflows triggered by `pull_request` from a fork, so `secrets.PHYLAX_API_TOKEN` arrives empty and the step fails. Outside contributions are exactly the pull requests you most want verified.

Verify forks in a separate workflow triggered by `pull_request_target`, which does receive secrets, and check out the base commit rather than the fork head. Never check out fork code under `pull_request_target`: it runs with write permissions and access to secrets.

## Development

<details>
<summary>Contributor commands</summary>

```sh
npm install
npm run typecheck
npm test
npm run package
```

`dist/` is committed, because a JavaScript action runs the bundle directly from the repository. Run `npm run package` and commit the result with any source change.

</details>

## License

MIT
