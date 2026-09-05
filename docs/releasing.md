# Release Publication

Resvary uses npm trusted publishing with direct OIDC publication. GitHub Actions never receives a long-lived npm token, and one protected GitHub environment approval gates the entire synchronized release.

For each of `@resvary/sdk`, `@resvary/sqlite`, `@resvary/postgres`, `@resvary/circle`, `@resvary/worker`, and `create-resvary`, configure npm with:

- repository: `horn111/resvary`;
- workflow: `release.yml`;
- environment: `Production`;
- trust permission: allow direct `npm publish` only; disable `npm stage publish`.

In the GitHub `Production` environment, require reviewer `horn111`, allow the reviewer to approve their own deployment, and restrict deployment branches to `main`.

After all six trust relationships work, set package publishing access to require 2FA and disallow token publishing, then revoke the old `NPM_TOKEN` and remove it from GitHub Actions secrets.

The workflow has two modes and always checks out the exact `release_sha` from `main`:

1. `dry_run` runs release gates, packs one immutable archive set, verifies SHA-256, and installs the archives outside the monorepo.
2. `publish` waits for the single `Production` approval, obtains short-lived npm credentials through OIDC, and publishes the checked archives in dependency order: SDK; SQLite, PostgreSQL, and Circle; Worker; `create-resvary`. The same job verifies all six public versions, dist-tags, `gitHead`, provenance, clean installs, exports, CLIs, and starters. It then publishes the multi-architecture Operator Console image with SBOM and provenance, scans its immutable digest, and creates the annotated Git tag and GitHub Release.

A version containing a prerelease suffix, such as `1.0.0-rc.1`, is published to npm `next` and creates a GitHub prerelease. The existing stable `latest` tag stays unchanged. A stable version is published to `latest`; the workflow removes the synchronized `next` tags after publication. The historical `alpha` tag remains pinned.

Every root, application, and public package manifest must contain the requested version, and internal public-package dependencies plus generated starter templates must use that exact version. Prepare `1.0.0-rc.1` as its own version commit. Prepare `1.0.0` as a later GA commit after the RC fixes and compatibility freeze.

Direct npm publication is immutable and is not atomic across six packages. The workflow performs every build, test, browser test, Docker smoke test, image scan, archive, checksum, and local-install gate before the `Production` approval. A retry safely skips an already published package only when its `gitHead`, selected dist-tag, and provenance match the release commit, then continues the remaining dependency levels. A mismatch stops the workflow.

If a defect is found after the first package is public, do not reuse that version. Fix it in the next patch release. If a transient registry or network failure causes a partial publication, rerun the same `publish` workflow with the same version and `release_sha` so it can complete the matching package set.
