# Coming from Jimp

ImageScript and Jimp solve the same problem the same way: images are decoded into an RGBA bitmap in JavaScript, edited
in place and encoded again, with no native binaries. Most Jimp code translates line by line. This page maps Jimp 1.x
calls to ImageScript 4.x, then lists what works differently and what Jimp has that ImageScript doesn't.

Every mapping below was checked by running both libraries on the same image (Jimp 1.6, ImageScript 4.0). Where the
results aren't identical, the difference is described.

## Why switch

From the [benchmark](https://github.com/imagescript/ImageScript/blob/master/bench/README.md) (ImageScript 3.20.5 and
Jimp 1.6.1 on a GitHub Actions runner, a 1920×1080 photo):

| | ImageScript | Jimp |
|---|--:|--:|
| decode JPEG | 62 ms | 168 ms |
| encode JPEG (quality 80) | 81 ms | 429 ms |
| encode PNG | 181 ms | 236 ms |
| resize to half, bicubic | 46 ms | 195 ms |
| rotate by 30° | 42 ms | 643 ms |
| gaussian blur (radius 5) | 73 ms | 79 s |
| brightness and contrast | 13 ms | 272 ms |
| install size | 2.6 MB, 1 package | 26.8 MB, 64 packages |

Apart from speed:

- **Formats:** Jimp reads and writes PNG, JPEG, BMP, GIF and TIFF. ImageScript adds WebP, AVIF and JPEG XL (lossy and
  lossless), animated GIF, APNG and WebP, QOI, TGA, ICO and Netpbm, plus HDR gain maps. Jimp reads the first frame of an
  animated GIF; ImageScript decodes the whole {@link Animation}.
- **Text:** Jimp prints with pre-rendered bitmap fonts (BMFont). ImageScript renders TrueType, OpenType and WOFF fonts at
  any size, with kerning, ligatures, right-to-left scripts and color emoji.
- **SVG:** ImageScript renders SVGs ({@link Image.renderSVG}); Jimp doesn't.
- **Runtimes:** ImageScript runs unchanged in Node.js, Deno, Bun, browsers and edge runtimes such as Cloudflare
  Workers. Jimp 1.6 can't be bundled for Workers: its package points bundlers that target browsers and Workers to a
  placeholder file without any exports.

## Reading and writing

Jimp reads files and URLs for you. ImageScript only takes bytes (an `ArrayBuffer`, `Uint8Array` or Node.js `Buffer`) and
returns bytes, so the same code works without a file system.

```js
// Jimp
import { Jimp } from 'jimp';
const image = await Jimp.read('input.jpg');
await image.resize({ w: 256 }).write('output.png');

// ImageScript
import { Image } from 'imagescript';
import { readFile, writeFile } from 'node:fs/promises';
const image = await Image.decode(await readFile('input.jpg'));
await writeFile('output.png', await image.resize({ width: 256 }).encodePNG());
```

