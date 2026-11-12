# Migrating to 4.0

ImageScript 4.0 removes everything 3.x deprecated, reshapes parts of the API, and changes twelve behaviors. Most of the
removals are mechanical: the compiler points at them. The fourteen behavior changes are not deprecations, nothing warns
about them, and code keeps compiling while it does something else. Read the first section even if your build is clean.

Node.js 22.13 or newer is required, as it was for 3.x (`engines` in `package.json`).

The recommended path:

1. Upgrade to the latest 3.x release. Everything still works. Editors show the deprecated APIs with a
   strikethrough, and the deprecation text names the replacement. `tsc` doesn't fail on them, so use the editor's
   problems list, or a lint rule for deprecated APIs (typescript-eslint has `no-deprecated`), to get the full list.
2. Fix every deprecation hint, using the tables below.
3. Switch to 4.0, fix what the compiler reports with the [renamed and reshaped APIs](#renamed-and-reshaped-apis), and go
   through the fourteen behavior changes. The [checklist](#checklist) at the end has grep patterns
   for finding the code they affect.

## Behavior changes

These change what code does without a compile error.

### `decode()` uses animation markers as well as frame count

In 3.x, `decode()` returned a `GIF` for every GIF, including a GIF with one frame, an `Animation` for an animated WebP,
and an `Image` for everything else. An APNG or a JPEG XL with several frames decoded to its first frame, as an `Image`.

In 4.0, a file with several frames or an explicit animation marker decodes to an `Animation`. This includes one-frame
APNGs, animated WebPs, JPEG XL animations and GIFs with a loop extension; their timing and loop metadata are retained.
A file with one frame and no animation marker decodes to an `Image`, including a still image or a one-frame GIF without
a loop extension.

```ts
// 3.x: a GIF was a GIF, which is an Animation with encode()
const gif = await decode(data);
const out = await gif.encode(90);

// 4.0: check what you got
import { Animation, decode } from 'imagescript';

const decoded = await decode(data);
if (decoded instanceof Animation) {
  const out = await decoded.encodeGIF();
}
```

`Image.decode()` still returns only an `Image`: for an animated GIF or WebP it returns the first frame composed onto the
canvas like `Animation.decode()`, and decoding stops after it. Use `Animation.decode()` for all frames and their
metadata. An APNG still gives its default image, as before.

```ts
const first = await Image.decode(data); // the first frame of an animated GIF or WebP
```

Search your code for: `decode(` where the result is used for `encode`, `.length`, indexing or `instanceof GIF`.

### `Animation` holds its frames instead of extending `Array`

In 3.x, an `Animation` was an array of its frames, so `animation[0]` and `animation.push()` worked, and `animation.map()`
returned a plain array. In 4.0 the frames are in `animation.frames`, and the animation is not an array.

```ts
// 3.x
const first = animation[0];
animation.push(frame);
const copy = animation.slice(0, 10);
const widths = animation.map(f => f.width);

// 4.0
const first = animation.frames[0];
animation.frames = [...animation.frames, frame];
const copy = new Animation(animation.frames.slice(0, 10), { loopCount: animation.loopCount });
const widths = animation.frames.map(f => f.width);
```

These still work: `for (const frame of animation)`, `[...animation]`, `Array.from(animation)`, `animation.length` and
the methods of `Animation` itself (`resize()`, `encodeGIF()`, `width`, `duration`, ...). `Array.isArray(animation)` is
`false` now. `animation.frames` is a frozen snapshot, so array mutation methods and index assignment don't change it.
The `Frame` objects themselves remain mutable; replace the list by assigning a new array to `animation.frames`.

`animation.length` is read-only, so `animation.length = 0` throws. Assigning `animation.frames = list` copies `list`
into a new array, so later changes to `list` don't reach the animation.

Search your code for: `Array.isArray`, `.slice(`, `.map(`, `.filter(`, `.forEach(`, `.reduce(`, `.push(`, `.splice(`, `.length =`
and `[0]` on variables that hold an animation.

### Loop counts

In 3.x, `-1` meant "forever", and decoded animations reported `-1`. In 4.0, `Infinity` is forever, it is the default,
and decoded animations report `Infinity`.

```ts
// 3.x
new Animation(frames, { loopCount: -1 });     // forever
animation.loopCount === -1;                   // true for a decoded animation that loops

// 4.0
new Animation(frames);                        // forever, the default
new Animation(frames, { loopCount: Infinity });
animation.loopCount === Infinity;
```

The finite counts are the same: `0` plays once, `2` plays three times. The valid values are `Infinity` and integers
from 0 ({@link AnimationOptions.loopCount}). `-1` throws a `RangeError`, like other negative numbers, `NaN` and
fractions. Numeric strings, `null` and booleans throw a `TypeError`. The check applies to the constructor, to the setter `animation.loopCount = ...` (which keeps the
old count when it throws), and to the encoders `Animation.gifEncoder()`, `webpEncoder()` and `apngEncoder()`.

The formats store a finite count in fixed-size fields: a GIF up to `65535`, a WebP up to `65534` and an APNG up to
`2147483646` (2^31 - 2). A larger count throws a `RangeError` before anything is encoded, from `encodeGIF()`,
`encodeWebP()`, `encodeAPNG()` and the streaming encoders. This limit is already enforced in the latest 3.x release,
3.20.2; earlier releases silently wrapped a GIF count of `65536` to `0`, which means forever. `Infinity` is always
fine.

Search your code for: `loopCount: -1`, `loopCount = -1`, `loopCount === -1` and `loopCount < 0`.

### Resize fit modes

`resize({ width, height, fit })` handles stretching, aspect-ratio fitting and cropping. It works on images, frames and
animations; frame offsets and animation canvases follow the resized pixels.

| `fit` | Result |
| --- | --- |
| `'fill'` (default) | Stretches to the exact dimensions |
| `'inside'` | Keeps the aspect ratio and fits inside the box without padding |
| `'contain'` | Keeps the aspect ratio and pads to the exact box; `background` sets the bar color |
| `'cover'` | Keeps the aspect ratio and crops to the exact box |

`contain` and `cover` require both dimensions. `background` is only valid with `fit: 'contain'`. `ResizeFit` is the
type of the `fit` option.

| 3.x | 4.0 |
| --- | --- |
| `image.contain(800, 600)` (at most 800x600, no bars) | `image.resize({ width: 800, height: 600, fit: 'inside' })` |
| `image.fit(800, 600)` (exactly 800x600, transparent bars) | `image.resize({ width: 800, height: 600, fit: 'contain' })` |
| `image.cover(800, 600)` | `image.resize({ width: 800, height: 600, fit: 'cover' })` |

### Hues are in degrees

`Colors.fromHSL()`, `Colors.fromHSLA()` and `Colors.toHSLA()` take and return the hue in degrees (0-360, like CSS'
`hsl()` and like `hueShift()`), no longer as a fraction (0-1). Saturation, lightness and alpha stay 0-1. An old hue
still works without an error, but gives a different color: `Colors.fromHSL(0.5, 1, 0.5)` was cyan and is now red.

| 3.x | 4.0 |
| --- | --- |
| `Colors.fromHSL(h, s, l)` with `h` in 0-1 | `Colors.fromHSL(h * 360, s, l)` |
| `Colors.toHSLA(color)[0]` in 0-1 | `Colors.toHSLA(color)[0] / 360` for the old value |

### `rotate()` turns clockwise

`image.rotate(angle)` turns the image clockwise, like CSS' `rotate()`. In 3.x it turned counterclockwise. Negate the
angle to keep the old result:

| 3.x | 4.0 |
| --- | --- |
| `image.rotate(90)` | `image.rotate(-90)` (or `image.rotate(270)`) |
| `image.rotate(45, false)` | `image.rotate(-45, { expand: false })` |

Search your code for: `.rotate(`.

### JPEG composites transparent pixels onto black

JPEG does not store transparency (also called an alpha channel). In 3.x, `encodeJPEG()` dropped the alpha and kept the
color, so a fully transparent pixel showed its stored red, green and blue values (often black, but not always). In
4.0, an image with transparent or translucent pixels is combined with a background first, black by default, the way
a viewer would show it on black. Pass `background` for another color: `image.encodeJPEG({ background: 0xffffffff })`.
Opaque images encode as before, byte for byte.
The new `subsampling` option controls how much color detail to keep: `'4:4:4'` keeps it all; `'4:2:0'` stores less
color detail to make a smaller file. Its default remains 4:2:0 up to quality 90 and 4:4:4 above.

Search your code for: `encodeJPEG(` on images that can have transparency.

### `quantize()` dithers by default

`image.quantize()` reduces an image to a limited color palette. It now uses dithering by default: a pattern of small
color changes that helps smooth the result when colors are reduced. The default method is Floyd-Steinberg, with a
strength of `0.85`, like the GIF encoders. In 3.x it didn't dither unless you passed `dither`. For the old result,
pass `dither: 'none'`:

| 3.x | 4.0 |
| --- | --- |
| `image.quantize({ colors: 16 })` | `image.quantize({ colors: 16, dither: 'none' })` |
| `image.quantize({ colors: 16, dither: 'floyd-steinberg' })` (strength 1) | `image.quantize({ colors: 16, dither: 'floyd-steinberg', ditherStrength: 1 })` |

The second row matters for every dither method: the default strength is `0.85` now, so pass `ditherStrength: 1` to
keep 3.x's result.

Search your code for: `.quantize(`.

### Frames move their offsets when their size changes

A frame's `crop()`, `resize({ fit: 'cover' })` and `rotate()` now move its offsets, so the frame's pixels stay where
they are in the animation. In 3.x, `crop()` and `rotate()` kept the offsets (the top left corner stayed in place), and
`cover()` only scaled them. Now:

- `frame.crop(x, y, w, h)` adds `x` and `y` to the offsets, like `trim()` already did.
- `frame.rotate(angle)` keeps the frame's middle in place.
- `frame.resize({ width: w, height: h, fit: 'cover' })` scales the offsets and then moves them by the cropped amount.

`transform()`, `dropShadow()` and `outline()` moved the offsets in 3.x too, but only as far as they allowed: a frame at
`xOffset: 0` couldn't grow to the left, so a shadow or outline was cut off on that side and a transform grew to the
right instead. Now the frame grows the same way an image does and the offsets can become negative; the part outside the
animation's canvas isn't encoded.

To keep a frame's offsets as they are, call the method on its image: `frame.image.crop(x, y, w, h)`. See
[frames hold an image](#frames-hold-an-image) for the other frame changes.

Search your code for: `.crop(`, `.resize(` with `fit: 'cover'`, and `.rotate(` on frames.

### Values that were wrapped, clamped or ignored now throw

Several values that 3.x quietly changed into something else now throw, naming the value:

| Value | 3.x | 4.0 |
| --- | --- | --- |
| Colors (`setPixelAt()`, `fill()`, options like `background`, `Colors.toRGBA()`, ...) | any number, wrapped to 32 bits (`2 ** 32 + 5` was `0x00000005`, `1.5` was `1`) | an integer from `-2 ** 31` to `2 ** 32 - 1`, else a `RangeError`. Negative colors keep working: they're what bitwise operators return (`r << 24 \| g << 16 \| b << 8 \| a`) and read as the same unsigned color |
| Colors returned by a `fill()` function | anything, `undefined` was transparent black | checked like any color |
| Pixel coordinates (`getPixelAt()`, `setPixelAt()`, `crop()`, `extract()`, `composite()`'s `x` and `y`) | truncated to 32 bits, so `2 ** 32` was `0` | truncated (fractions dropped) without wrapping: out of the image throws as before |
| `compression` of `encodePNG()`, `encodeAPNG()` and `apngEncoder()` | clamped to 0-9 and truncated | an integer from 0 to 9, like `effort`, else a `RangeError` |
| Frame durations over what the format stores (GIF and APNG 655350 ms, WebP 16777215 ms) | cut to the format's limit | a `RangeError`, like loop counts that don't fit. Unchanged frames that are merged are split at the limit instead |
| `frame.xOffset`, `frame.yOffset` (and encoder `add()` offsets) | stored as given, fractions included (`0.4`) | truncated to integers when set, like image sizes, so the offset you read is the one that is encoded |
| `image.bitmap = view` with a view that doesn't start at a multiple of 4 bytes | copied, so changes to the view no longer reached the image | a `TypeError`: pass an aligned view, or `view.slice()` for a copy |
| `Colors.gradient()` at a `NaN` position | transparent black with two stops, a `RangeError` with more | a `RangeError` with any number of stops |
| `encodeGIF()` of an animation without frames | a GIF that doesn't decode | an `Error`, like `encodeAPNG()` and `encodeWebP()` |
| `quality` of `encodeJPEG()` | clamped to 1-100 | a number from 0 to 100 (0 is 1), else a `RangeError`, like the other lossy formats |
| The source of `composite()` when it isn't an `Image` | a `TypeError` from inside (`Cannot read properties of undefined`) or nothing | a `TypeError` naming the call |

A value outside a fixed set of choices is a `TypeError` naming them all, like `resize mode must be 'nearest-neighbor',
'bilinear', 'bicubic' or 'area', not 'lanczos'`. This changes the error type of the resize `mode` (an `Error`, and only
thrown once resizing started), `composite()`'s `mode`, `flip()` and `disposalMode` (`RangeError`s), and `wrapStyle`
(a `RangeError`; `''` and `null` were the default, now they throw).

Search your code for: `compression:`, `xOffset`, `yOffset`, `.bitmap =`, `duration:` above 655 seconds, and catch
blocks that check for `RangeError` around `resize()`, `composite()`, `flip()` and `disposalMode`.

### `dominantColor()` thresholds are channel values

The `threshold` of `dominantColor()` is in channel values (0-256): colors whose channels are all below it count as
black, all above 255 minus it as white. In 3.x it counted in steps of 4 (0-64), so the default `15` meant 60. The
default is the same; a threshold you give has to be multiplied by 4:

| 3.x | 4.0 |
| --- | --- |
| `image.dominantColor(true, true, 15)`, `dominantColor({ threshold: 15 })` | `image.dominantColor({ threshold: 60 })` |

Search your code for: `threshold:` near `dominantColor(`.

### `renderText()` takes the image's size

`maxWidth` and `maxHeight` are `width` and `height`, and they are the size of the image: the lines wrap to the width
(inside the outline of `strokeWidth`), the lines that don't fit the height are left out, and `horizontalAlign` and
`verticalAlign` place the text in that box. In 3.x the image was only as wide as the widest line and as high as the
lines, so the alignment only moved lines against each other. Without a `width` or `height` the image is as large as
the text, as before. `wrapHardBreaks` is removed:

| 3.x | 4.0 |
| --- | --- |
| `{ font, size, maxWidth: 300 }` (wrapped, as wide as the widest line) | `{ font, size, width: 300 }` (wrapped, 300 pixels wide); `trim()` the image for the old size |
| `{ font, size, maxHeight: 100, verticalAlign: 'bottom' }` | `{ font, size, height: 100, verticalAlign: 'bottom' }`: the last lines that fit, at the bottom of a 100 pixel high image |
| `{ font, size, maxWidth: 0 }` (no limit) | `{ font, size }`: `0` throws |
| `{ font, size, wrapHardBreaks: false }` | `Image.renderText(text.replace(/\r?\n/g, ''), { font, size })` |

An old `maxWidth` or `maxHeight` is ignored, so the text isn't wrapped or cut off. Search your code for: `maxWidth`,
`maxHeight` and `wrapHardBreaks`.

### Encoded files have no creation time and no version by default

In 3.x, every encoder wrote the time of encoding as the creation time and `ImageScript vX.Y.Z` as the software, so the
same image never encoded to the same bytes twice, and every file told which release made it. In 4.0, the creation time
is only written when `metadata.creationTime` is given, and the default software is `'ImageScript'`, without a version
(`software: null` leaves it out):

| 3.x | 4.0 |
| --- | --- |
| `image.encodePNG()` (with the time of encoding) | `image.encodePNG({ metadata: { creationTime: Date.now() } })` |

Search your code for: code that reads `Creation Time`, Exif `DateTime` or the software version from encoded files.

### SVG and text rendering limits, and images that can't be drawn

`Image.renderSVG()` used to draw nothing for an `<image>` it couldn't use. In 4.0, drawing one throws, so a rendered SVG
is the image it describes or nothing:

- an `href` that isn't a data URI or a key of the `images` option (such as `href="logo.png"` or an `https:` URL, which
  are never fetched): pass the image's bytes with `images: { 'logo.png': bytes }`
- an image that can't be decoded (the error says which, with the decoding error as its `cause`), a data URI of a type
  that isn't supported, or an embedded SVG that can't be read
- images beyond the new `maxImagePixels` option: the pixels of all the raster images the SVG references, decoded
  together (default: `maxPixels`; `Image` values in `images` don't count). In 3.x, each image was checked on its own,
  so many images could take many times `maxPixels`

Images that aren't drawn (in `<defs>`, `display="none"`, `visibility="hidden"`) don't throw.

The new `maxLayerPixels` option limits the layers rendering uses at once, the output included: each group with opacity,
a mask, a filter or a blend mode is drawn in a layer of its own (16 bytes per pixel), so nested ones multiply the memory
of a small SVG. The default is `4 * maxPixels`; an SVG over it throws a `RangeError`. For untrusted SVGs, lower
`maxPixels` (it bounds the output, the layers and the images): the worst case is about 90 bytes per pixel of
`maxPixels` (64 for the layers, up to 20 for the images, 4 for the output), so `maxPixels: 4096 ** 2` keeps rendering
around 1.5 GB.

`Image.renderText()` takes `maxPixels` too (default `16383 ** 2`), which counts the outline (`strokeWidth`), checked
before anything is allocated.

Search your code for: `renderSVG(` with SVGs that reference files or URLs, or that may contain broken images.

## Removed APIs

Each table maps a 3.x API to its 4.0 replacement. The deprecation hint in 3.x names a replacement too, but some of those
replacements were reshaped in 4.0 as well (for example `ResizeModes`, which became plain strings); the tables give the
4.0 form. The replacements are documented on their own pages: {@link ResizeMode}, {@link FrameDisposalMode},
{@link Colors}, {@link Frame}, {@link Animation}, {@link AnimationEncoder} and {@link Metadata}.

### Constants and modes

| 3.x | 4.0 |
| --- | --- |
| `Image.RESIZE_NEAREST_NEIGHBOR`, `ResizeModes.NEAREST_NEIGHBOR` | `'nearest-neighbor'` |
| `Image.RESIZE_BILINEAR`, `ResizeModes.BILINEAR` | `'bilinear'` |
| `Image.RESIZE_BICUBIC`, `ResizeModes.BICUBIC` | `'bicubic'` |
| `Image.RESIZE_AREA`, `ResizeModes.AREA` | `'area'` |
| `Image.RESIZE_AUTO`, `ResizeModes.AUTO` | Pass only the width or the height: `image.resize({ width: 256 })` |
| The upper-case mode strings, `'RESIZE_BILINEAR'` and the others | The lower-case names, `'bilinear'` and the others |
| The `ResizeMode` type, with the upper-case strings or the numbers 1-3 | Narrowed to the lower-case names: `'nearest-neighbor'`, `'bilinear'`, `'bicubic'` or `'area'` |
| The `SVGScaleMode` type | Removed with the SVG modes, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_SCALE` (or `1`) | `Image.renderSVG(svg, { scale: 2 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_WIDTH` (or `2`) | `Image.renderSVG(svg, { width: 512 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_HEIGHT` (or `3`) | `Image.renderSVG(svg, { height: 512 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Frame.DISPOSAL_ANY`, `Frame.DISPOSAL_KEEP`, `Frame.DISPOSAL_PREVIOUS`, `Frame.DISPOSAL_BACKGROUND`, and the same on `FrameDisposalModes` | `'any'`, `'keep'`, `'previous'`, `'background'` |
| Numeric disposal ids: `frame.disposalMode = 3`, `disposalMode: 3` in the frame options | The names: `frame.disposalMode = 'background'`, `disposalMode: 'background'`. `FrameDisposalModeId` is removed |

The modes are plain strings in 4.0: the `ResizeModes` and `FrameDisposalModes` classes are removed, and the types
{@link ResizeMode} and {@link FrameDisposalMode} list the names. The old string and number values are not accepted
any more, so `image.resize(256, 256, { mode: 'RESIZE_BICUBIC' })` throws.

### Colors, pixels and encoding on `Image`

| 3.x | 4.0 |
| --- | --- |
| `image.encode(options)` | `image.encodePNG(options)`. The positional forms are in the positional table below |
| `Image.rgbaToColor(r, g, b, a)` | `Colors.fromRGBA(r, g, b, a)` |
| `Image.rgbToColor(r, g, b)` | `Colors.fromRGB(r, g, b)` |
| `Image.hslaToColor(h, s, l, a)` | `Colors.fromHSLA(h, s, l, a)` |
| `Image.hslToColor(h, s, l)` | `Colors.fromHSL(h, s, l)` |
| `Image.rgbaToHSLA(r, g, b, a)` | `Colors.toHSLA(color)` |
| `Image.colorToRGBA(color)` | `Colors.toRGBA(color)` |
| `Image.colorToRGB(color)` | `Colors.toRGB(color)` |
| `Image.gradient(colors)` | `Colors.gradient(colors)` |
| `for (const [x, y] of image)` | `for (const [x, y] of image.coordinates())` |
| `image.iterateWithColors()` | `image.pixels()`, which yields `[x, y, color]` |

The moved color helpers keep their argument shapes and results, except for the hue-unit change described above.
`Colors.gradient()` also accepts an array of evenly spaced colors, in addition to the prior positions-to-colors object.
`Colors` is exported from the package.

### Channel methods and `absolute`

`opacity()`, `red()`, `green()`, `blue()`, `lightness()` and `saturation()` only scale now. The `absolute` argument is
removed, and so is the `AdjustOptions` type.

| 3.x | 4.0 |
| --- | --- |
| `image.opacity(0.5)`, `image.red(0.5)` (scale) | Unchanged |
| `image.red(0.5, true)`, `image.opacity(0.5, true)`, `image.lightness(0.5, true)` | See below |
| `AdjustOptions` (type) | Removed with `absolute`: the channel methods take the factor only |
| `image.red(0.5, { absolute: true })` | See below |

`tsc` reports a leftover call as `Expected 1 arguments, but got 2`. In JavaScript the extra argument is ignored, so
`image.red(0.5, true)` scales the channel instead of setting it (a pixel with red 0 stays 0, where 3.x's `absolute` set
it to 128): fix these while the 3.x deprecation hints still point at them.

For a fixed color, use `image.recolor(color)`. It sets the RGB of every pixel and keeps each pixel's alpha. The 3.x
`absolute` calls set one channel of every pixel to a value, and `recolor()` has no equivalent for a single channel. Set
the bytes yourself when you need it, on an image without a gain map:

```ts
// 3.x: every pixel's red channel to 128
image.red(0.5, true);

// 4.0
for (let i = 0; i < image.bitmap.length; i += 4) image.bitmap[i] = 0.5 * 255;
```

`bitmap` stores four bytes per pixel: red, green, blue and transparency (alpha). Writing it directly skips the gain map
of a high-dynamic-range (HDR) image, so do not use it on images that have one. `absolute` on `lightness()` and
`saturation()` sets the value of every pixel and keeps its hue.
Do it per pixel: read the color with `Colors.toHSLA()`, set the lightness or saturation, and write the pixel back with
`Colors.fromHSLA()`.

### Animations and GIF

| 3.x | 4.0 |
| --- | --- |
| `new GIF(frames, loopCount)` | `new Animation(frames, { loopCount })` |
| `GIF.decode(data)` | `Animation.decode(data)`, which decodes APNGs and WebPs too |
| `gif.encode(quality)` | `animation.encodeGIF({ colors })`, see the [GIF options](#renamed-and-reshaped-apis) |
| `GIF` (the class, also in `instanceof`) | `Animation`. `GIF` is no longer exported |
| `animation.slice(start, end)` | `new Animation(animation.frames.slice(start, end), { loopCount: animation.loopCount })` |
| `animation[i]` and the array methods | `animation.frames[i]` and non-mutating array methods; assign a new array to change the frame list |
| `AnimationEncoder.frames` | `AnimationEncoder.frameCount` |
| `toString()` of a GIF, `GIF<64x64x1000ms>` | `Animation<64x64x1000ms>` |

The option types of the animation encoders are renamed, and each one takes `loopCount` through `AnimationOptions`:

| 3.x | 4.0 |
| --- | --- |
| `AnimationEncoderOptions` | `AnimationEncodeOptions & AnimationOptions` |
| `WebPAnimationEncoderOptions` | `WebPAnimationEncodeOptions & AnimationOptions` |
| `GIFAnimationEncoderOptions` | `GIFAnimationEncodeOptions & AnimationOptions` |
| `APNGAnimationEncoderOptions` | `APNGEncodeOptions & AnimationOptions` |

Each of them extends the options of the format's still images: `GIFAnimationEncodeOptions` extends
`GIFEncodeOptions`, `APNGEncodeOptions` extends `PNGEncodeOptions` and `WebPAnimationEncodeOptions` extends
`WebPEncodeOptions` (without `threads`: the frames are encoded one at a time).

### Text, crop and metadata

| 3.x | 4.0 |
| --- | --- |
| `Image.renderText(font, size, text)` | `Image.renderText(text, { font, size })` |
| `Image.renderText(font, size, text, color, layout, style)` | `Image.renderText(text, { font, size, color, ...layout, ...style })` |
| `Image.renderText(font, size, text, options)` | `Image.renderText(text, { font, size, ...options })` |
| `TextOptions` (type) | `RenderTextOptions` |
| `verticalAlign: 'right'`, `horizontalAlign: 'bottom'` (the other axis' values) | `horizontalAlign` takes `'left'`, `'center'` or `'right'`, `verticalAlign` takes `'top'`, `'middle'` or `'bottom'`. Other values throw a `TypeError` |
| `image.cropCircle(true)` | `image.cropCircle({ size: 'cover' })` |
| `image.cropCircle(true, feathering)` | `image.cropCircle({ size: 'cover', feathering })` |
| `image.cropCircle(false)` | `image.cropCircle()`, the default `size: 'contain'` |
| `image.cropCircle({ max: true })` | `image.cropCircle({ size: 'cover' })` |
| `PNGMetadata` (type) | `Metadata`, which all encoders take |

`renderText()` takes the text first. The font, the size, the color, the layout options ({@link TextLayoutOptions}) and
the style are all in the one options object, documented in {@link RenderTextOptions}. Crop options are in
{@link CropCircleOptions}. A key that is not an option is ignored without an error, so
`cropCircle({ max: true })` quietly becomes the default `contain`: change it to `size: 'cover'`.

### Positional arguments

Methods that took options as their last positional arguments take the options object now. The values go into the
object under the names of their options. The options of each method are on its own page, for example
{@link ResizeOptions}, {@link CompositeOptions}, {@link RotateOptions}, {@link SharpenOptions},
{@link DominantColorOptions}, {@link RoundCornersOptions}, {@link FisheyeOptions}, {@link TrimOptions},
{@link ColorToAlphaOptions}, {@link PNGEncodeOptions}, {@link JPEGEncodeOptions}, {@link RenderSVGOptions} and
{@link FrameOptions}. The animation options are {@link GIFAnimationEncodeOptions}, {@link APNGEncodeOptions},
{@link DecodeOptions} and {@link GainMapEncodeOptions} for `GainMap.encodeJPEG()`.

| 3.x | 4.0 |
| --- | --- |
| `image.resize(256, 256, 'bicubic')`, `image.resize(256, 256, ResizeModes.AREA)` | `image.resize(256, 256, { mode: 'bicubic' })` |
| `image.scale(0.5, 'area')`, `image.scale(0.5, ResizeModes.AREA)` | `image.scale(0.5, { mode: 'area' })` |
| `image.resize(100)` (width only, the height left out) | `image.resize({ width: 100 })`, which keeps the aspect ratio. The positional form throws a `RangeError` without a height |
| `image.contain(w, h, mode)`, `image.fit(w, h, mode)`, `image.cover(w, h, mode)` | `image.resize({ width: w, height: h, fit: 'inside', mode })`, with `'contain'` or `'cover'` as needed; see [Resize fit modes](#resize-fit-modes) |
| `Frame` and `Animation`: `resize(w, h, mode)` | `resize(w, h, { mode })` |
| `image.composite(logo, 10, 20, { opacity: 0.5 })` | `image.composite(logo, { x: 10, y: 20, opacity: 0.5 })` |
| `image.rotate(45, false)` | `image.rotate(-45, { expand: false })`: the angle is negated because [`rotate()` turns clockwise](#rotate-turns-clockwise) now |
| `image.sharpen(2, 3)` | `image.sharpen({ amount: 2, radius: 3 })` |
| `image.dominantColor(true, true, 15)` | `image.dominantColor({ ignoreBlack: true, ignoreWhite: true, threshold: 60 })`: the threshold is in channel values now, see [below](#dominantcolor-thresholds-are-channel-values) |
| `image.roundCorners(8)` | `image.roundCorners({ radius: 8 })` |
| `image.fisheye(3)` | `image.fisheye({ strength: 3 })` |
| `image.trim(color, options)`, `frame.trim(color, options)` | `image.trim({ color, ...options })`, `frame.trim({ color, ...options })` |
| `image.colorToAlpha(color, options)` | `image.colorToAlpha({ color, ...options })` |
| `image.encodePNG(1, { author })` | `image.encodePNG({ compression: 1, metadata: { author } })` |
| `image.encodePNG({ author })` (metadata alone) | `image.encodePNG({ metadata: { author } })`. The old form is ignored, see below |
| `image.encodeJPEG(90)` | `image.encodeJPEG({ quality: 90 })` |
| `animation.encodeGIF(90)` | `animation.encodeGIF()`; a quality of 90 and above was the default 256 colors, see the [GIF options](#renamed-and-reshaped-apis) for lower ones |
| `animation.encodeAPNG(9)` | `animation.encodeAPNG({ compression: 9 })` |
| `gainMap.encode(90)`, `gainMap.encode({ quality: 90 })` | `gainMap.encodeJPEG({ quality: 90 })`: renamed for the format it writes, like `Image.encode()` became `encodePNG()` |
| `Image.renderSVG(svg, 512, 'width')` | `Image.renderSVG(svg, { width: 512 })` (and `{ height }`, `{ scale }`) |
| `new Frame(w, h, duration, x, y, disposal)` | `new Frame(new Image(w, h), { duration, xOffset, yOffset, disposalMode })`, see [frames](#frames-hold-an-image) |
| `Frame.from(image, duration, x, y, disposal)` | `new Frame(image.clone(), { duration, xOffset, yOffset, disposalMode })` |
| `new Animation(frames, loopCount)` | `new Animation(frames, { loopCount })` |
| `Animation.decode(data, true)` | `Image.decode(data)` for the first frame, `Animation.decode(data)` for all |
| `decode(data, true)` | `Image.decode(data)` |
| `decode(data, { onlyFirstFrame: true })` | `Image.decode(data)` |

`decode()` and `Animation.decode()` take options only: a boolean throws a `TypeError` that names the options form.

In 3.x, `image.encodePNG({ author })` was read as metadata. In 4.0 the metadata goes in `metadata`, and an `author` key
at the top level is ignored like any other unknown key: TypeScript reports it for an inline object, JavaScript doesn't.

## Renamed and reshaped APIs

These changed in 4.0 without a deprecation in 3.x. Most are compile errors in TypeScript; in JavaScript, and for
options objects that aren't written inline, an old option key is ignored without an error (`rotate(45, { resize:
false })` grows the image again), so search for them too.

### Methods and options

| 3.x | 4.0 |
| --- | --- |
| `image.rotate(angle, { resize: false })` | `image.rotate(-angle, { expand: false })`, like `transform()`, `outline()` and `dropShadow()` (the angle negated, as [`rotate()` turns clockwise](#rotate-turns-clockwise)) |
| `image.rotate(angle, { fast: false })`, `{ fast: true }` | `image.rotate(-angle)`: the precise bilinear sampling is the default now, `fast` is removed. `mode` picks `'nearest-neighbor'`, `'bilinear'` or `'bicubic'`, like `transform()` |
| `resize(w, h, { fast: false })`, `scale(f, { fast: false })`, `{ fast: true }` | `resize(w, h)`, `scale(f)`: `fast` is removed, resizing always works like its default `fast: true` (8-bit rounding between the passes, at most a step or two off the precise result) |
| `ResizeModes.AREA` and the other `ResizeModes` | `'area'` and the other names, see [constants and modes](#constants-and-modes) |
| `FrameDisposalModes.BACKGROUND` and the other `FrameDisposalModes` | `'background'` and the other names |
| `Image.renderSVG(svg, { size: 512, mode: 'width' })`, `{ mode: 'height' }` | `Image.renderSVG(svg, { width: 512 })`, `{ height: 512 }` |
| `Image.renderSVG(svg, { size: 2 })`, `{ size: 2, mode: 'scale' }` | `Image.renderSVG(svg, { scale: 2 })` |
| `SVGScaleModes`, `SVGScaleMode` | Removed, see the two rows above |
| `image.drawBox(x, y, w, h, color)` | `image.composite(new Image(w, h).fill(color), { x, y })`. It blends a translucent color over the image; `drawBox()` replaced the pixels |
| `image.drawCircle(x, y, r, color)` | `image.composite(new Image(2 * r, 2 * r).fill(color).cropCircle(), { x: x - r, y: y - r })` |
| `image.greyscale()` | `image.grayscale()` (the whole API spells American English) |
| `Image.renderText(text, { font, size, layout: { maxWidth: 300 } })`, `layout: new TextLayout(options)` | `Image.renderText(text, { font, size, width: 300 })`: the layout options ({@link TextLayoutOptions}) are part of the options; `TextLayout` isn't exported |
| `image.getRGBAAt(x, y)` | `Colors.toRGBA(image.getPixelAt(x, y))`, an array (`getRGBAAt()` returned a view into the bitmap) |
| `image.region(x, y, w, h)` | `image.extract(x, y, w, h)` |
| `animation.encodeGIF({ quality })`, `Animation.gifEncoder(w, h, { quality })` | `{ colors }`: the palette size, 2-256. A quality of 90 and above is the default `256`; below, `colors: Math.round(8 * 32 ** (quality / 90))` gives the old palette size. `dither` (`'floyd-steinberg'` by default, `'atkinson'`, `'ordered'` or `'none'`) and `ditherStrength` are new |
| `FrameDisposalModeName` (type) | `FrameDisposalMode`: the `Name` suffix is gone, as `FrameDisposalModeId` is |
| `SVGOptions` (type) | `RenderSVGOptions`, like `RenderTextOptions` |
| `TextStyle` (type) | `TextStyleOptions`, like `TextLayoutOptions` |
| `GIFEncodeOptions` (the options of `Animation.encodeGIF()`) | `GIFAnimationEncodeOptions`. `GIFEncodeOptions` is now the options of the new `Image.encodeGIF()` |
| `AnimationDecodeOptions` (type) | `DecodeOptions`, which `Image.decode()`, `Animation.decode()` and `decode()` all take |
| `EncodeOptions` (type) as the options of `encodeTGA()` | `TGAEncodeOptions`. `EncodeOptions` is now the `metadata` that all encoder options extend |
| `new GainMap(image, { gainMapMin, gainMapMax })`, `map.gainMapMin`, `map.gainMapMax` | `new GainMap(image, { min, max })`, `map.min`, `map.max` |
| `Image.renderSVG(svg, { fonts })` | `Image.renderSVG(svg, { font })`, like `renderText()` (one font or an array). An old `fonts` is ignored, so text isn't drawn: search for it |
| `setPixelAt(x, y, pixelColor)`, `lightness(value)`, `saturation(value)`, `opacity(opacity)` (parameter names only) | `setPixelAt(x, y, color)`, `lightness(factor)`, `saturation(factor)`, `opacity(factor)` |

### Fixed-length tuple types

`transform()` on images, frames and animations takes an `AffineTransform` with exactly six values. Gain-map channel
parameters take a scalar or a three-value `[red, green, blue]` tuple (`GainMapChannelValues`); use a scalar for the
shared-channel form instead of a one-element array. The gain-map parameter properties (`min`, `max`, `gamma`,
`offsetSDR` and `offsetHDR`) return readonly copies: changing `map.min[0]` does not change the map (and TypeScript
rejects it). Assign a scalar or a full tuple instead, such as `map.min = [0, 1, 2]`.

### Frames hold an image

A `Frame` is no longer an `Image`: it holds one, `frame.image`, with the frame's duration, offsets and disposal mode.
`new Frame()` takes the image (which the frame uses as it is, without a copy), and `Frame.from()` is removed.

| 3.x | 4.0 |
| --- | --- |
| `new Frame(width, height, options)` | `new Frame(new Image(width, height), options)` |
| `Frame.from(image, options)` | `new Frame(image.clone(), options)`, or `new Frame(image, options)` without the copy |
| `frame.blur(2)`, `frame.fill(color)`, `frame.bitmap`, `frame.gainMap`, ... | `frame.image.blur(2)`, `frame.image.fill(color)`, `frame.image.bitmap`, `frame.image.gainMap`, ... |
| `image.composite(frame)`, `frame.encodePNG()` | `image.composite(frame.image)`, `frame.image.encodePNG()` |
| `frame instanceof Image` | `false` now |

The methods that change the size stay on the frame: `resize()` (including its `'contain'` and `'cover'` fit modes),
`scale()`, `crop()`, `trim()`, `rotate()`, `transform()`, `dropShadow()` and `outline()`. They move the offsets so the
frame stays in place in the animation (resizing scales the offsets, as if the whole animation was resized); see
[frames move their offsets](#frames-move-their-offsets-when-their-size-changes) for how that differs from 3.x.
`width`, `height`, `clone()` and `toString()` work as before. Everything else goes through `frame.image`. The image's
own methods don't know about the frame and leave the offsets alone: after `frame.image.rotate(90)`, the frame's top
left corner stays where it was, and the turned image hangs from it.

### Checked values and the canvas

Values that were only checked when they were used are now checked when they are set: `frame.duration`,
`frame.xOffset` and `frame.yOffset` (a finite number, truncated to an integer for the offsets; a duration from 0), and the parameters of a `GainMap` (finite,
1 or 3 values per channel, a gamma above 0, `hdrCapacityMin` from 0, `useBaseColorSpace` a boolean). An invalid value
throws a `RangeError` (a `TypeError` for `useBaseColorSpace`) and the old value stays.

An `Animation` now has a canvas size of its own: `animation.width` and `animation.height` are the decoded file's, the
one given as `new Animation(frames, { width, height })` (`AnimationCanvasOptions`), or the one `resize()` and `crop()` set.
Without one, they are the frames' right and bottom edge, as in 3.x. Frames, or the parts of them, outside the canvas
aren't encoded.

The encoders return `Promise<Uint8Array<ArrayBuffer>>`, so their output goes into `new Blob()`, `new Response()` and
`crypto.subtle` without a cast. This needs TypeScript 5.7 or newer.

## Methods that take options refuse other arguments

A method that takes options now throws a `TypeError` when its argument is anything other than an object (or left out).
That covers numbers, strings, booleans and `null`. The message names the form that works, for example:

```text
TypeError: cropCircle() takes an options object, like cropCircle({ size: 'cover' }), not boolean
```

This is how the positional calls you missed show up at runtime. It applies to every method that takes options,
including `cropCircle()`, `Image.renderText()`, `quantize()`, `transform()`, `dropShadow()`, `outline()`, the
gradients, `Image.decode()`, the encoders, `Animation.decode()` and `new GainMap()`. Only the type of the argument is
checked: a key that isn't an option is ignored, so a typo like `{ maxWith: 300 }` is not caught at runtime (TypeScript
reports it for an inline object).

## Checklist

Grep patterns for the affected code. They find candidates; read each hit, because some names are used by other code
(for example `.encode(` on a non-image object).

```sh
# constants and modes
grep -rnE 'RESIZE_|SVG_MODE_|DISPOSAL_|ResizeModes|FrameDisposalModes' src

# encode() on images, and the color helpers
grep -rnE '\.encode\(' src
grep -rnE 'rgbaToColor|rgbToColor|hslaToColor|hslToColor|rgbaToHSLA|colorToRGBA?|Image\.gradient' src

# iteration over images
grep -rnE 'iterateWithColors|for \(const \[[a-z]+, ?[a-z]+\] of' src

# types and classes
grep -rnE 'PNGMetadata|AnimationEncoderOptions|AdjustOptions|TextOptions|FrameDisposalModeId|FrameDisposalModeName|SVGOptions|\bTextStyle\b|\bGIF\b' src

# decode and animations
grep -rnE 'decode\(.*, *(true|false)\)' src
grep -rnE 'loopCount\s*(:|=|===)\s*-1|loopCount\s*<\s*0' src
grep -rnE 'Array\.isArray|\.slice\(|\.frames\b|\.length\s*=' src

# frames and animations: constructors and positional arguments
grep -rnE 'new (Frame|Animation|GIF)\(|Frame\.from\(|Animation\.decode\(' src
grep -rnE '\.(encodeGIF|encodeAPNG|encodeJPEG|encodePNG)\(\s*[0-9]' src

# options that were positional
grep -rnE "\.(resize|scale|contain|fit|cover)\([^)]*, *(['\"]|ResizeModes\.|SVGScaleModes\.)" src
grep -rnE '\.(composite|rotate|sharpen|dominantColor|roundCorners|fisheye|trim|colorToAlpha)\([^)]' src
grep -rnE 'renderSVG\(|renderText\(|cropCircle\(' src
grep -rnE '\.(red|green|blue|opacity|lightness|saturation)\([^)]*,' src

# renamed and reshaped in 4.0
grep -rnE '\.(contain|fit)\(|greyscale|drawBox|drawCircle|SVGScaleMode|TextLayout|AnimationDecodeOptions|gainMapM(in|ax)' src
grep -rnE 'fromHSLA?\(|toHSLA\(|\.rotate\(|renderSVG\([^)]*(size|mode)|layout:|getRGBAAt|\.region\(' src
grep -rnE 'encodeGIF\(|gifEncoder\(|GIFEncodeOptions|encodeJPEG\(' src

# frames: anything an Image does, on a frame, and the size changes that move the offsets now
grep -rnE 'new Frame\(|Frame\.from\(|frame\w*\.[a-zA-Z]+\(' src

# behavior changes without a compile error
grep -rnE 'maxWidth|maxHeight|wrapHardBreaks|\.(rotate|quantize|contain|encodeJPEG|dominantColor)\(|from(HSLA?)\(|toHSLA\(' src
grep -rnE 'compression:|[xy]Offset|\.bitmap =|renderSVG\(|Creation Time|DateTime' src

# GainMap
grep -rnE 'gainMap\.encode\(|\.encode\(\s*[0-9]' src
```

Also search for the variables that hold animations, and for `[0]`, `.map(`, `.filter(` and `.forEach(` on them: the
search can't tell an animation from an array, so check the type of each receiver.

Then compile with `tsc`, and run the tests that cover your decode and encode paths. The fourteen behavior changes need
runtime checks: a file with several frames, a one-frame GIF, any `loopCount: -1`, every resize fit mode, every HSL hue,
every `rotate()`, every `dominantColor()` threshold, all text rendered with a size, every JPEG made from an image with transparency, every `quantize()`, the size changes of frames, the
values that now throw, anything that reads the metadata of encoded files, and every SVG with images.
