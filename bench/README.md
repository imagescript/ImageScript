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

Time per operation (less is faster), measured 2026-11-23 with Node.js v26.13.1 on AMD EPYC 9V74 80-Core Processor, ImageScript 4.0.0.

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| decode JPEG | **52 ms** | 103 ms | 122 ms | 101 ms | 39 ms | 12 ms | – | 18 ms |
| decode PNG | **22 ms** | 54 ms | 91 ms | 66 ms | 20 ms | 16 ms | – | 16 ms |
| decode WebP (lossy) | **62 ms** | – | – | 84 ms | 73 ms | 23 ms | – | 13 ms |
| decode AVIF | **173 ms** | – | – | 1.4 s | – | 69 ms | 183 ms | 48 ms |
| decode JPEG XL | **302 ms** | – | – | fails | – | – | 382 ms | 54 ms |
| decode animated GIF | **53 ms** | – | – | – | – | 57 ms | – | – |
| decode animated WebP | **210 ms** | – | – | – | – | 259 ms | – | – |
| encode JPEG (quality 80) | **66 ms** | 335 ms | 88 ms | 120 ms | 90 ms | 15 ms | – | 23 ms |
| encode PNG | **149 ms** | 196 ms | 241 ms | 478 ms | 85 ms | 115 ms | – | 419 ms |
| encode WebP (quality 80) | **161 ms** | – | – | 107 ms | – | 154 ms | – | 132 ms |
| encode WebP (lossless) | **1.0 s** | – | – | 1.8 s | 36 ms | 1.2 s | – | 405 ms |
| encode AVIF (quality 60) | **3.9 s** | – | – | 1.1 s | – | 1.8 s | 2.0 s | – |
| encode JPEG XL (quality 90) | **1.6 s** | – | – | – | – | – | 2.1 s | – |
| encode JPEG XL (lossless) | **579 ms** | – | – | – | – | – | 388 ms | – |
| encode animated GIF | **186 ms** | – | – | – | – | 928 ms | – | – |
| encode animated WebP (q 80) | **803 ms** | – | – | – | – | 641 ms | – | – |
| resize to half | **11 ms** | 12 ms | 57 ms | 55 ms | 47 ms | 8.3 ms | – | 1.8 ms |
| resize to half, bicubic | **37 ms** | 131 ms | 242 ms | – | 74 ms | 9.2 ms | – | – |
| thumbnail (cover 400×400) | **14 ms** | 38 ms | – | 35 ms | – | 4.9 ms | – | 0.81 ms |
| crop | **1.1 ms** | 17 ms | 12 ms | 8.4 ms | 4.8 ms | 0.75 ms | – | 0.41 ms |
| rotate by 30° | **33 ms** | 512 ms | 585 ms | 436 ms | 169 ms | 34 ms | – | 11 ms |
| rotate by 90° | **10 ms** | 38 ms | 18 ms | 103 ms | 115 ms | 3.9 ms | – | 9.8 ms |
| flip | **2.0 ms** | 84 ms | 8.4 ms | 48 ms | 15 ms | 3.4 ms | – | 5.7 ms |
| blur (radius 5) | **63 ms** | 69 s | 699 ms | – | 127 ms | 14 ms | – | 14 ms |
| sharpen | **195 ms** | – | – | – | 90 ms | 167 ms | – | – |
| composite an overlay | **1.9 ms** | 27 ms | 7.1 ms | – | 5.1 ms | 4.4 ms | – | 0.91 ms |
| greyscale | **5.5 ms** | 100 ms | 15 ms | – | 5.2 ms | 20 ms | – | 3.7 ms |
| brightness and contrast | **10 ms** | 219 ms | – | – | 23 ms | 12 ms | – | 12 ms |
| render text | **0.50 ms** | – | – | – | – | 0.39 ms | – | 0.19 ms |
| render SVG | **129 ms** | – | – | – | – | 30 ms | – | 7.3 ms |
| thumbnail, keeping HDR | **163 ms** | – | – | – | – | 124 ms | – | – |

Encoded sizes:

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| photo PNG | 2.0 MB | 2.7 MB | 2.8 MB | 2.1 MB | 2.8 MB | 2.8 MB | – | 2.1 MB |
| photo JPEG | 218 kB, 40.6 dB | 260 kB, 40.9 dB | 260 kB, 40.9 dB | 222 kB, 40.5 dB | 257 kB, 40.4 dB | 218 kB, 40.6 dB | – | 218 kB, 40.6 dB |
| photo WebP | 1.2 MB | – | – | 2.1 MB | 1.7 MB | 1.2 MB | – | 1.4 MB |
| graphic PNG | 795 kB | 2.0 MB | 736 kB | 811 kB | 2.2 MB | 718 kB | – | 1.0 MB |
| graphic JPEG | 275 kB, 37.3 dB | 315 kB, 37.4 dB | 315 kB, 37.4 dB | 286 kB, 37.3 dB | 314 kB, 37.4 dB | 275 kB, 37.3 dB | – | 276 kB, 37.3 dB |
| graphic WebP | 277 kB | – | – | 758 kB | 856 kB | 239 kB | – | 631 kB |
| animation GIF | 825 kB, identical pixels | – | – | – | – | 720 kB, 45.6 dB | – | – |
| photo AVIF | 93 kB, 40.9 dB | – | – | 992 kB, 32.7 dB | – | 91 kB, 40.6 dB | 80 kB, 40.2 dB | – |
| photo JPEG XL | 245 kB, 44.5 dB | – | – | – | – | – | 227 kB, 44 dB | – |
| graphic AVIF | 147 kB, 41 dB | – | – | 709 kB, 38.5 dB | – | 114 kB, 38.7 dB | 136 kB, 40.5 dB | – |
| graphic JPEG XL | 230 kB, 43.4 dB | – | – | – | – | – | 193 kB, 41.8 dB | – |
| photo WebP lossy | 123 kB, 40 dB | – | – | 153 kB, 38.6 dB | – | 118 kB, 40.4 dB | – | 118 kB, 40.4 dB |
| photo JPEG XL lossless | 1.2 MB | – | – | – | – | – | 1.2 MB | – |
| graphic WebP lossy | 241 kB, 38.4 dB | – | – | 301 kB, 38 dB | – | 233 kB, 39 dB | – | 234 kB, 39 dB |
| graphic JPEG XL lossless | 662 kB | – | – | – | – | – | 666 kB | – |
| animation WebP | 529 kB, 33.6 dB | – | – | – | – | 683 kB, 33.1 dB | – | – |

| | **ImageScript** | **Jimp** | **image-js** | **PureJsImage** | **Photon** | **sharp** | **jsquash** | **@napi-rs/canvas** |
|---|---|---|---|---|---|---|---|---|
| kind | JavaScript | JavaScript | JavaScript | JavaScript | WebAssembly | native (libvips) | WebAssembly | native (Skia) |
| package | `imagescript@4.0.0` | `jimp@1.6.1` | `image-js@1.7.1` | `purejsimage@0.17.0` | `@silvia-odwyer/photon-node@0.3.4` | `sharp@0.35.5` | `@jsquash/avif@2.1.1 @jsquash/jxl@1.3.0` | `@napi-rs/canvas@1.1.0` |
| install size | 2.6 MB | 26.8 MB | 47.9 MB | 6.7 MB | 2.3 MB | 20.3 MB | 14.2 MB | 37.0 MB |
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