| Jimp | ImageScript |
|---|---|
| `Jimp.read('file.png')` | `Image.decode(await readFile('file.png'))` |
| `Jimp.read(url)` | `Image.decode(await (await fetch(url)).arrayBuffer())` |
| `Jimp.fromBuffer(buffer)` | `Image.decode(buffer)` |
| `new Jimp({ width, height, color })` | `new Image(width, height).fill(color)` (without `fill`, it's transparent) |
| `image.write('out.png')` | `writeFile('out.png', await image.encodePNG())` |
| `image.getBuffer('image/png')` | `image.encodePNG()` |
| `image.getBuffer('image/jpeg', { quality: 80 })` | `image.encodeJPEG({ quality: 80 })` |
| `image.getBase64('image/png')` | `'data:image/png;base64,' + Buffer.from(await image.encodePNG()).toString('base64')` |
| `image.bitmap.width`, `.height` | `image.width`, `image.height` |
| `image.bitmap.data` | `image.bitmap` (RGBA, four bytes per pixel, like Jimp's) |
| `image.clone()` | `image.clone()` |

{@link Image.decode} gives the first frame of an animation; the global
{@link decode} gives an `Animation` for animated files and an `Image` otherwise. Both apply the
Exif orientation and convert embedded color profiles to sRGB by default.

## Resizing and cropping

| Jimp | ImageScript |
|---|---|
| `resize({ w: 200, h: 100 })` | `resize({ width: 200, height: 100 })` |
| `resize({ w: 200 })` | `resize({ width: 200 })` (the height keeps the aspect ratio) |
| `resize({ w, mode: ResizeStrategy.BICUBIC })` | `resize({ width, mode: 'bicubic' })` |
| `resize({ w, mode: ResizeStrategy.NEAREST_NEIGHBOR })` | `resize({ width, mode: 'nearest-neighbor' })` |
| `scale(0.5)` | `scale(0.5)` |
| `scaleToFit({ w, h })` | `resize({ width, height, fit: 'inside' })` |
| `cover({ w, h })` | `resize({ width, height, fit: 'cover' })` |
| `contain({ w, h })` | `resize({ width, height, fit: 'contain' })` |
| `crop({ x, y, w, h })` | `crop(x, y, w, h)` |
| `autocrop()` | `trim()` |
| `circle()` | `cropCircle()` |

Both resize bilinearly by default. ImageScript's other modes are `'bicubic'`, `'area'` (best for large reductions) and
`'nearest-neighbor'`. `cover` and `contain` center the image; Jimp's `align` option has no equivalent, crop or composite
yourself for other placements. `contain` fills the borders with transparency, or with `background: 0xffffffff`.

`crop()` changes the image in place, like Jimp's; {@link Image.extract | extract} returns the region as a new
image and leaves the original as it is.

## Rotating and flipping

Jimp's `rotate()` turns counterclockwise, ImageScript's turns clockwise (like CSS), so negate the angle:

| Jimp | ImageScript |
|---|---|
| `rotate(90)` | `rotate(-90)` |
| `rotate(30)` | `rotate(-30)` (both grow the image to fit; `expand: false` keeps the size) |
| `flip({ horizontal: true })` | `flip('horizontal')` |
| `flip({ vertical: true })` | `flip('vertical')` |
| `flip({ horizontal: true, vertical: true })` | `rotate(180)` |

## Colors and filters

| Jimp | ImageScript |
|---|---|
| `brightness(1.2)` | `brightness(1.2)` (same factor) |
| `contrast(v)` (-1 to 1) | `contrast((1 + v) / (1 - v))` (a factor, 1 keeps the image) |
| `greyscale()` | `grayscale()` |
| `invert()` | `invert()` |
| `sepia()` | `sepia()` (a slightly different tone) |
| `opacity(0.5)` | `opacity(0.5)` |
| `fade(0.3)` | `opacity(0.7)` |
| `blur(r)`, `gaussian(r)` | `blur(r)` |
| `color([{ apply: 'hue', params: [90] }])` | `hueShift(90)` |
| `quantize({ colors: 16 })` | `quantize({ colors: 16 })` |
| `fisheye()` | `fisheye()` (the option is `strength`, not `radius`) |

`blur(r)` is a gaussian blur with `r` as its standard deviation, like CSS' `blur()`, and takes about as long at any
radius. Its result is close to Jimp's `blur(r)`, which is about 10 times slower on a 1920×1080 photo; Jimp's
`gaussian(r)` looks similar again and slows down with the square of the radius.

ImageScript's other adjustments: {@link Image.saturation | saturation},
{@link Image.lightness | lightness}, {@link Image.gamma | gamma},
{@link Image.sharpen | sharpen}, {@link Image.colorMatrix | colorMatrix},
{@link Image.recolor | recolor}, {@link Image.dropShadow | dropShadow},
{@link Image.outline | outline} and {@link Image.roundCorners | roundCorners}.

## Compositing

| Jimp | ImageScript |
|---|---|
| `composite(src, x, y)` | `composite(src, { x, y })` |
| `composite(src, x, y, { opacitySource: 0.5 })` | `composite(src, { x, y, opacity: 0.5 })` |
| `composite(src, x, y, { mode: BlendMode.MULTIPLY })` | `composite(src, { x, y, mode: 'multiply' })` |
| `blit({ src, x, y, srcX, srcY, srcW, srcH })` | `composite(src.extract(srcX, srcY, srcW, srcH), { x, y })` |

Blend modes are CSS' names: `'multiply'`, `'screen'`, `'overlay'`, `'darken'`, `'lighten'`, `'color-dodge'`,
`'color-burn'`, `'hard-light'`, `'soft-light'`, `'difference'`, `'exclusion'`, and `'add'`.

## Text

Jimp's `print()` draws with a bitmap font loaded by `loadFont()`. ImageScript renders the text into an image of its own,
which you then place with `composite()`:

```js
// Jimp
import { Jimp, loadFont } from 'jimp';
import { SANS_32_BLACK } from 'jimp/fonts';
const font = await loadFont(SANS_32_BLACK);
image.print({ font, x: 10, y: 10, text: 'Hello', maxWidth: 300 });

// ImageScript
const font = await readFile('Inter-Regular.ttf');
const text = await Image.renderText('Hello', { font, size: 32, color: 0x000000ff, width: 300 });
image.composite(text, { x: 10, y: 10 });
```

With `width`, the text wraps; `horizontalAlign` and `verticalAlign` place it in the box. The font is any TrueType,
OpenType or WOFF file; pass several (`font: [text, emoji]`) to fall back to the next one for characters the first one
lacks.

## Pixels

Both use the same color format: a 32-bit number `0xRRGGBBAA`.

| Jimp | ImageScript |
|---|---|
| `getPixelColor(x, y)` | `getPixelAt(x, y)` |
| `setPixelColor(color, x, y)` | `setPixelAt(x, y, color)` (the color comes last) |
| `scan(x, y, w, h, (x, y, idx) => ...)` | `for (const [x, y, color] of image.pixels())`, or index `image.bitmap` directly |
| `intToRGBA(color)` (`{ r, g, b, a }`) | `Colors.toRGBA(color)` (`[r, g, b, a]`) |
| `rgbaToInt(r, g, b, a)` | `Colors.fromRGBA(r, g, b, a)` |

Coordinates start at 0 in both. For speed, work on `image.bitmap` directly: the pixel at `(x, y)` starts at
`(y * image.width + x) * 4`.

## What ImageScript doesn't have

These Jimp features have no counterpart. Where there is a short replacement, it's given.

- `mask()`: no replacement.
- `threshold()`, `posterize()`, `normalize()`, `dither()`, `convolute()` and `convolution()` (custom kernels): no
  replacement; loop over `image.bitmap` for these.
- `pixelate()`: resize down with `mode: 'area'`, then back up with `mode: 'nearest-neighbor'`. The blocks are averaged
  like Jimp's, but they don't line up with Jimp's exactly.
- `hash()`, `pHash()`, `distance()` and `diff()` (image comparison): no replacement.
- `displace()`: no replacement.
- The `color()` actions other than `hue`: `saturate` and `desaturate` are close to
  {@link Image.saturation | saturation}, `mix`, `tint` and `shade` to compositing a filled image with
  `opacity`.
- Reading from file paths and URLs: read the bytes yourself, as shown above.

If you need one of these, [open an issue](https://github.com/imagescript/ImageScript/issues): what people ask for is
what gets added.
