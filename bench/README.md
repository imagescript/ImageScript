# ImageScript benchmark

This benchmark compares processing speed, output-file size and install size. Lower times and smaller files are better,
but compare lossy files alongside their quality scores. Results depend on the machine, so compare libraries within a
single run. The Method section explains the test inputs and measurements.

<img src="charts/overview-portable.svg" alt="Time per operation of the libraries that run everywhere, colored by the distance to the fastest">

<img src="charts/overview-native.svg" alt="Time per operation of ImageScript and the native libraries">

<img src="charts/install.svg" alt="Install size of each library">

<img src="charts/sizes-lossless.svg" alt="Lossless file sizes">

<img src="charts/sizes-lossy.svg" alt="Lossy file sizes with their quality">

## Numbers

Time per operation (less is faster), measured 2026-11-08 with Node.js v24.22.2 on Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz, ImageScript 3.20.1.

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| decode JPEG | **79 ms** | 169 ms | 183 ms | 141 ms | 49 ms | 16 ms | – | 21 ms |
| decode PNG | **33 ms** | 64 ms | 132 ms | 87 ms | 28 ms | 22 ms | – | 21 ms |
| decode WebP (lossy) | **98 ms** | – | – | 113 ms | 91 ms | 30 ms | – | 18 ms |
| decode AVIF | **274 ms** | – | – | 1.9 s | – | 95 ms | 232 ms | 70 ms |
| decode JPEG XL | **450 ms** | – | – | fails | – | – | 508 ms | 82 ms |
| decode animated GIF | **71 ms** | – | – | – | – | 69 ms | – | – |
| decode animated WebP | **304 ms** | – | – | – | – | 274 ms | – | – |
| encode JPEG (quality 80) | **78 ms** | 434 ms | 113 ms | 147 ms | 125 ms | 19 ms | – | 28 ms |
| encode PNG | **183 ms** | 258 ms | 344 ms | 562 ms | 101 ms | 133 ms | – | 464 ms |
| encode WebP (quality 80) | **228 ms** | – | – | 144 ms | – | 194 ms | – | 181 ms |
| encode WebP (lossless) | **1.3 s** | – | – | 2.9 s | 44 ms | 1.5 s | – | 476 ms |
| encode AVIF (quality 60) | **5.6 s** | – | – | 1.5 s | – | 2.4 s | 2.5 s | – |
| encode JPEG XL (quality 90) | **2.5 s** | – | – | – | – | – | 2.3 s | – |
| encode JPEG XL (lossless) | **892 ms** | – | – | – | – | – | 469 ms | – |
| encode animated GIF | **253 ms** | – | – | – | – | 1.1 s | – | – |
| encode animated WebP (q 80) | **1.1 s** | – | – | – | – | 813 ms | – | – |
| resize to half | **16 ms** | 16 ms | 94 ms | 76 ms | 65 ms | 11 ms | – | 3.8 ms |
| resize to half, bicubic | **69 ms** | 176 ms | 367 ms | – | 85 ms | 13 ms | – | – |
| thumbnail (cover 400×400) | **21 ms** | 61 ms | – | 50 ms | – | 6.9 ms | – | 1.6 ms |
| crop | **2.2 ms** | 25 ms | 22 ms | 13 ms | 6.6 ms | 1.1 ms | – | 1.4 ms |
| rotate by 30° | **57 ms** | 685 ms | 718 ms | 568 ms | 264 ms | 51 ms | – | 39 ms |
| rotate by 90° | **13 ms** | 62 ms | 27 ms | 150 ms | 192 ms | 5.8 ms | – | 16 ms |
| flip | **2.8 ms** | 110 ms | 15 ms | 69 ms | 27 ms | 5.0 ms | – | 13 ms |
| blur (radius 5) | **87 ms** | 98 s | 908 ms | – | 202 ms | 18 ms | – | 32 ms |
| sharpen | **293 ms** | – | – | – | 136 ms | 243 ms | – | – |
| composite an overlay | **2.8 ms** | 36 ms | 12 ms | – | 8.2 ms | 5.9 ms | – | 3.6 ms |
| greyscale | **7.3 ms** | 130 ms | 20 ms | – | 8.4 ms | 32 ms | – | 8.7 ms |
| brightness and contrast | **14 ms** | 287 ms | – | – | 34 ms | 18 ms | – | 15 ms |
| render text | **0.59 ms** | – | – | – | – | 0.73 ms | – | 0.48 ms |
| render SVG | **172 ms** | – | – | – | – | 43 ms | – | 19 ms |
| thumbnail, keeping HDR | **180 ms** | – | – | – | – | 167 ms | – | – |

