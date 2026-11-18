# ImageScript benchmark

How [ImageScript](https://github.com/imagescript/ImageScript) compares to other image libraries for Node.js: speed, file
sizes and what installing each takes. ImageScript is plain JavaScript with no dependencies, so it runs wherever
JavaScript does, like Jimp, image-js and PureJsImage; sharp and @napi-rs/canvas wrap native libraries (libvips, Skia),
Photon is WebAssembly, and so is jsquash (Squoosh's libavif and libjxl, for AVIF and JPEG XL).

<img src="charts/overview-portable.svg" alt="Time per operation of the libraries that run everywhere, colored by the distance to the fastest">

<img src="charts/overview-native.svg" alt="Time per operation of ImageScript and the native libraries">

<img src="charts/install.svg" alt="Install size of each library">

<img src="charts/sizes-lossless.svg" alt="Lossless file sizes">

<img src="charts/sizes-lossy.svg" alt="Lossy file sizes with their quality">

## Numbers

Time per operation (less is faster), measured 2026-11-18 with Node.js v26.13.1 on AMD EPYC 9V74 80-Core Processor, ImageScript 3.20.4.

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| decode JPEG | **50 ms** | 105 ms | 127 ms | 102 ms | 40 ms | 12 ms | – | 18 ms |
| decode PNG | **23 ms** | 54 ms | 91 ms | 64 ms | 20 ms | 16 ms | – | 16 ms |
| decode WebP (lossy) | **64 ms** | – | – | 84 ms | 74 ms | 23 ms | – | 13 ms |
| decode AVIF | **172 ms** | – | – | 1.4 s | – | 70 ms | 183 ms | 49 ms |
| decode JPEG XL | **314 ms** | – | – | fails | – | – | 381 ms | 58 ms |
| decode animated GIF | **53 ms** | – | – | – | – | 58 ms | – | – |
| decode animated WebP | **210 ms** | – | – | – | – | 263 ms | – | – |
| encode JPEG (quality 80) | **52 ms** | 337 ms | 89 ms | 120 ms | 90 ms | 15 ms | – | 23 ms |
| encode PNG | **152 ms** | 196 ms | 253 ms | 478 ms | 85 ms | 114 ms | – | 416 ms |
| encode WebP (quality 80) | **163 ms** | – | – | 107 ms | – | 155 ms | – | 133 ms |
| encode WebP (lossless) | **1.0 s** | – | – | 2.0 s | 36 ms | 1.2 s | – | 402 ms |
| encode AVIF (quality 60) | **4.0 s** | – | – | 1.1 s | – | 1.7 s | 2.0 s | – |
| encode JPEG XL (quality 90) | **1.7 s** | – | – | – | – | – | 2.1 s | – |
| encode JPEG XL (lossless) | **606 ms** | – | – | – | – | – | 392 ms | – |
| encode animated GIF | **187 ms** | – | – | – | – | 929 ms | – | – |
| encode animated WebP (q 80) | **794 ms** | – | – | – | – | 646 ms | – | – |
| resize to half | **12 ms** | 12 ms | 57 ms | 55 ms | 51 ms | 8.4 ms | – | 3.2 ms |
| resize to half, bicubic | **38 ms** | 204 ms | 241 ms | – | 85 ms | 9.3 ms | – | – |
| thumbnail (cover 400×400) | **14 ms** | 35 ms | – | 35 ms | – | 5.1 ms | – | 1.3 ms |
| crop | **1.1 ms** | 15 ms | 12 ms | 8.4 ms | 5.5 ms | 0.76 ms | – | 0.69 ms |
| rotate by 30° | **32 ms** | 487 ms | 583 ms | 435 ms | 169 ms | 35 ms | – | 25 ms |
| rotate by 90° | **9.4 ms** | 35 ms | 18 ms | 103 ms | 115 ms | 4.1 ms | – | 11 ms |
| flip | **1.7 ms** | 80 ms | 8.5 ms | 47 ms | 19 ms | 3.6 ms | – | 9.4 ms |
| blur (radius 5) | **63 ms** | 66 s | 688 ms | – | 128 ms | 14 ms | – | 14 ms |
| sharpen | **184 ms** | – | – | – | 90 ms | 170 ms | – | – |
| composite an overlay | **1.8 ms** | 27 ms | 7.2 ms | – | 5.6 ms | 4.7 ms | – | 1.9 ms |
| greyscale | **5.4 ms** | 101 ms | 15 ms | – | 5.2 ms | 21 ms | – | 4.6 ms |
| brightness and contrast | **11 ms** | 222 ms | – | – | 25 ms | 12 ms | – | 9.6 ms |
| render text | **0.52 ms** | – | – | – | – | 0.40 ms | – | 0.28 ms |
| render SVG | **119 ms** | – | – | – | – | 32 ms | – | 8.7 ms |
| thumbnail, keeping HDR | **154 ms** | – | – | – | – | 125 ms | – | – |

Encoded sizes:

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
| package | `imagescript@3.20.4` | `jimp@1.6.1` | `image-js@1.7.1` | `purejsimage@0.17.0` | `@silvia-odwyer/photon-node@0.3.4` | `sharp@0.35.5` | `@jsquash/avif@2.1.1 @jsquash/jxl@1.3.0` | `@napi-rs/canvas@1.0.11` |
| install size | 2.6 MB | 26.8 MB | 47.9 MB | 6.7 MB | 2.3 MB | 20.3 MB | 14.2 MB | 35.0 MB |
| packages | 1 | 64 | 55 | 1 | 1 | 6 | 3 | 2 |

## Method

- Inputs (in `inputs/`, sources in [inputs/SOURCES.md](inputs/SOURCES.md)): a 1920×1080 photo (JPEG, and made from it
  when the benchmark starts, PNG, lossy WebP, AVIF by sharp (libaom) and JPEG XL by jsquash (libjxl), at the
  qualities below), a 1434×1434 graphic with transparency (PNG), a 445×445 diagram with transparency placed on
  the photo (PNG), a 300×300 GIF with 101 frames (and made from it, an animated WebP by sharp at quality 80).
- Lossy WebP, AVIF and JPEG XL are encoded at the same nominal quality (80, 60 and 90); as the libraries'
  scales differ, the file sizes come with their PSNR (of the color over black, decoded by libwebp, libavif and
  libjxl). jsquash's libjxl runs at the effort ImageScript's default matches (cjxl's 5 lossy, 3 lossless; its own
  default is 7). PureJsImage's AVIF
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
- Where the library lets you choose, resizing is bilinear (or bicubic, in its own row), the thumbnail covers 400×400
  (cropping the sides), blurring is gaussian with a radius or sigma of 5, sharpening an unsharp mask of radius or
  sigma 1 (Photon: its 3×3 sharpening kernel), rotating by 30° grows the image to fit, brightness and contrast go up
  20% (Jimp's and Photon's scales converted). image-js's and sharp's greyscale make one grey channel (and alpha). Each library uses its own defaults
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
this checkout after `npm run build` instead of the version from npm; it runs `startup.js` too), `node installs.js` and `node report.js`.
