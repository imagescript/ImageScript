# Migrating to 4.0

ImageScript 4.0 removes everything 3.x deprecated, and changes five behaviors. Most of the removals are mechanical:
the compiler points at them. The five behavior changes are not deprecations, nothing warns about them, and code can
keep compiling while it does something else. Read the first section even if your build is clean.

Node.js 22.13 or newer is required, as it was for 3.x (`engines` in `package.json`).

The recommended path:

1. Upgrade to the latest 3.x release. Everything still works. Editors show the deprecated APIs with a
   strikethrough, and the deprecation text names the replacement. `tsc` doesn't fail on them, so use the editor's
   problems list, or a lint rule for deprecated APIs (typescript-eslint has `no-deprecated`), to get the full list.
2. Fix every deprecation hint, using the tables below.
3. Switch to 4.0 and go through the five behavior changes. The [checklist](#checklist) at the end has grep patterns
   for finding the code they affect.

## Behavior changes

These change what code does without a compile error.

### `decode()` returns an `Animation` for files with several frames

In 3.x, `decode()` returned a `GIF` for every GIF, including a GIF with one frame, an `Animation` for an animated WebP,
and an `Image` for everything else. An APNG or a JPEG XL with several frames decoded to its first frame, as an `Image`.

In 4.0, a file with several frames (GIF, APNG, animated WebP or JPEG XL) decodes to an `Animation`. A file with one
frame decodes to an `Image`, like a still image, so a one-frame GIF is an `Image` now.

```ts
// 3.x: a GIF was a GIF, which is an Animation with encode()
const gif = await decode(data);
const out = await gif.encode(90);

// 4.0: check what you got
import { Animation, decode } from 'imagescript';

const decoded = await decode(data);
if (decoded instanceof Animation) {
  const out = await decoded.encodeGIF({ quality: 90 });
}
```

`Image.decode()` returns the first frame of an animated GIF or WebP, which threw in 3.x. The frame is an `Image` composed
onto the canvas like the first frame of `Animation.decode()`, and decoding stops after it, so it is fast for a long
animation. Use `Animation.decode()` for all the frames. An APNG still gives its default image, as before.

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
animation.frames.push(frame);
const copy = new Animation(animation.frames.slice(0, 10), { loopCount: animation.loopCount });
const widths = animation.frames.map(f => f.width);
```

These still work: `for (const frame of animation)`, `[...animation]`, `Array.from(animation)`, `animation.length` and
the methods of `Animation` itself (`resize()`, `encodeGIF()`, `width`, `duration`, ...). `Array.isArray(animation)` is
`false` now.

Two details: `animation.length` is read-only, so `animation.length = 0` throws. Assigning `animation.frames = list`
copies `list` into a new array, so later changes to `list` don't reach the animation. Change `animation.frames` instead.

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

The finite counts are the same: `0` plays once, `2` plays three times. The valid values are `Infinity` and integers from
0 ({@link AnimationOptions.loopCount}). `-1` throws a `RangeError`, like other negative numbers, `NaN` and fractions. Numeric strings, `null` and booleans
throw a `TypeError`. The check applies to the constructor, to the setter `animation.loopCount = ...` (which keeps the
old count when it throws), and to the encoders `Animation.gifEncoder()`, `webpEncoder()` and `apngEncoder()`.

The formats store a finite count in fixed-size fields: a GIF up to `65535`, a WebP up to `65534` and an APNG up to
`2147483646` (2^31 - 2). A larger count throws a `RangeError` before anything is encoded, from `encodeGIF()`,
`encodeWebP()`, `encodeAPNG()` and the streaming encoders. (Before, a GIF with `65536` loops wrapped to `0`, which is
forever.) `Infinity` is always fine.

Search your code for: `loopCount: -1`, `loopCount = -1`, `loopCount === -1` and `loopCount < 0`.

### `contain()` pads to the box

`image.contain(width, height)` now works like CSS' `object-fit: contain`: the image is resized to fit inside the box
and centered on a canvas of exactly that size, with transparent bars (or the `background` color). That is what
`fit()` did in 3.x; `fit()` is removed. 3.x's `contain()`, which only resized and could return a smaller image, is
`resize({ width, height, fit: 'inside' })`.

| 3.x | 4.0 |
| --- | --- |
| `image.contain(800, 600)` (at most 800x600, no bars) | `image.resize({ width: 800, height: 600, fit: 'inside' })` |
| `image.fit(800, 600)` (exactly 800x600, transparent bars) | `image.contain(800, 600)`, or `image.contain(800, 600, { background: 0x000000ff })` for black bars |

### Hues are in degrees

`Colors.fromHSL()`, `Colors.fromHSLA()` and `Colors.toHSLA()` take and return the hue in degrees (0-360, like CSS'
`hsl()` and like `hueShift()`), no longer as a fraction (0-1). Saturation, lightness and alpha stay 0-1. An old hue
still works without an error, but gives a different color: `Colors.fromHSL(0.5, 1, 0.5)` was cyan and is now red.

| 3.x | 4.0 |
| --- | --- |
| `Colors.fromHSL(h, s, l)` with `h` in 0-1 | `Colors.fromHSL(h * 360, s, l)` |
| `Colors.toHSLA(color)[0]` in 0-1 | `Colors.toHSLA(color)[0] / 360` for the old value |

## Removed APIs

Each table maps a 3.x API to its 4.0 replacement. The deprecation hint in 3.x gives the same mapping. The replacements
are documented on their own pages: {@link ResizeModes}, {@link FrameDisposalModes},
{@link Colors}, {@link Frame}, {@link Animation}, {@link AnimationEncoder} and {@link Metadata}.

### Constants and modes

| 3.x | 4.0 |
| --- | --- |
| `Image.RESIZE_NEAREST_NEIGHBOR` | `ResizeModes.NEAREST_NEIGHBOR` (`'nearest-neighbor'`) |
| `Image.RESIZE_BILINEAR` | `ResizeModes.BILINEAR` (`'bilinear'`) |
| `Image.RESIZE_BICUBIC` | `ResizeModes.BICUBIC` (`'bicubic'`) |
| `Image.RESIZE_AREA` | `ResizeModes.AREA` (`'area'`) |
| `Image.RESIZE_AUTO`, `ResizeModes.AUTO` | Pass only the width or the height: `image.resize({ width: 256 })` |
| The upper-case mode strings, `'RESIZE_BILINEAR'` and the others | The lower-case names, `'bilinear'` and the others |
| The `ResizeMode` type, with the upper-case strings or the numbers 1-3 | Narrowed to the lower-case names: `'nearest-neighbor'`, `'bilinear'`, `'bicubic'` or `'area'` |
| The `SVGScaleMode` type | Removed with the SVG modes, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_SCALE` (or `1`) | `Image.renderSVG(svg, { scale: 2 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_WIDTH` (or `2`) | `Image.renderSVG(svg, { width: 512 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Image.SVG_MODE_HEIGHT` (or `3`) | `Image.renderSVG(svg, { height: 512 })`, see [renamed APIs](#renamed-and-reshaped-apis) |
| `Frame.DISPOSAL_ANY`, `Frame.DISPOSAL_KEEP`, `Frame.DISPOSAL_PREVIOUS`, `Frame.DISPOSAL_BACKGROUND` | `FrameDisposalModes.ANY`, `.KEEP`, `.PREVIOUS`, `.BACKGROUND` |
| Numeric disposal ids: `frame.disposalMode = 3`, `disposalMode: 3` in the frame options | The names: `frame.disposalMode = 'background'`, `disposalMode: 'background'`. `FrameDisposalModeId` is removed |

The old string and number values are not accepted any more, so `image.resize(256, 256, 'RESIZE_BICUBIC')` throws.

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

The color helpers take the same arguments and return the same values, so `Image.rgbaToColor(...)` becomes
`Colors.fromRGBA(...)` and nothing else changes. `Colors` is exported from the package.

### Channel methods and `absolute`

`opacity()`, `red()`, `green()`, `blue()`, `lightness()` and `saturation()` only scale now. The `absolute` argument is
removed, and so is the `AdjustOptions` type. A second argument throws a `TypeError` before the image is touched, so
`image.red(0.5, true)` fails loudly instead of scaling.

| 3.x | 4.0 |
| --- | --- |
| `image.opacity(0.5)`, `image.red(0.5)` (scale) | Unchanged |
| `image.red(0.5, true)`, `image.opacity(0.5, true)`, `image.lightness(0.5, true)` | See below |
| `AdjustOptions` (type) | Removed with `absolute`: the channel methods take the factor only |
| `image.red(0.5, { absolute: true })` | See below |

The extra argument throws a `TypeError` in 4.0, so `image.red(0.5, true)` fails at the call, in JavaScript and in untyped
code, before the image is touched. (Had it been ignored, it would have scaled the channel: on a pixel with red 0 the
result stays 0, where 3.x's `absolute` set it to 128.) `tsc` reports the call as `Expected 1 arguments, but got 2`.

For a fixed color, use `image.recolor(color)`. It sets the RGB of every pixel and keeps each pixel's alpha. The 3.x
`absolute` calls set one channel of every pixel to a value, and `recolor()` has no equivalent for a single channel. Set
the bytes yourself when you need it, on an image without a gain map:

```ts
// 3.x: every pixel's red channel to 128
image.red(0.5, true);

// 4.0
for (let i = 0; i < image.bitmap.length; i += 4) image.bitmap[i] = 0.5 * 255;
```

`bitmap` is RGBA, four bytes per pixel. Writing it directly skips the gain map of an HDR image, so do not use it on
images that have one. `absolute` on `lightness()` and `saturation()` sets the value of every pixel and keeps its hue. Do it per pixel:
read the color with `Colors.toHSLA()`, set the lightness or saturation, and write the pixel back with
`Colors.fromHSLA()`.

### Animations and GIF

| 3.x | 4.0 |
| --- | --- |
| `new GIF(frames, loopCount)` | `new Animation(frames, { loopCount })` |
| `GIF.decode(data)` | `Animation.decode(data)`, which decodes APNGs and WebPs too |
| `gif.encode(quality)` | `animation.encodeGIF({ quality })` |
| `GIF` (the class, also in `instanceof`) | `Animation`. `GIF` is no longer exported |
| `animation.slice(start, end)` | `new Animation(animation.frames.slice(start, end), { loopCount: animation.loopCount })` |
| `animation[i]` and the array methods | `animation.frames[i]` and `animation.frames.<method>` |
| `AnimationEncoder.frames` | `AnimationEncoder.frameCount` |
| `toString()` of a GIF, `GIF<64x64x1000ms>` | `Animation<64x64x1000ms>` |

The option types of the animation encoders are renamed, and each one takes `loopCount` through `AnimationOptions`:

| 3.x | 4.0 |
| --- | --- |
| `AnimationEncoderOptions` | `AnimationEncodeOptions & AnimationOptions` |
| `WebPAnimationEncoderOptions` | `WebPAnimationEncodeOptions & AnimationOptions` |
| `GIFAnimationEncoderOptions` | `GIFEncodeOptions & AnimationOptions` |
| `APNGAnimationEncoderOptions` | `APNGEncodeOptions & AnimationOptions` |

### Text, crop and metadata

| 3.x | 4.0 |
| --- | --- |
| `Image.renderText(font, size, text)` | `Image.renderText(text, { font, size })` |
| `Image.renderText(font, size, text, color, layout, style)` | `Image.renderText(text, { font, size, color, layout, ...style })` |
| `Image.renderText(font, size, text, options)` | `Image.renderText(text, { font, size, ...options })` |
| `TextOptions` (type) | `RenderTextOptions` |
| `layout: { verticalAlign: 'right' }`, `horizontalAlign: 'bottom'` (the other axis' values) | `horizontalAlign` takes `'left'`, `'center'` or `'right'`, `verticalAlign` takes `'top'`, `'middle'` or `'bottom'`. Other values throw a `TypeError` |
| `image.cropCircle(true)` | `image.cropCircle({ size: 'cover' })` |
| `image.cropCircle(true, feathering)` | `image.cropCircle({ size: 'cover', feathering })` |
| `image.cropCircle(false)` | `image.cropCircle()`, the default `size: 'contain'` |
| `image.cropCircle({ max: true })` | `image.cropCircle({ size: 'cover' })` |
| `PNGMetadata` (type) | `Metadata`, which all encoders take |

`renderText()` takes the text first. The font, the size, the color and the layout are all in the options object, and
`layout` takes the layout options (a plain object, see {@link TextLayoutOptions}). The options are documented in {@link RenderTextOptions}.
Crop options are in {@link CropCircleOptions}. A key that is not an option is ignored without an error, so
`cropCircle({ max: true })` quietly becomes the default `contain`: change it to `size: 'cover'`.

### Positional arguments

Methods that took options as their last positional arguments take the options object now. The values go into the
object under the names of their options. The options of each method are on its own page, for example
{@link ResizeOptions}, {@link CompositeOptions}, {@link RotateOptions}, {@link SharpenOptions},
{@link DominantColorOptions}, {@link RoundCornersOptions}, {@link FisheyeOptions}, {@link TrimOptions},
{@link ColorToAlphaOptions}, {@link PNGEncodeOptions}, {@link JPEGEncodeOptions}, {@link SVGOptions} and
{@link FrameOptions}. The animation options are {@link GIFEncodeOptions}, {@link APNGEncodeOptions},
{@link DecodeOptions} and {@link GainMapEncodeOptions} for `GainMap.encode()`.

| 3.x | 4.0 |
| --- | --- |
| `image.resize(256, 256, 'bicubic')`, `image.resize(256, 256, ResizeModes.AREA)` | `image.resize(256, 256, { mode: 'bicubic' })` |
| `image.scale(0.5, 'area')`, `image.scale(0.5, ResizeModes.AREA)` | `image.scale(0.5, { mode: 'area' })` |
| `image.resize(100)` (width only, the height left out) | `image.resize({ width: 100 })`, which keeps the aspect ratio. The positional form throws a `TypeError` without a height |
| `image.contain(w, h, mode)`, `image.fit(w, h, mode)`, `image.cover(w, h, mode)` | `image.resize({ width: w, height: h, fit: 'inside', mode })`, `image.contain(w, h, { mode })` and `image.cover(w, h, { mode })`, see [`contain()` pads to the box](#contain-pads-to-the-box) |
| `Frame` and `Animation`: `resize(w, h, mode)` | `resize(w, h, { mode })` |
| `image.composite(logo, 10, 20, { opacity: 0.5 })` | `image.composite(logo, { x: 10, y: 20, opacity: 0.5 })` |
| `image.rotate(45, false)` | `image.rotate(45, { expand: false })` |
| `image.sharpen(2, 3)` | `image.sharpen({ amount: 2, radius: 3 })` |
| `image.dominantColor(true, true, 15)` | `image.dominantColor({ ignoreBlack: true, ignoreWhite: true, threshold: 15 })` |
| `image.roundCorners(8)` | `image.roundCorners({ radius: 8 })` |
| `image.fisheye(3)` | `image.fisheye({ strength: 3 })` |
| `image.trim(color, options)`, `frame.trim(color, options)` | `image.trim({ color, ...options })` |
| `image.colorToAlpha(color, options)` | `image.colorToAlpha({ color, ...options })` |
| `image.encodePNG(1, { author })` | `image.encodePNG({ compression: 1, metadata: { author } })` |
| `image.encodePNG({ author })` (metadata alone) | `image.encodePNG({ metadata: { author } })`. The old form throws, see below |
| `image.encodeJPEG(90)` | `image.encodeJPEG({ quality: 90 })` |
| `animation.encodeGIF(90)` | `animation.encodeGIF({ quality: 90 })` |
| `animation.encodeAPNG(9)` | `animation.encodeAPNG({ compression: 9 })` |
| `gainMap.encode(90)` | `gainMap.encode({ quality: 90 })` |
| `Image.renderSVG(svg, 512, 'width')` | `Image.renderSVG(svg, { width: 512 })` (and `{ height }`, `{ scale }`) |
| `new Frame(w, h, duration, x, y, disposal)` | `new Frame(w, h, { duration, xOffset, yOffset, disposalMode })` |
| `Frame.from(image, duration, x, y, disposal)` | `Frame.from(image, { duration, xOffset, yOffset, disposalMode })` |
| `new Animation(frames, loopCount)` | `new Animation(frames, { loopCount })` |
| `Animation.decode(data, true)` | `Image.decode(data)` for the first frame, `Animation.decode(data)` for all |
| `decode(data, true)` | `Image.decode(data)` |
| `decode(data, { onlyFirstFrame: true })` | `Image.decode(data)` |

`decode()` and `Animation.decode()` take options only: a boolean throws a `TypeError` that names the options form.

`encodePNG()` also throws when the metadata is passed without `metadata`. In 3.x, `image.encodePNG({ author })` was
read as metadata; in 4.0 it would be ignored, so it throws a `TypeError` that names `{ metadata }`.

## Renamed and reshaped APIs

These changed in 4.0 without a deprecation in 3.x. Most are compile errors in TypeScript; in JavaScript, and for
options objects that aren't written inline, an old option key is ignored without an error (`rotate(45, { resize:
false })` grows the image again), so search for them too.

| 3.x | 4.0 |
| --- | --- |
| `image.rotate(angle, { resize: false })` | `image.rotate(angle, { expand: false })`, like `transform()`, `outline()` and `dropShadow()` |
| `Image.renderSVG(svg, { size: 512, mode: 'width' })`, `{ mode: 'height' }` | `Image.renderSVG(svg, { width: 512 })`, `{ height: 512 }` |
| `Image.renderSVG(svg, { size: 2 })`, `{ size: 2, mode: 'scale' }` | `Image.renderSVG(svg, { scale: 2 })` |
| `SVGScaleModes`, `SVGScaleMode` | Removed, see the two rows above |
| `image.drawBox(x, y, w, h, color)` | `image.composite(new Image(w, h).fill(color), { x, y })`. It blends a translucent color over the image; `drawBox()` replaced the pixels |
| `image.drawCircle(x, y, r, color)` | `image.composite(new Image(2 * r, 2 * r).fill(color).cropCircle(), { x: x - r, y: y - r })` |
| `image.greyscale()` | `image.grayscale()` (the whole API spells American English) |
| `new TextLayout(options)`, `layout: new TextLayout(options)` | `layout: options`, a plain object ({@link TextLayoutOptions}); the class isn't exported |
| `AnimationDecodeOptions` (type) | `DecodeOptions`, which `Image.decode()`, `Animation.decode()` and `decode()` all take |
| `EncodeOptions` (type) as the options of `encodeTGA()` | `TGAEncodeOptions`. `EncodeOptions` is now the `metadata` that all encoder options extend |
| `new GainMap(image, { gainMapMin, gainMapMax })`, `map.gainMapMin`, `map.gainMapMax` | `new GainMap(image, { min, max })`, `map.min`, `map.max` |
| `setPixelAt(x, y, pixelColor)`, `lightness(value)`, `saturation(value)` (parameter names only) | `setPixelAt(x, y, color)`, `lightness(factor)`, `saturation(factor)` |

Values that were only checked when they were used are now checked when they are set: `frame.duration`,
`frame.xOffset` and `frame.yOffset` (a finite number, a duration from 0), and the parameters of a `GainMap` (finite,
1 or 3 values per channel, a gamma above 0, `hdrCapacityMin` from 0, `useBaseColorSpace` a boolean). An invalid value
throws a `RangeError` (a `TypeError` for `useBaseColorSpace`) and the old value stays.

An `Animation` now has a canvas size of its own: `animation.width` and `animation.height` are the decoded file's, the
one given as `new Animation(frames, { width, height })`, or the one `resize()`, `crop()`, `contain()` and `cover()` set.
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

This is how the positional calls you missed show up at runtime. It applies to every method that took options in 3.x,
including `cropCircle()`, `Image.renderText()`, `quantize()`, `transform()`, `dropShadow()`, `outline()`, the
gradients, `Image.decode()`, the encoders, `Animation.decode()`, `new GainMap()` and the `layout` of `Image.renderText()`.

## Checklist

Grep patterns for the affected code. They find candidates; read each hit, because some names are used by other code
(for example `.encode(` on a non-image object).

```sh
# constants and modes
grep -rnE 'RESIZE_|SVG_MODE_|DISPOSAL_' src

# encode() on images, and the color helpers
grep -rnE '\.encode\(' src
grep -rnE 'rgbaToColor|rgbToColor|hslaToColor|hslToColor|rgbaToHSLA|colorToRGBA?|Image\.gradient' src

# iteration over images
grep -rnE 'iterateWithColors|for \(const \[[a-z]+, ?[a-z]+\] of' src

# types and classes
grep -rnE 'PNGMetadata|AnimationEncoderOptions|AdjustOptions|TextOptions|FrameDisposalModeId|\bGIF\b' src

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
grep -rnE 'fromHSLA?\(|toHSLA\(|rotate\([^)]*resize|renderSVG\([^)]*(size|mode)' src

# GainMap
grep -rnE 'gainMap\.encode\(|\.encode\(\s*[0-9]' src
```

Also search for the variables that hold animations, and for `[0]`, `.map(`, `.filter(` and `.forEach(` on them: the
search can't tell an animation from an array, so check the type of each receiver.

Then compile with `tsc`, and run the tests that cover your decode and encode paths. The five behavior changes need
runtime checks: a file with several frames, a one-frame GIF, any `loopCount: -1`, every `contain()` and every HSL
hue in your code.
