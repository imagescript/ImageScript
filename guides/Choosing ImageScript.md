# Choosing ImageScript

ImageScript decodes, edits and encodes images in TypeScript, with no WebAssembly, no native binaries and no
dependencies. This page says what that's good for, when another library is the better choice, and what you can rely on
when you depend on it.

## When it fits

- **Where native libraries can't run:** Cloudflare Workers, Vercel's Edge Runtime, Deno Deploy and browsers. There is
  nothing to compile, download at install time or match to the platform.
- **Where installs should stay small and simple:** one package of 2.6 MB on disk, no install scripts, the same files
  on every operating system and CPU.
- **Generated images:** social cards, badges, charts, certificates, stickers and memes. It renders text with real
  fonts (shaping, right-to-left scripts, color emoji) and SVGs, and composites them with blend modes.
- **Newer formats in plain JavaScript:** WebP, AVIF and JPEG XL, lossy and lossless, animated GIF, APNG and WebP, and
  HDR gain maps, all in both directions.

## When something else fits better

- **A busy Node.js server that only resizes photos:** [sharp](https://sharp.pixelplumbing.com) (libvips) is faster,
  about 4 times for JPEG decoding and encoding and for bicubic resizing in the
  [benchmark](https://github.com/imagescript/ImageScript/blob/master/bench/README.md), and it processes large images
  in pieces instead of holding them in memory. Use it where native modules install without trouble and throughput matters most.
- **Code written for the Canvas API:** [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) or the browser's own
  canvas. ImageScript has its own API, not a canvas drawing context.
- **Formats ImageScript doesn't read:** HEIC, RAW camera files, PDF, CCITT-compressed TIFF and arithmetic-coded JPEG.

## Where it's tested

Every change runs the full test suite on:

- Node.js 22.13, 24 and 26 on Linux, and Node.js 26 on macOS and Windows
- Deno and Bun
- Cloudflare's workerd (through Miniflare, with and without Node.js compatibility) and Vercel's Edge Runtime, bundled
  the way they are deployed
- Chromium, bundled by Vite, with and without worker threads

The decoders are ports of the reference implementations (libjpeg, libwebp, dav1d, libjxl and jxl-oxide; HarfBuzz for
text) and are compared with them: AVIF decodes exactly like dav1d, and WebP exactly like libwebp. Before major releases,
thousands of real-world files are decoded and compared with Pillow and the reference decoders, and the decoders are
fuzzed with damaged files.

## What you install

- No dependencies, and no install scripts.
- Published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements): npm
  shows which commit and workflow built each version. [JSR](https://jsr.io/@matmen/imagescript) gets each version
  from the same commit.
- MIT licensed. The code ported from other projects keeps its credits in the README.

## Untrusted input

ImageScript is meant to handle images uploaded by anyone:

- Decoding refuses images larger than 16383 × 16383 pixels by default (`maxPixels`), checked before the pixels are
  decoded, and throws a `LimitError` you can catch. Animations count all their frames.
- Cut-off files throw an error instead of returning an image padded with blank pixels. Damaged files either throw or
  are recovered the way the reference decoders recover them.
- SVG and text rendering have their own limits (elements, layers, referenced images), and SVGs never fetch files or
  URLs: images and fonts are only used when you pass them in.

Report security problems privately, not in public issues: see the
[security policy](https://github.com/imagescript/ImageScript/blob/master/SECURITY.md).

## Versions and support

ImageScript follows [semantic versioning](https://semver.org):

- **4.x makes no breaking changes.** Minor versions add features, patch versions fix bugs.
- **Deprecation comes before removal.** When an API is replaced, the old one keeps working and is marked
  `@deprecated` (your editor shows it struck through, with the replacement), and it's removed in the next major
  version at the earliest. The release before a major already contains every replacement, so you can upgrade step by
  step: see [Migrating to 4.0](<./Migrating to 4.0.md>).
- **The oldest supported Node.js version is only raised in a major version.** 4.x supports Node.js 22.13 and newer.
- **Pixels can change in minor versions** when output gets better (a more accurate resize, a smaller encoded file).
  Don't compare encoded files byte for byte across versions; compare decoded pixels with a tolerance.