Encoded sizes. For lossy files, the dB score estimates how closely the decoded image matches the source; higher is
closer.

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| photo PNG | 2.0 MB | 2.7 MB | 2.8 MB | 2.1 MB | 2.8 MB | 2.8 MB | – | 2.1 MB |
| photo JPEG | 218 kB, 40.6 dB | 260 kB, 40.9 dB | 260 kB, 40.9 dB | 222 kB, 40.5 dB | 257 kB, 40.4 dB | 218 kB, 40.6 dB | – | 218 kB, 40.6 dB |
| photo WebP | 1.2 MB | – | – | 2.1 MB | 1.7 MB | 1.2 MB | – | 1.4 MB |
| graphic PNG | 795 kB | 2.0 MB | 736 kB | 811 kB | 2.2 MB | 718 kB | – | 1.0 MB |
| graphic JPEG | 276 kB, 37.3 dB | 315 kB, 37.4 dB | 315 kB, 37.4 dB | 286 kB, 37.3 dB | 314 kB, 37.4 dB | 275 kB, 37.3 dB | – | 276 kB, 37.3 dB |
| graphic WebP | 277 kB | – | – | 758 kB | 856 kB | 239 kB | – | 631 kB |
| animation GIF | 825 kB, identical pixels | – | – | – | – | 720 kB, 45.6 dB | – | – |
| photo AVIF | 93 kB, 40.9 dB | – | – | 992 kB, 32.7 dB | – | 91 kB, 40.6 dB | 80 kB, 40.2 dB | – |
| photo JPEG XL | 245 kB, 44.5 dB | – | – | – | – | – | 227 kB, 44 dB | – |
| graphic AVIF | 147 kB, 41 dB | – | – | 709 kB, 38.5 dB | – | 114 kB, 38.7 dB | 136 kB, 40.5 dB | – |
| graphic JPEG XL | 230 kB, 43.4 dB | – | – | – | – | – | 193 kB, 41.8 dB | – |
| photo WebP lossy | 123 kB, 40 dB | – | – | 153 kB, 38.6 dB | – | 118 kB, 40.4 dB | – | 118 kB, 40.4 dB |
| photo JPEG XL lossless | 1.2 MB | – | – | – | – | – | 1.2 MB | – |
| graphic WebP lossy | 241 kB, 38.4 dB | – | – | 301 kB, 38 dB | – | 233 kB, 39 dB | – | 234 kB, 39 dB |
| graphic JPEG XL lossless | 663 kB | – | – | – | – | – | 666 kB | – |
| animation WebP | 529 kB, 33.6 dB | – | – | – | – | 683 kB, 33.1 dB | – | – |

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|---|---|---|---|---|---|---|---|
| kind | JavaScript | JavaScript | JavaScript | JavaScript | WebAssembly | native (libvips) | WebAssembly | native (Skia) |
| package | `imagescript@3.20.1` | `jimp@1.6.1` | `image-js@1.7.1` | `purejsimage@0.17.0` | `@silvia-odwyer/photon-node@0.3.4` | `sharp@0.35.5` | `@jsquash/avif@2.1.1 @jsquash/jxl@1.3.0` | `@napi-rs/canvas@1.0.11` |
| install size | 2.6 MB | 26.8 MB | 47.8 MB | 6.7 MB | 2.3 MB | 20.3 MB | 14.2 MB | 35.0 MB |
| packages | 1 | 64 | 55 | 1 | 1 | 6 | 3 | 2 |

## Method

- Inputs (in `inputs/`, sources in [inputs/SOURCES.md](inputs/SOURCES.md)): a 1920×1080 photo (JPEG, and made from it
  when the benchmark starts, PNG, lossy WebP, AVIF by sharp (libaom) and JPEG XL by jsquash (libjxl), at the
  qualities below), a 1434×1434 graphic with transparency (PNG), a 445×445 diagram with transparency placed on
  the photo (PNG), a 300×300 GIF with 101 frames (and made from it, an animated WebP by sharp at quality 80).
- Lossy WebP, AVIF and JPEG XL are encoded at the same nominal quality (80, 60 and 90). Because each library uses a
  different quality scale, file sizes are shown with PSNR (peak signal-to-noise ratio), a measure of how closely the
  decoded colors match the original; higher is closer. Colors are compared over black after decoding with libwebp,
  libavif and libjxl. jsquash's JPEG XL encoder uses effort settings chosen to match ImageScript's defaults.
  PureJsImage's AVIF
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
- Where the library lets you choose, resizing is bilinear (smooth) or bicubic (a sharper smoothing filter, in its own
  row), the thumbnail covers 400×400 (cropping the sides), blurring is gaussian (softening) with a radius or sigma of
  5, sharpening uses an unsharp mask (edge enhancement) of radius or sigma 1 (Photon: its 3×3 sharpening kernel),
  rotating by 30° grows the image to fit, brightness and contrast go up
  20% (Jimp's and Photon's scales converted). image-js's and sharp's greyscale make one grey channel (and alpha). Each library uses its own defaults
  otherwise, e.g. its PNG compression level.
- Threads: ImageScript uses worker threads where they pay off (the processors available, at most 8), and sharp gets
  as many (`sharp.concurrency()`; its default on glibc Linux without jemalloc, like on CI, is one). The other
  libraries run on one thread (jsquash turns its threaded builds off in Node).
- [tinybench](https://github.com/tinylibs/tinybench), at least 1.5 seconds and 3 runs per measurement, every library
  in its own process.
- The release workflow runs the benchmark for every regular release and commits the results, on a GitHub Actions runner;
  runners vary, so compare libraries within one run rather than between runs.
- Install sizes: `npm install <library>` in an empty project, the apparent size of `node_modules`.

Run it: `npm install` in this directory, then `node run.js` (on an idle machine; `IMAGESCRIPT=local` measures
this checkout after `npm run build` instead of the version from npm; it runs `startup.js` too), `node installs.js` and `node report.js`.
