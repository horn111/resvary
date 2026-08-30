# Release Publication

Resvary uses npm trusted publishing with staged approval. GitHub Actions never receives a long-lived npm token.

For each of `@resvary/sdk`, `@resvary/sqlite`, `@resvary/postgres`, `@resvary/circle`, `@resvary/worker`, and `create-resvary`, configure npm with:

- repository: `horn111/resvary`;
- workflow: `release.yml`;
- environment: `Production`;
- trust permission: allow `npm stage publish` only; do not allow direct `npm publish`.

In the GitHub `Production` environment, require reviewer `horn111`, allow the reviewer to approve their own deployment, and restrict deployment branches to `main`.

After all six trust relationships work, set package publishing access to require 2FA and disallow token publishing, then revoke the old `NPM_TOKEN` and remove it from GitHub Actions secrets.

The workflow has three modes and always checks out the exact `release_sha` from `main`:

1. `dry_run` runs release gates, packs one immutable archive set, verifies SHA-256, and installs the archives outside the monorepo.
2. `stage` requires the `Production` environment, obtains short-lived npm credentials through OIDC, and submits the checked archives with `latest` as their immutable staged tag. Public `latest` remains unchanged until approval.
3. Approve staged packages with 2FA in dependency order: SDK; SQLite, PostgreSQL, and Circle; Worker; `create-resvary`.
4. `finalize` verifies all six public versions, `latest`, `alpha`, absence of `next`, `gitHead`, provenance, clean installs, exports, CLIs, and starters. It then creates the annotated Git tag and stable GitHub Release.

If a problem appears before approval, reject every staged package. If any package has already been approved, do not reuse that version. Complete the correction as the next patch release. For a critical partial publication, restore every changed `latest` tag to the previous synchronized release before preparing the patch.
