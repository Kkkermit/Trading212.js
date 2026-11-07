# Releasing

How `@kkermit/trading212.js` gets to npm, and the documentation to GitHub Pages. Releases run through
[Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml`, which publishes with npm
trusted publishing, so no npm token is stored anywhere. npm cannot set up trusted publishing for a package that does
not exist yet, so the first release is published by hand, once.

## Once, before the first release

1. **The npm scope.** The package is published as `@kkermit/trading212.js`, so you need the `kkermit` scope: either
   an npm account called `kkermit`, or a free npm organisation of that name that your account belongs to. Turn on
   two-factor authentication for the account. `npm view @kkermit/trading212.js` answering 404 means the name is free.
2. **Make the repository public.** npm only records provenance for a public source repository, and GitHub Pages is
   free only for public repositories.
3. **Let Actions open pull requests.** In the repository's **Settings > Actions > General**, under _Workflow
   permissions_, tick _Allow GitHub Actions to create and approve pull requests_. The release workflow needs it to
   open the version pull request.
4. **Turn on Pages.** In **Settings > Pages**, set _Source_ to _GitHub Actions_. The docs workflow publishes the
   site to <https://kkkermit.github.io/Trading212.js/> whenever `docs/` changes on `main`.
5. **Merge the work into `main`** through a pull request, with CI green.

## The first release, by hand

When `main` has a changeset waiting (`.changeset/first-release.md` is one), the release workflow opens a pull request
called _chore: Release a new version_ on the branch `changeset-release/main`. It sets the version (0.1.0 for the
first release) and writes `CHANGELOG.md`. **Do not merge it yet.**

1. Publish that version from your machine:

   ```sh
   git fetch origin
   git checkout changeset-release/main
   npm ci
   npm run check
   npm login
   npm publish --provenance=false
   ```

   `--provenance=false` is needed only here: provenance can be generated in GitHub Actions, not on a laptop, and a
   command-line flag overrides the `provenance: true` in `package.json`. The package is still public, from
   `publishConfig`.

2. On [npmjs.com](https://www.npmjs.com), open the package's **Settings**, and under **Trusted publishing** add a
   GitHub Actions publisher:

   | Field             | Value           |
   | ----------------- | --------------- |
   | Organisation/user | `Kkkermit`      |
   | Repository        | `Trading212.js` |
   | Workflow filename | `release.yml`   |
   | Environment       | leave it empty  |

   The fields are case-sensitive. Then, under **Publishing access**, choose to require two-factor authentication and
   disallow tokens, so the workflow is the only way to publish.

3. Merge the release pull request. The workflow sees the version is already on npm and publishes nothing.

4. Tag the release: `git checkout main && git pull && git tag v0.1.0 && git push origin v0.1.0`.

## Every release after that

1. In the pull request that changes something users will notice, run `npm run changeset`, pick the bump (patch,
   minor or major) and write one sentence for the changelog. Commit the file it writes.
2. Merge the pull request. The release workflow opens, or updates, the _chore: Release a new version_ pull request.
3. Merge that when you want to release. The workflow runs `npm run check`, publishes with provenance through trusted
   publishing, and tags the release.

While the version is 0.x, a minor bump may break things, as the API itself is in beta.

## Checking a release

- `npm view @kkermit/trading212.js` shows the published versions.
- The package page on npmjs.com shows a provenance badge linking to the workflow run that built it.
- `npm install @kkermit/trading212.js` in an empty project, then the
  [getting started](https://kkkermit.github.io/Trading212.js/getting-started/) steps, is the check a user would make.

## Before publishing, try the package locally

```sh
npm run build && npm pack
cd ../some-project && npm install ../Trading212.js/kkermit-trading212.js-0.1.0.tgz
```

`npm pack --dry-run` lists exactly what would be published: `dist/`, `README.md`, `LICENSE` and `CHANGELOG.md`.

## If something goes wrong

- **The workflow fails with 404 or "not found" when publishing.** The trusted publisher is missing or its fields do
  not match exactly, or npm is older than 11.5.1; the workflow installs npm 11 for this reason.
- **Provenance fails with "repository visibility: private".** The repository is still private.
- **A bad version went out.** Run `npm deprecate @kkermit/trading212.js@<version> "<why, and what to use>"` and
  release a fix. npm only allows unpublishing within 72 hours, and a version number can never be reused.
