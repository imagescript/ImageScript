# Contributing to ImageScript

Thanks for helping. Bug reports, fixes, and improvements to the documentation are all welcome.

## Questions, bugs and ideas

- **Questions about using ImageScript:** [GitHub Discussions](https://github.com/imagescript/ImageScript/discussions) or the
  [Discord server](https://discord.gg/8hPrwAH).
- **A bug:** open an [issue](https://github.com/imagescript/ImageScript/issues/new/choose). A short script and the file that
  shows the problem help most.
- **A feature or a bigger change:** open an issue first, so we can agree on the shape of the API before you spend time on it.
- **A security problem:** please don't open an issue, see the [security policy](SECURITY.md).

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Setting up

You need Node.js 22.13 or newer. Deno and Bun are used by the CI and are optional locally.

```sh
git clone https://github.com/imagescript/ImageScript.git
cd ImageScript
npm install
npm run build        # compiles src/ to dist/, which the tests import
node tests/crop.js   # one test file
npm test             # build and run every test file
npm run lint
npm run typecheck
npm run docs         # the API documentation, must build without warnings
```

`master` is the 4.0 line, `v3` takes fixes for 3.x. Open pull requests against `master` (or `v3` for a 3.x fix).

## Tests

Every behavior change comes with a test, and a fix comes with a test that fails without it.

- Tests are plain scripts in `tests/` (`tests/<area>.js`) that exit with a non-zero status when something is wrong.
  `tests/run.js` runs every file with Node, Deno or Bun, so a test must work on all three.
- Keep a file's run time well under a minute: the CI runs it on several platforms and under coverage with a limit of two
  minutes a file. Split long cases into a file of their own.
- Fixtures go in `tests/`; keep them small, and put the licence of files that aren't ours next to them (like `tests/pngsuite/LICENSE`).
- Output that must stay identical (an encoder's bytes, a rendered pixel) is compared against a stored file or hash.

## Code

- ImageScript is TypeScript without runtime dependencies, WebAssembly or native code. Code in `src/` runs in Node.js, Deno,
  Bun, browsers and edge runtimes.
- The public API is documented with TSDoc: parameters, `@throws`, `@defaultValue`, and an `@example` where it helps.
  The documentation is generated from it (`npm run docs`).
- Methods that take options take an object and check its type. An option that doesn't exist is ignored on purpose.
- Errors say what they got: `width must be 1-2147483647, not 0`. A wrong type is a `TypeError`, a value out of range a
  `RangeError`, a limit that is reached a `LimitError`.
- Anything derived from other code keeps its licence: add the project to
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), put the licence in `licenses/` and say so in the file's header.

## Changes and pull requests

- Add user-visible changes to [CHANGELOG.md](CHANGELOG.md) under the upcoming version.
- Short commit messages that say what changed. Several small commits are fine, no need to squash.
- Say in the pull request what changed and why, and how you tested it. A draft pull request is fine for early feedback.
- The CI has to pass: the tests on Node.js (several versions and platforms), Deno and Bun, the edge runtimes and a browser, lint, and the coverage run.
