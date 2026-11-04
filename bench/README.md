# ImageScript benchmark

How [ImageScript](https://github.com/imagescript/ImageScript) compares to other image libraries for Node.js: speed, file
sizes and what installing each takes. ImageScript is plain JavaScript with no dependencies, so it runs wherever
JavaScript does, like Jimp, image-js and PureJsImage; sharp and @napi-rs/canvas wrap native libraries (libvips, Skia),
Photon is WebAssembly, and so is jsquash (Squoosh's libavif and libjxl, for AVIF and JPEG XL).

<img src="charts/overview-portable.svg" alt="Time per operation of the libraries that run everywhere, colored by the distance to the fastest">

<img src="charts/vs-javascript.svg" alt="ImageScript's speed compared to the fastest other pure JavaScript library">

<img src="charts/overview-native.svg" alt="Time per operation of ImageScript and the native libraries">

<img src="charts/install.svg" alt="Install size of each library">

<img src="charts/codecs.svg" alt="Decoding and encoding speed">

<img src="charts/modern.svg" alt="AVIF and JPEG XL decoding and encoding speed">

<img src="charts/operations.svg" alt="Speed of image operations">

<img src="charts/rendering.svg" alt="Text and SVG rendering speed">

<img src="charts/animation.svg" alt="Animated GIF decoding and encoding speed">

<img src="charts/sizes-lossless.svg" alt="Lossless file sizes">

<img src="charts/sizes-lossy.svg" alt="Lossy file sizes with their quality">

## Numbers

Time per operation (less is faster), measured 2026-11-04 with Node.js v24.22.2 on Intel(R) Xeon(R) 6975P-C, ImageScript 3.14.0.

| | **ImageScript 3** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| decode JPEG | **55 ms** | 127 ms | 143 ms | 103 ms | 34 ms | 13 ms | – | 15 ms |
| decode PNG | **28 ms** | 47 ms | 107 ms | 71 ms | 22 ms | 19 ms | – | 17 ms |
| decode WebP (lossy) | **67 ms** | – | – | 83 ms | 65 ms | 26 ms | – | 13 ms |
| encode JPEG (quality 80) | **45 ms** | 279 ms | 90 ms | 105 ms | 89 ms | 15 ms | – | 22 ms |
| encode PNG | **144 ms** | 200 ms | 299 ms | 477 ms | 79 ms | 112 ms | – | 388 ms |
| encode WebP (lossless) | **1.1 s** | – | – | 2.1 s | 33 ms | 1.2 s | – | 379 ms |
| decode AVIF | **184 ms** | – | – | 1.4 s | – | 68 ms | 169 ms | 51 ms |
| decode JPEG XL | **348 ms** | – | – | fails | – | – | 303 ms | 48 ms |
| encode AVIF (quality 60) | **3.7 s** | – | – | 988 ms | – | 1.9 s | 1.8 s | – |
| encode JPEG XL (quality 90) | **1.6 s** | – | – | – | – | – | 3.2 s | – |
| resize to half | **11 ms** | 11 ms | 72 ms | 52 ms | 38 ms | 7.6 ms | – | 2.2 ms |
| rotate by 30° | **41 ms** | 436 ms | 615 ms | 421 ms | 186 ms | 33 ms | – | 25 ms |
| blur (radius 5) | **54 ms** | 57 s | 541 ms | – | 135 ms | 13 ms | – | 18 ms |
| composite an overlay | **2.0 ms** | 22 ms | 8.3 ms | – | 5.0 ms | 4.1 ms | – | 2.4 ms |
| crop | **1.3 ms** | 14 ms | 15 ms | 8.8 ms | 3.5 ms | 0.73 ms | – | 0.71 ms |
| clone | **1.0 ms** | 1.9 ms | 1.6 ms | 1.1 ms | 2.5 ms | 1.1 ms | – | 2.3 ms |
| render text | **0.42 ms** | – | – | – | – | 0.51 ms | – | 0.25 ms |
| render SVG | **130 ms** | – | – | – | – | 30 ms | – | 9.8 ms |
| decode animated GIF | **53 ms** | – | – | – | – | 57 ms | – | – |
| encode animated GIF | **191 ms** | – | – | – | – | 877 ms | – | – |

Encoded sizes:

| | **ImageScript 3** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| photo PNG | 2.0 MB | 2.7 MB | 2.8 MB | 2.1 MB | 2.8 MB | 2.8 MB | – | 2.1 MB |
| photo JPEG | 218 kB, 40.6 dB | 260 kB, 40.9 dB | 260 kB, 40.9 dB | 222 kB, 40.5 dB | 257 kB, 40.4 dB | 218 kB, 40.6 dB | – | 218 kB, 40.6 dB |
| photo WebP | 1.3 MB | – | – | 2.1 MB | 1.7 MB | 1.2 MB | – | 1.4 MB |
| graphic PNG | 795 kB | 2.0 MB | 736 kB | 811 kB | 2.2 MB | 718 kB | – | 1.0 MB |
| graphic JPEG | 276 kB, 37.3 dB | 315 kB, 37.4 dB | 315 kB, 37.4 dB | 286 kB, 37.3 dB | 314 kB, 37.4 dB | 275 kB, 37.3 dB | – | 276 kB, 37.3 dB |
| graphic WebP | 277 kB | – | – | 758 kB | 856 kB | 239 kB | – | 631 kB |
| animation GIF | 825 kB, identical pixels | – | – | – | – | 720 kB, 45.6 dB | – | – |
| photo AVIF | 93 kB, 40.9 dB | – | – | 992 kB, 32.7 dB | – | 91 kB, 40.6 dB | 80 kB, 40.2 dB | – |
| photo JPEG XL | 245 kB, 44.5 dB | – | – | – | – | – | 230 kB, 44.1 dB | – |
| graphic AVIF | 147 kB, 41 dB | – | – | 709 kB, 38.5 dB | – | 114 kB, 38.7 dB | 136 kB, 40.5 dB | – |
| graphic JPEG XL | 230 kB, 43.4 dB | – | – | – | – | – | 194 kB, 41.9 dB | – |

| | **ImageScript 3** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|---|---|---|---|---|---|---|---|
| kind | JavaScript | JavaScript | JavaScript | JavaScript | WebAssembly | native (libvips) | WebAssembly | native (Skia) |
| package | `imagescript@3.14.0` | `jimp@1.6.1` | `image-js@1.7.1` | `purejsimage@0.17.0` | `@silvia-odwyer/photon-node@0.3.4` | `sharp@0.35.5` | `@jsquash/avif@2.1.1 @jsquash/jxl@1.3.0` | `@napi-rs/canvas@1.0.11` |
| install size | 2.4 MB | 26.8 MB | 47.8 MB | 6.7 MB | 2.3 MB | 20.3 MB | 14.2 MB | 35.0 MB |
| packages | 1 | 64 | 55 | 1 | 1 | 6 | 3 | 2 |

## Method

- Inputs (in `inputs/`, sources in [inputs/SOURCES.md](inputs/SOURCES.md)): a 1920×1080 photo (JPEG, and made from it
  when the benchmark starts, PNG, lossy WebP, AVIF by sharp (libaom) and JPEG XL by jsquash (libjxl, effort 7), both
  at the qualities below), a 1434×1434 graphic with transparency (PNG), a 445×445 diagram with transparency placed on
  the photo (PNG), a 300×300 GIF with 101 frames.
- AVIF and JPEG XL are encoded at the same nominal quality (60 and 90); as the libraries' scales differ,
  the file sizes come with their PSNR (of the color over black, decoded by libavif and libjxl). PureJsImage's AVIF
  encoder has no quality option, and its JPEG XL decoder doesn't support everything libjxl's files use, which shows as
  failing. jsquash only encodes and decodes AVIF and JPEG XL (it gets the other inputs as pixels); @napi-rs/canvas
  decodes both with Skia's codecs, but doesn't encode them.
- Rendering: "The quick brown fox jumps over the lazy dog, 0123456789" in Source Sans 3 at 64px, and `tests/svgs/features.svg` (gradients, clipping,
  CSS) at 1920 pixels wide. Jimp, image-js, PureJsImage and Photon can't render TrueType/OpenType fonts or SVGs;
  @napi-rs/canvas (Skia's SVG module) ignores its CSS, so it draws a little less.
- Every operation starts from the same decoded image and returns a new one: libraries that change images in place
  clone first, sharp runs a pipeline from raw pixels back to raw pixels, PureJsImage (which has no decoded images) one
  from a BMP back to a BMP, @napi-rs/canvas draws into a new canvas. PureJsImage has no blur, composite, rendering or
  animated GIFs.
- Where the library lets you choose, resizing is bilinear, blurring is
  gaussian with a radius or sigma of 5, rotating grows the image to fit. Each library uses its own defaults
  otherwise, e.g. its PNG compression level.
- Threads: ImageScript uses worker threads where they pay off (the processors available, at most 8), and sharp gets
  as many (`sharp.concurrency()`; its default on glibc Linux without jemalloc, like on CI, is one). The other
  libraries run on one thread (jsquash turns its threaded builds off in Node).
- [tinybench](https://github.com/tinylibs/tinybench), at least 1.5 seconds and 3 runs per measurement, every library
  in its own process.
- The release workflow runs the benchmark for every release and commits the results, on a GitHub Actions runner;
  runners vary, so compare libraries within one run rather than between runs.
- Install sizes: `npm install <library>` in an empty project, the apparent size of `node_modules`.

Run it: `npm install` in this directory, then `node run.js` (on an idle machine; `IMAGESCRIPT=local` measures
this checkout after `npm run build` instead of the version from npm), `node installs.js` and `node report.js`.
