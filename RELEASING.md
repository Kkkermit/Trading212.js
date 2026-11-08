# Releasing

How `@kkkermit/trading212.js` gets to npm and GitHub Packages, and the documentation to GitHub Pages. Releases run
through [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml`, which publishes to
npm with trusted publishing, so no npm token is stored anywhere. npm cannot set up trusted publishing for a package
that does not exist yet, so the first release is published by hand, once.

npm is where users install from. Each version on npm is then copied to
[GitHub Packages](https://github.com/Kkkermit/Trading212.js/packages) with the workflow's own `GITHUB_TOKEN`, so the
package shows on the repository page. Installing from GitHub Packages needs a GitHub token even for a public package,
so the docs point everyone at npm.

## Once, before the first release

1. **The npm scope.** The package is published as `@kkkermit/trading212.js`, so you need the `kkkermit` scope: either
   an npm account called `kkkermit`, or a free npm organisation of that name that your account belongs to. Turn on
   two-factor authentication for the account. `npm view @kkkermit/trading212.js` answering 404 means the name is free.
   GitHub Packages needs the same scope, because it only accepts the name of the GitHub account that owns the
   repository, and the release workflow already has the permission it needs there.
2. **Make the repository public.** npm only records provenance for a public source repository, and GitHub Pages is
   free only for public repositories. Dependency review and CodeQL also need a public repository, or GitHub Advanced
   Security; until then CI skips them with a note rather than failing.
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
   `publishConfig`. `npm publish` builds `dist/` first (the `prepack` script), so the package always holds the code;
   check that npm's list of tarball contents includes `dist/` before you confirm.

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

3. Merge the release pull request. The workflow sees the version is already on npm and publishes nothing there, then
   copies it to GitHub Packages.

   GitHub may make a new package private. Open it from the repository's **Packages** list, and under **Package
   settings** check its visibility is public and that it is linked to `Trading212.js`.

4. Tag the release: `git checkout main && git pull && git tag v0.1.0 && git push origin v0.1.0`.

## Every release after that

1. In the pull request that changes something users will notice, run `npm run changeset`, pick the bump (patch,
   minor or major) and write one sentence for the changelog. Commit the file it writes.
2. Merge the pull request. The release workflow opens, or updates, the _chore: Release a new version_ pull request.
3. Merge that when you want to release. The workflow runs `npm run check`, publishes to npm with provenance through
   trusted publishing, tags the release, and copies the version to GitHub Packages.

While the version is 0.x, a minor bump may break things, as the API itself is in beta.

## Checking a release

- `npm view @kkkermit/trading212.js` shows the published versions.
- The package page on npmjs.com shows a provenance badge linking to the workflow run that built it.
- `npm install @kkkermit/trading212.js` in an empty project, then the
  [getting started](https://kkkermit.github.io/Trading212.js/getting-started/) steps, is the check a user would make.

## Before publishing, try the package locally

```sh
npm run build && npm pack
cd ../some-project && npm install ../Trading212.js/kkkermit-trading212.js-0.1.0.tgz
```

`npm pack --dry-run` lists exactly what would be published: `dist/`, `README.md`, `LICENSE` and `CHANGELOG.md`.

## If something goes wrong

- **The workflow fails with 404 or "not found" when publishing.** The trusted publisher is missing or its fields do
  not match exactly, or npm is older than 11.5.1; the workflow installs npm 11 for this reason.
- **Provenance fails with "repository visibility: private".** The repository is still private.
- **The GitHub Packages step fails with 403.** The job needs `packages: write`, which `release.yml` grants, and the
  package must be linked to this repository. A package first published from somewhere else needs this repository
  added under **Package settings > Manage Actions access**.
- **A version went out without its code.** npm's tarball list shows only `README.md`, `LICENSE`, `CHANGELOG.md`
  and `package.json`, and warns "No bin file found at dist/cli.js". This is what happened to 0.1.0, from a checkout
  with no `dist/`; the `prepack` script now builds it on every publish. Release the next patch version, then
  deprecate the empty one as below.
- **A bad version went out.** Run `npm deprecate @kkkermit/trading212.js@<version> "<why, and what to use>"` and
  release a fix. npm only allows unpublishing within 72 hours, and a version number can never be reused.
