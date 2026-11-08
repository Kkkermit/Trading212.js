# Releasing

How `@kkkermit/trading212.js` gets to npm and GitHub Packages, and the documentation to GitHub Pages. Releases run
through [Changesets](https://github.com/changesets/changesets) and `.github/workflows/release.yml`, which publishes to
npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored anywhere, and
with provenance, so npm shows which workflow run built each version.

## Releasing a version

1. In the pull request that changes something users will notice, run `npm run changeset`, pick the bump (patch,
   minor or major) and write one sentence for the changelog. Commit the file it writes.
2. Merge the pull request. The release workflow opens, or updates, a pull request called
   _chore: Release a new version_, which sets the version and writes `CHANGELOG.md`.
3. Merge that pull request when you want to release. The workflow then, in one run:
   - runs `npm run check` and publishes the version to npm, with provenance;
   - tags it `v<version>` and writes a GitHub release from the changelog;
   - copies it to GitHub Packages.

GitHub does not run CI on a pull request a workflow opened, so the release pull request shows no checks. That is
expected: the publish step runs the whole check itself before anything is sent.

While the version is 0.x, a minor bump may break things, as the API itself is in beta.

## Retrying a release

If the publish fails, fix the cause, then open **Actions > Release > Run workflow** on `main`. The run publishes the
version in `package.json` if npm does not have it yet, and skips any step that is already done, so it is always safe
to run again.

## If something goes wrong

- **The publish step fails with `E404 Not Found - PUT`.** npm did not accept the workflow as a trusted publisher, so
  it treated the upload as anonymous. The log says why on a line starting `npm verbose oidc`. Check the trusted
  publisher on npmjs.com (the package's **Settings > Trusted publishing**) against this table; every field is
  case-sensitive:

  | Field             | Value           |
  | ----------------- | --------------- |
  | Organisation/user | `Kkkermit`      |
  | Repository        | `Trading212.js` |
  | Workflow filename | `release.yml`   |
  | Environment       | empty           |

  It also fails if the npm in the workflow is older than 11.5.1, which the workflow prevents by installing npm 11.

- **Provenance fails with "repository visibility: private".** The repository must be public.
- **The GitHub Packages step fails with 403.** The job needs `packages: write`, which `release.yml` grants, and the
  package must be linked to this repository: open it from the repository's **Packages** list and, under **Package
  settings > Manage Actions access**, add `Trading212.js` with write access. GitHub may also make a new package
  private; set it to public there.
- **A version went out without its code.** npm's list of tarball contents shows only `README.md`, `LICENSE`,
  `CHANGELOG.md` and `package.json`, and warns "No bin file found at dist/cli.js". This is what happened to 0.1.0, which
  was published by hand from a checkout with no `dist/`. The `prepack` script now builds `dist/` before every pack and
  publish. Release the next patch version, then deprecate the empty one as below.
- **A bad version went out.** Run `npm deprecate @kkkermit/trading212.js@<version> "<why, and what to use>"` and
  release a fix. npm only allows unpublishing within 72 hours, and a version number can never be reused.

## Checking a release

- `npm view @kkkermit/trading212.js version dist.fileCount` shows the newest version and how many files it holds,
  about 20 for a good one.
- The package page on npmjs.com shows a provenance badge linking to the workflow run that built it.
- `npm install @kkkermit/trading212.js` in an empty project, then the
  [getting started](https://kkkermit.github.io/Trading212.js/getting-started/) steps, is the check a user would make.

## Before publishing, try the package locally

```sh
npm pack
cd ../some-project && npm install ../Trading212.js/kkkermit-trading212.js-<version>.tgz
```

`npm pack` builds first, and `npm pack --dry-run` lists exactly what would be published: `dist/`, `README.md`,
`LICENSE` and `CHANGELOG.md`.

## Set up once (already done for this package)

- **The npm scope:** the npm account `kkkermit`, with two-factor authentication on.
- **The first version:** npm cannot set up trusted publishing for a package that does not exist yet, so 0.1.0 was
  published by hand with `npm publish --provenance=false`. Every version since is published by the workflow.
- **The trusted publisher** on npmjs.com, as in the table above, with **Publishing access** set to require
  two-factor authentication and disallow tokens, so the workflow is the only way to publish.
- **A public repository:** npm records provenance only for a public source repository, and GitHub Pages is free
  only for public repositories.
- **Actions may open pull requests:** **Settings > Actions > General > Workflow permissions**, with _Allow GitHub
  Actions to create and approve pull requests_ ticked.
- **Pages from Actions:** **Settings > Pages > Source: GitHub Actions**. The docs workflow publishes the site to
  <https://kkkermit.github.io/Trading212.js/> whenever `docs/` changes on `main`.
