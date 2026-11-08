import * as png from './codecs/png.ts';
import * as jpeg from './codecs/jpeg.ts';
import * as tiff from './codecs/tiff.ts';
import * as webp from './codecs/webp.ts';
import * as gif from './codecs/gif.ts';
import * as tga from './codecs/tga.ts';
import * as bmp from './codecs/bmp.ts';
import * as ico from './codecs/ico.ts';
import * as qoi from './codecs/qoi.ts';
import * as netpbm from './codecs/netpbm.ts';
import * as hdr from './codecs/hdr.ts';
import * as avif from './codecs/avif.ts';
import * as avifEnc from './codecs/avif-enc.ts';
import { availableThreads } from './util/threads.ts';

// (worker threads: the processors available, at most 8)
const defaultThreads = (): number => Math.max(1, Math.min(availableThreads(), 8));
const checkThreads = (threads: number): void => {
    if (!Number.isInteger(threads) || threads < 1) throw new RangeError(`threads must be a positive integer, not ${threads}`);
};
import * as jxl from './codecs/jxl.ts';
import type { ToneMapping } from './codecs/hdr.ts';
import * as quantize from './codecs/quantize.ts';
import * as textRenderer from './render/text.ts';
import * as svgRenderer from './render/svg.ts';
import { BinaryData, view } from './util/mem.ts';
import { cicpTransform, colorSpaceTransform, profileTransform } from './util/icc.ts';
import { ImageType } from './image-type.ts';
import { TextLayout, TextLayoutOptions } from './text-layout.ts';
import { Metadata, resolveMetadata, pngText, exifData } from './metadata.ts';
import { encode as utf8 } from './util/utf8.ts';
import { resample, BOX, TRIANGLE, CUBIC, type Region } from './util/resample.ts';
import { gaussianBlur, boxBlurRGBA, premultiply, unpremultiply } from './util/blur.ts';
import { Colors, wrapHue, hue2rgb } from './colors.ts';
import { isOptions, checkOptions, finite, color as checkColor, quality as checkQuality, effort as checkEffort, compressionLevel } from './util/options.ts';
import { MAX_PIXELS, decoding } from './util/limits.ts';
import { GainMap } from './gainmap.ts';
import * as gain from './util/gain.ts';
import { multiply, invert } from './util/matrix.ts';
import { sampleAffine } from './util/affine.ts';
import * as gainMapCodec from './codecs/gainmap.ts';

/** A color as a 32-bit RGBA integer (`0xRRGGBBAA`) */
export type Color = number;

/** Called with a pixel's (0-based) coordinates, returns its color */
export type ColorFunction = (x: number, y: number) => Color;

/**
 * The resampling filters of {@link Image.resize} and the other scaling functions (`image.resize({ width: 256, mode:
 * 'bicubic' })`):
 * - `'nearest-neighbor'`: each output pixel takes the nearest source pixel (hard pixels, for pixel art)
 * - `'bilinear'` (the default): when shrinking, the filter widens with the scale factor, so every source pixel
 *   contributes
 * - `'bicubic'`: Catmull-Rom, sharper than bilinear, especially when enlarging
 * - `'area'`: area averaging (box filter), every output pixel is the average of the source pixels it covers. Meant for
 *   shrinking
 */
export type ResizeMode = 'nearest-neighbor' | 'bilinear' | 'bicubic' | 'area';

/** Blend modes of {@link Image.composite}, named like CSS' mix-blend-mode values */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
    | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'add';

/** Options of {@link Image.composite} */
export interface CompositeOptions {
    /** The x position to place the source at. Default: `0` */
    x?: number;
    /** The y position to place the source at. Default: `0` */
    y?: number;
    /** Opacity of the source (0..1). Default: `1` */
    opacity?: number;
    /** How the colors are mixed. Default: `'normal'` */
    mode?: BlendMode;
}

/**
 * The size for {@link Image.resize}, {@link Frame.resize} and {@link Animation.resize}, and how to resize: a side
 * that is missing follows from the other one, keeping the aspect ratio
 */
export interface ResizeToOptions extends ResizeOptions {
    /** The new width. Without it, it follows from the height */
    width?: number;
    /** The new height. Without it, it follows from the width */
    height?: number;
    /**
     * How a width and a height together are met: `'fill'` stretches the image to exactly that size, `'inside'` keeps
     * the aspect ratio and makes the image as large as fits inside it, so one side can be smaller (a thumbnail of at
     * most 800x600: `resize({ width: 800, height: 600, fit: 'inside' })`). For a box of exactly that size, see
     * {@link Image.contain} and {@link Image.cover}. Default: `'fill'`
     */
    fit?: 'fill' | 'inside';
}

/** Options of {@link Image.contain} */
export interface ContainOptions extends ResizeOptions {
    /** The color of the bars around the image where it doesn't fill the box. Default: `0x00000000` (transparent) */
    background?: Color;
}

/** Options of {@link Image.scale}, {@link Image.resize}, {@link Image.contain} and {@link Image.cover} */
export interface ResizeOptions {
    /** The resizing mode. Default: `'bilinear'` */
    mode?: ResizeMode;
    /**
     * Whether to round to 8 bits between the two passes, so two channels share the multiplications of both: about
     * 15-25% faster for opaque images, with 10-25% of the channel values a step off the precise result (instead of
     * about 1%, never more than 1). Transparent images are premultiplied to 8 bits like browsers do, which makes them
     * about twice as fast: what shows once they're composited differs by up to about 2 steps, pixels that are almost
     * transparent keep less of their color. Only affects `'bilinear'` and `'area'`,
     * down to about a third of the size. Default: `true`
     */
    fast?: boolean;
}

/** Options of {@link Image.sharpen} */
export interface SharpenOptions {
    /** How strongly to sharpen (0 does nothing). Default: `1` */
    amount?: number;
    /** The radius of the blur the image is compared with (larger values sharpen coarser details). Default: `1` */
    radius?: number;
}

// the dithering methods of Image.quantize()
const DITHER_METHODS = ['none', 'floyd-steinberg', 'atkinson', 'ordered'] as const;

/** Options of {@link Image.quantize}: either `colors` or `palette`, and the dithering */
export interface QuantizeOptions {
    /**
     * The number of colors to reduce the image to, an integer from 2 to 256. The palette is the image's own colors when
     * it has no more distinct ones than this, else colors chosen by median cut (the common colors get their own). Those
     * are averages of groups of similar colors, so e.g. pure black and white are only in it if the image has them in
     * quantity: give `palette` for exact colors. Default: `256`. Give `colors` or `palette`, not both
     */
    colors?: number;
    /**
     * A fixed palette (1 to 256 colors, e.g. a Game Boy's four greens) that every pixel is mapped to, the nearest color
     * by its RGB. The alpha of the palette's colors is ignored. Give `palette` or `colors`, not both
     */
    palette?: Color[];
    /**
     * How the rounding error of each pixel is handled, which makes gradients look smooth with few colors:
     * `'none'` (each pixel takes its nearest color), `'floyd-steinberg'` (the error goes to the next pixels, 7/16, 3/16,
     * 5/16 and 1/16), `'atkinson'` (the error goes to six neighbors, 1/8 each: lighter, more contrast), `'ordered'` (a
     * regular 4x4 pattern of thresholds, no error spreading). Rows alternate direction for the error diffusions.
     * Default: `'none'`
     */
    dither?: 'none' | 'floyd-steinberg' | 'atkinson' | 'ordered';
    /**
     * How strongly to dither, from `0` (no spreading or threshold, the same as `'none'`) to `1` (the full error or
     * threshold). Default: `1`
     */
    ditherStrength?: number;
}

/** How {@link Image.transform} samples the pixels between the source's */
export type TransformMode = 'nearest-neighbor' | 'bilinear' | 'bicubic';

// the sampling modes of Image.transform()
const TRANSFORM_MODES: readonly string[] = ['nearest-neighbor', 'bilinear', 'bicubic'];

/** Options of {@link Image.transform} */
export interface TransformOptions {
    /**
     * The point the transform is applied around, in pixels: a rotation turns around it, a scale grows from it.
     * Default: the middle of the image. It only decides where the result lies on a canvas that stays as large as the
     * image (`expand: false`)
     */
    origin?: {
        /** The x position of the point in pixels. Default: half the width */
        x?: number;
        /** The y position of the point in pixels. Default: half the height */
        y?: number;
    };
    /**
     * Whether to make the image as large as the transformed one, which then fills it (a rotated image grows to fit its
     * corners, a skewed one gets wider). Without it, the image keeps its size and the parts outside are lost. Frames
     * only grow up and left as far as their offset allows. Default: `true`
     */
    expand?: boolean;
    /**
     * How the pixels between the source's are sampled: `'nearest-neighbor'` (hard pixels, no smoothing, for pixel art),
     * `'bilinear'` (smooth), `'bicubic'` (sharper, slower, can overshoot a little at hard edges). Default: `'bilinear'`
     */
    mode?: TransformMode;
}

/** Options of {@link Image.dropShadow} */
export interface ShadowOptions {
    /** How far to move the shadow to the right (negative values: to the left), in pixels. Default: `0` */
    x?: number;
    /** How far to move the shadow down (negative values: up), in pixels. Default: `0` */
    y?: number;
    /** How soft the shadow's edge is: the standard deviation of a gaussian blur in pixels, like {@link Image.blur}. Default: `0` */
    blur?: number;
    /** How far to grow the shadow's shape before blurring it, in pixels. Default: `0` */
    spread?: number;
    /** The shadow's color, its alpha is the shadow's opacity. Default: `0x00000080` (50% black) */
    color?: Color;
    /**
     * Whether to make the image larger so the shadow isn't cut off. Without it, the image keeps its size and the part
     * of the shadow outside is lost. Default: `true`
     */
    expand?: boolean;
}

/** Options of {@link Image.outline} */
export interface OutlineOptions {
    /** The outline's width in pixels. Default: `1` */
    width?: number;
    /** The outline's color. Default: `0x000000ff` */
    color?: Color;
    /**
     * Whether to make the image larger so the outline isn't cut off. Without it, the image keeps its size and the
     * outline is cut where the image ends. Default: `true`
     */
    expand?: boolean;
}

/** The colors of a gradient, see {@link Image.linearGradient} */
export interface GradientOptions {
    /**
     * The colors along the gradient: their positions (0..1) and colors (`{ 0: 0xff0000ff, 0.5: 0xffff00ff, 1: 0x00ff00ff }`),
     * or just the colors, evenly spaced (`[0xff0000ff, 0x00ff00ff]`), like {@link Colors.gradient} takes them
     */
    stops: Record<number, Color> | Color[];
}

/** Options of {@link Image.linearGradient} */
export interface LinearGradientOptions extends GradientOptions {
    /**
     * The direction of the gradient in degrees, like CSS' `linear-gradient()`: `0` goes up, `90` to the right, `180`
     * down, `270` to the left. The first stop is at the start of the line through the center that touches the
     * corners. Default: `180`
     */
    angle?: number;
}

/** Options of {@link Image.radialGradient} */
export interface RadialGradientOptions extends GradientOptions {
    /** The x position of the center in pixels. Default: the middle of the image */
    x?: number;
    /** The y position of the center in pixels. Default: the middle of the image */
    y?: number;
    /** The radius of the last stop in pixels. Default: the distance to the farthest corner */
    radius?: number;
}

/** The options every encoder that writes metadata has */
export interface EncodeOptions {
    /** Metadata to include, see {@link Metadata} */
    metadata?: Metadata;
}

/**
 * How the encoders that can carry a gain map (JPEG, AVIF, JPEG XL) write {@link Image.gainMap}, see their `gainMap`
 * option
 */
export interface GainMapEmbedOptions {
    /**
     * The map's quality (1-100, like the format's `quality`; for JPEG XL 100 is lossless). Default: `90`
     */
    quality?: number;
    /** The map's size as a factor of the image's (0-1). Default: the map's own size */
    scale?: number;
}

/** Options of {@link Image.encodePNG} */
export interface PNGEncodeOptions extends EncodeOptions {
    /** The compression level (0-9), higher is smaller but slower. Default: `4` */
    compression?: number;
}

/** Options of {@link Image.encodeTGA} */
export type TGAEncodeOptions = EncodeOptions;

/** Options of {@link Image.encodeJPEG} */
export interface JPEGEncodeOptions extends EncodeOptions {
    /** The JPEG quality (1-100). Default: `90` */
    quality?: number;
    /**
     * Chroma subsampling: `'4:4:4'` keeps the full color resolution, `'4:2:0'` halves it (smaller, like most
     * cameras). Default: `'4:2:0'` up to quality 90, `'4:4:4'` above (like libjpeg-turbo's `cjpeg`)
     */
    subsampling?: '4:4:4' | '4:2:0';
    /**
     * Whether to write the image's {@link Image.gainMap} (an Ultra HDR JPEG, brighter on HDR displays), or how.
     * Default: `true` (written if there is one)
     */
    gainMap?: boolean | GainMapEmbedOptions;
}

/** Options of {@link Image.encodeWebP} */
export interface WebPEncodeOptions extends EncodeOptions {
    /**
     * Lossy compression (0-100, like libwebp's quality: 75 is its default): the image is encoded like cwebp encodes it
     * (with `-m` set to the effort), much smaller than lossless. Without it the image is encoded losslessly
     */
    quality?: number;
    /**
     * How much effort compression takes (0-6): higher is smaller but slower. Lossy (libwebp's method): 0-2 pick the
     * predictions by how close they are, 3 and up also by how many bits they take, 5 and 6 also optimize the
     * quantized values; the default `2` takes about a quarter of the time of 4 (cwebp's default) for files about 5%
     * larger. Lossless: 0 is a fast mode (photos in about a fifth of the time, graphics in about a third, files about
     * 6-8% larger), 1 takes about two thirds of the time for files up to 2% larger, 2 and up compress the most.
     * Default: `2`
     */
    effort?: number;
    /**
     * For lossy compression: convert to YUV like libwebp's sharp conversion (cwebp's `-sharp_yuv`, the same file),
     * which picks the color planes so that colored edges (red text on blue, thin colored lines) stay sharp instead of
     * bleeding. It takes about twice the time at the default effort; photos get about as large, images with many
     * hard color edges a lot larger (1200x800 red and blue squares: 2.7 times). Default: `false`
     */
    sharpYuv?: boolean;
    /**
     * For lossy compression, the alpha plane's quality (0-100, like cwebp's `-alpha_q`): below 100 its levels are
     * reduced (to 2-16 up to 70, 16-256 above), which makes it compress better; the alpha plane is lossless otherwise.
     * Default: `100`
     */
    alphaQuality?: number;
    /**
     * For lossless compression, at most this many worker threads search the predictors and prefix codes in parallel
     * (the same file, faster), `1` for none. Images under about 1.5 megapixels, and runtimes whose workers can't share
     * memory (browsers without cross-origin isolation), encode without them. Default: the processors available, at
     * most 8
     */
    threads?: number;
}

/** Options of {@link Image.roundCorners} */
export interface RoundCornersOptions {
    /** The radius of the corners. Default: a quarter of the smaller side */
    radius?: number;
}

/** Options of {@link Image.fisheye} */
export interface FisheyeOptions {
    /** The distortion strength (exponent of the radial mapping), higher values bulge the center more. Default: `2` */
    strength?: number;
}

/** Options of {@link Image.renderSVG} */
export interface SVGOptions {
    /**
     * The width in pixels, the height follows the SVG's aspect ratio. Give one of `width`, `height` and `scale`.
     * Default: the SVG's own width
     */
    width?: number;
    /** The height in pixels, the width follows the SVG's aspect ratio. Give one of `width`, `height` and `scale` */
    height?: number;
    /**
     * A factor of the SVG's own size (`2` renders it twice as large). Give one of `width`, `height` and `scale`.
     * Default: `1`
     */
    scale?: number;
    /**
     * Fonts for `<text>` (TrueType, OpenType): each text gets the face its `font-family`, `font-weight`, `font-style`
     * and `font-stretch` match best among them, by the names, weights and styles in the fonts (like browsers match
     * installed fonts). Generic families (`serif`, `sans-serif`, `monospace`, ...) are the first font that fits them,
     * other families and text without one get the first font's family; characters a face doesn't have come from the
     * other fonts (TrueType, OpenType or WOFF). Fonts the SVG embeds with `@font-face` (in data: URIs) are used too,
     * before these for their family names. Without any fonts text isn't rendered. Default: `[]`
     */
    fonts?: BinaryData[];
    /**
     * Images for the `<image>` elements (and `feImage`) by their `href`, the same string the SVG uses: with
     * `images: { 'logo.png': bytes }`, `<image href="logo.png" .../>` draws the image. Values are encoded images (PNG,
     * JPEG, WebP, GIF's first frame, ...) or {@link Image}s, decoded like data URI images are, and only for the hrefs
     * the SVG references. Nothing else is read: no files and no URLs, so an href that isn't given (and isn't a data URI)
     * draws nothing. SVG documents can't be given this way, use a data URI for them. Default: `{}`
     */
    images?: Record<string, BinaryData | Image>;
}

/** Options of {@link Image.renderText}: the font and size, the text color and layout, and its style (see {@link TextStyle}) */
export interface RenderTextOptions extends TextStyle {
    /**
     * TrueType (ttf/ttc), OpenType (otf) or WOFF font buffer to use, or several by priority: every character comes
     * from the first font that has it (e.g. `[text, emoji]`), the first one sets the line height. Color glyphs (COLR
     * layers and paints, CBDT and sbix bitmaps, as in emoji fonts) keep their colors. Text in any script is shaped
     * like browsers do (right to left and bidirectional text, Arabic joining, Indic conjuncts, marks)
     */
    font: BinaryData | BinaryData[];
    /** Font size in pixels (per em) */
    size: number;
    /** The text color. Default: `0xffffffff` */
    color?: Color;
    /** The text layout: wrapping, cutting off and alignment, see {@link TextLayoutOptions}. Default: `{}` */
    layout?: TextLayoutOptions;
}

/** Options of {@link Image.decode}, {@link Animation.decode} and {@link decode} */
export interface DecodeOptions {
    /**
     * Whether to rotate/mirror the image (or every frame) as its orientation tag says: Exif in JPEGs, TIFFs, PNGs
     * (also eXIf and XMP, and in APNGs) and WebPs (also animated ones), and JPEG XL's header. Default: `true`
     */
    applyOrientation?: boolean;
    /**
     * Whether to convert the colors of images with an embedded ICC profile (PNG, JPEG, WebP, AVIF, JPEG XL, TIFF), and
     * of AVIFs with other color primaries than sRGB's (Display P3, BT.2020), to sRGB, like browsers show them: wide
     * gamut photos (Display P3 from phones, Adobe RGB, ProPhoto) look as intended instead of washed out. Matrix/TRC
     * profiles (RGB and gray) are applied, relative colorimetric (colors outside sRGB are clipped); profiles with only
     * lookup tables, CMYK ones and ones that are sRGB anyway leave the pixels as they are. Default: `true`
     */
    applyColorProfile?: boolean;
    /**
     * The most pixels to decode: larger images throw a RangeError before anything that size is allocated, so small
     * files declaring huge images (decompression bombs) can't exhaust the memory. For {@link Animation.decode}, all
     * frames together (every frame is a full canvas). Default: `268402689` (16383², like sharp), `Infinity` for no
     * limit
     */
    maxPixels?: number;
    /**
     * How Radiance HDRs, PFMs and HDR (PQ or HLG) AVIFs and JPEG XLs, whose light can be brighter than (SDR) white,
     * become 8 bit sRGB: `'reinhard'` compresses the brightest parts like Reinhard's tone mapping operator does (the
     * brightest pixel becomes white, images no brighter than white stay as they are), `'clamp'` clamps everything
     * brighter than white. Default: `'reinhard'`
     */
    toneMapping?: ToneMapping;
    /**
     * Whether to read the gain maps of JPEGs (Ultra HDR, JPEG-R, ISO 21496-1, Apple's), AVIFs (tone mapped items) and
     * JPEG XLs (jhgm boxes, also of every frame of an animation) into {@link Image.gainMap}. Default: `true`
     */
    gainMap?: boolean;
    /**
     * At most this many worker threads decode in parallel (lossy JPEG XLs from 4 megapixels on, one per 2 megapixels
     * at most, lossless ones from 1.5 megapixels and 512 KiB on; AVIFs from 4 megapixels on: the conversion to RGB,
     * one per megapixel, and the tiles of grids), `1` for none. Default: the processors available, at most 8 (1 where
     * workers can't share memory)
     */
    threads?: number;
}

/** Options of {@link Image.encodeJXL} */
export interface JXLEncodeOptions extends EncodeOptions {
    /**
     * Lossy compression (0-100, like cjxl's `-q`: 90 is visually lossless, 100 lossless): higher is better and larger.
     * Without it the image is encoded losslessly
     */
    quality?: number;
    /**
     * How hard compression works: 0-2, faster to smaller. Lossy: 0 uses 8x8 DCTs only (like `cjxl -e 3`), 1 and 2
     * search their sizes like `cjxl -e 5` (2 tries more of the small ones), and 2 also stores text-like features that
     * repeat (the glyphs of screenshots) once, as patches like `cjxl -e 7`. Lossless: 0 is `cjxl -e 1`'s fast mode
     * (byte for byte), 1 and 2 like `cjxl -e 3` (about 15% smaller for photos, 13% for graphics; a few times slower).
     * Default: `1`
     */
    effort?: number;
    /**
     * At most this many worker threads compress in parallel (the same file, faster: lossy 2.3 times with 8 on a
     * 1920x1080 photo at effort 1, 3.8 times on 3840x2160; lossless 2.8 and 4.3 times), `1` for none. Small images
     * (lossy under about 1.5 megapixels at effort 0, 512x512 pixels at 1, 384x384 at 2; lossless under 724x724 and
     * always at effort 0), and runtimes whose workers can't share memory (browsers without cross-origin isolation)
     * encode without them.
     * Default: the processors available, at most 8
     */
    threads?: number;
    /**
     * Whether to write the image's {@link Image.gainMap} (brighter on HDR displays: a jhgm box, like libjxl's), or how.
     * Default: `true` (written if there is one)
     */
    gainMap?: boolean | GainMapEmbedOptions;
}

/** Options of {@link Image.encodeAVIF} */
export interface AVIFEncodeOptions extends EncodeOptions {
    /** 0-100, like avifenc's: higher is better and larger, 100 is lossless. Default: `60` */
    quality?: number;
    /** The quality of the alpha channel (if the image has transparency), like avifenc's. Default: `100` (lossless) */
    alphaQuality?: number;
    /** Chroma subsampling: `'4:4:4'` keeps the full color resolution, `'4:2:0'` halves it (smaller). Default: `'4:4:4'` */
    subsampling?: '4:4:4' | '4:2:0';
    /** How hard the encoder searches for the best modes: 0-2, faster to smaller. Default: `1` */
    effort?: number;
    /**
     * At most this many worker threads encode in parallel (the same file, faster: 2.9 times with 8 on a 1920x1080
     * photo at effort 1), `1` for none. Small images (under about 640x640 pixels at effort 0, 448x448 at 1, 320x320
     * at 2), and runtimes whose workers can't share memory (browsers without cross-origin isolation), encode without
     * them. Default: the processors available, at most 8
     */
    threads?: number;
    /**
     * Whether to write the image's {@link Image.gainMap} (brighter on HDR displays: a tone mapped item, like libavif
     * writes), or how. Default: `true` (written if there is one)
     */
    gainMap?: boolean | GainMapEmbedOptions;
}

/** Text style options of {@link Image.renderText} */
export interface TextStyle {
    /** Width of an outline around the glyphs in pixels. Default: `0` */
    strokeWidth?: number;
    /** Color of the outline. Default: `0x000000ff` */
    strokeColor?: Color;
    /**
     * Whether to run the hinting instructions of TrueType fonts, which align stems and edges with the pixel grid for
     * crisper text at small sizes (like Windows renders text); the glyphs of hinted fonts are then placed on whole
     * pixels. Fonts without instructions (and CFF/OpenType outlines) aren't affected. Default: `true`
     */
    hinting?: boolean;
    /**
     * OpenType features by their tags, for the whole text: `true` turns one on (like `tnum` for tabular numbers,
     * `smcp` for small caps, `ss01` for a stylistic set), `false` off (also the ones on by default, like `liga` or
     * `kern`), a number picks an alternate (`salt: 2`). Fonts without a feature ignore it. Default: `{}`
     */
    features?: Record<string, boolean | number>;
    /**
     * The instance of variable fonts, by their axes: `weight` (1-1000, like CSS's `font-weight`: 400 regular, 700
     * bold), `width` (percent of the normal width: 75 condensed, 125 expanded), `slant` (degrees, negative leans
     * right), `italic` (`true`/`false`), `opticalSize` (the size the glyphs are designed for, in pixels; default: the
     * font size, like browsers' `font-optical-sizing: auto`), and other axes by their 4-character tag (like Roboto
     * Flex's `GRAD: 50`). Values outside an axis's range are clamped, axes a font doesn't have are ignored, fonts
     * without axes aren't affected. Default: `{}` (the fonts' default instances)
     */
    variations?: Record<string, number | boolean>;
}

/** Options of {@link Image.cropCircle} */
export interface CropCircleOptions {
    /**
     * The circle's size: `'contain'` fits it inside the image (the smaller dimension is its diameter, no hard edges),
     * `'cover'` covers the image (the larger dimension is its diameter, the corners of a rectangular image stay
     * transparent on the shorter side). Default: `'contain'`
     */
    size?: 'contain' | 'cover';
    /** Share of the radius (0..1) over which the edge fades out. Default: `0` */
    feathering?: number;
}

/** Options of {@link Image.dominantColor} */
export interface DominantColorOptions {
    /** Whether to ignore dark colors (all channels below the threshold). Default: `true` */
    ignoreBlack?: boolean;
    /** Whether to ignore light colors (all channels above 255 minus the threshold). Default: `true` */
    ignoreWhite?: boolean;
    /** The black/white threshold (0-64, in steps of 4 channel values). Default: `15` */
    threshold?: number;
}

/** Options of {@link Image.rotate} */
export interface RotateOptions {
    /**
     * Whether to make the image larger so the rotated corners aren't cut off. Without it, the image keeps its size and
     * the parts outside are lost. Default: `true`
     */
    expand?: boolean;
    /**
     * How the pixels between the source's are sampled for angles that aren't multiples of 90° (those move whole
     * pixels): `'nearest-neighbor'` (hard pixels, for pixel art), `'bilinear'` (smooth) or `'bicubic'` (sharper, can
     * overshoot a little at hard edges), like {@link TransformOptions.mode}. Default: `'bilinear'`
     */
    mode?: TransformMode;
}

/** Options of {@link Image.trim} */
export interface TrimOptions {
    /**
     * The border color, by default the color of the top left pixel. Fully transparent pixels count as the same color
     * whatever their RGB values
     */
    color?: Color;
    /**
     * How far (0-1) a pixel's channels may be from the color for it to be trimmed, e.g. for JPEG artifacts or
     * antialiasing. Default: `0`
     */
    tolerance?: number;
}

/** Options of {@link Image.colorToAlpha} */
export interface ColorToAlphaOptions {
    /** The color to remove, by default the color of the top left pixel (e.g. a background) */
    color?: Color;
    /** Pixels at most this far from the color (0-1) become fully transparent. Default: 0 */
    transparencyThreshold?: number;
    /** Pixels at least this far from the color (0-1) stay fully opaque. Default: 1 */
    opacityThreshold?: number;
}

// OpenType features as tags and values (tags are 4 printable ASCII characters)
function featureList(features: Record<string, boolean | number>): Array<[string, number]> {
    if (typeof features !== 'object' || features === null) throw new TypeError('Features must be an object');
    return Object.entries(features).map(([tag, value]) => {
        if (!/^[\x20-\x7e]{4}$/.test(tag)) throw new RangeError(`Invalid OpenType feature tag: ${JSON.stringify(tag)}`);
        if (typeof value === 'boolean') return [tag, value ? 1 : 0];
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`Invalid value of the OpenType feature ${tag}: ${value}`);
        return [tag, value];
    });
}

/**
 * An RGBA image; provides the codecs and the manipulation functions. Methods that change the image modify it in place
 * and return it, so calls can be chained
 */
export class Image {
    /**
     * @internal
     * @ignore
     */
    protected __width__: number;
    /**
     * @internal
     * @ignore
     */
    protected __height__: number;
    /**
     * @internal
     * @ignore
     */
    protected __view__!: DataView;
    /**
     * @internal
     * @ignore
     */
    protected __u32__!: Uint32Array;
    /**
     * @internal
     * @ignore
     */
    protected __bitmap__!: Uint8ClampedArray;
    /**
     * @internal
     * @ignore
     */
    protected __gain_map__: GainMap | null = null;

    /**
     * Creates a new image with the given dimensions, all pixels transparent black
     * @param width The width in pixels
     * @param height The height in pixels
     */
    constructor(width: number, height: number) {
        width = ~~width;
        height = ~~height;

        if (width < 1)
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1)
            throw new RangeError('Image has to be at least 1 pixel high');

        this.__width__ = width;
        this.__height__ = height;
        this.__set_bitmap__(new Uint8ClampedArray(width * height * 4));
    }

    /**
     * The image's gain map, if it has one (JPEGs from phones, Ultra HDR): how much brighter each part gets on HDR
     * displays. {@link Image.encodeJPEG} writes it. `null` removes it
     */
    get gainMap(): GainMap | null {
        return this.__gain_map__;
    }

    /**
     * Replaces the gain map
     * @param gainMap The new gain map, or `null` to remove it
     */
    set gainMap(gainMap: GainMap | null) {
        if (gainMap !== null && !(gainMap instanceof GainMap)) throw new TypeError('The gain map has to be a GainMap or null');
        this.__gain_map__ = gainMap;
    }

    /**
     * The image's RGBA pixel data. It can be replaced by any 8-bit array with width * height * 4 bytes
     * (it is used as is, without copying)
     */
    get bitmap(): Uint8ClampedArray {
        return this.__bitmap__;
    }

    /**
     * Replaces the pixel data
     * @param bitmap The new RGBA data, width * height * 4 bytes (used as is, without copying)
     */
    set bitmap(bitmap: Uint8ClampedArray | Uint8Array) {
        if (!(bitmap instanceof Uint8ClampedArray || bitmap instanceof Uint8Array))
            throw new TypeError('The bitmap has to be a Uint8ClampedArray or Uint8Array');
        if (bitmap.length !== this.width * this.height * 4)
            throw new RangeError(`The bitmap has to have ${this.width * this.height * 4} bytes (width * height * 4), got ${bitmap.length}`);

        this.__set_bitmap__(bitmap instanceof Uint8ClampedArray ? bitmap : new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.length));
    }

    /**
     * Sets the pixel data and the views on it
     * @internal
     * @ignore
     */
    protected __set_bitmap__(bitmap: Uint8ClampedArray): void {
        // 32-bit views need an aligned offset
        if (bitmap.byteOffset % 4) bitmap = bitmap.slice();
        this.__bitmap__ = bitmap;
        this.__view__ = new DataView(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        this.__u32__ = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2);
    }

    /** A short description for debugging, e.g. `Image<64x64>` */
    toString(): string {
        return `Image<${this.width}x${this.height}>`;
    }

    /**
     * The images width
     */
    get width(): number {
        return this.__width__;
    }

    /**
     * The images height
     */
    get height(): number {
        return this.__height__;
    }

    /**
     * Yields an [x, y] array for every pixel in the image (0-based), row by row
     * @yields The coordinates of the pixel ([x, y])
     */
    *coordinates(): Generator<[x: number, y: number], void, undefined> {
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++)
                yield [x, y];
    }

    /**
     * Yields an [x, y, color] array for every pixel in the image (0-based), row by row
     * @yields The coordinates and color of the pixel ([x, y, color])
     */
    *pixels(): Generator<[x: number, y: number, color: Color], void, undefined> {
        const view = new DataView(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
        let offset = 0;
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++, offset += 4)
                yield [x, y, view.getUint32(offset, false)];
    }

    /**
     * Creates an image with a linear gradient, like CSS' `linear-gradient()`
     * @param width The image's width
     * @param height The image's height
     * @param options The colors and the direction, see {@link LinearGradientOptions}
     * @returns The new image
     */
    static linearGradient(width: number, height: number, options: LinearGradientOptions): Image {
        checkOptions(options, 'Image.linearGradient(100, 50, { stops, angle: 90 })');
        const { stops, angle = 180 } = options;
        const color = gradientFunction(stops);
        finite(angle, 'angle');
        const image = new Image(width, height);
        const radians = angle * Math.PI / 180;
        // the direction (y points down, 0 degrees up), and the length of the line through the center to the corners
        const dx = Math.sin(radians), dy = -Math.cos(radians);
        const length = Math.abs(width * dx) + Math.abs(height * dy);
        const cx = width / 2, cy = height / 2, bitmap = new DataView(image.bitmap.buffer, image.bitmap.byteOffset, image.bitmap.byteLength);
        for (let y = 0, i = 0; y < height; y++)
            for (let x = 0; x < width; x++, i += 4)
                bitmap.setUint32(i, color(((x + 0.5 - cx) * dx + (y + 0.5 - cy) * dy) / length + 0.5), false);
        return image;
    }

    /**
     * Creates an image with a radial (circular) gradient, like CSS' `radial-gradient(circle)`
     * @param width The image's width
     * @param height The image's height
     * @param options The colors and the circle, see {@link RadialGradientOptions}
     * @returns The new image
     */
    static radialGradient(width: number, height: number, options: RadialGradientOptions): Image {
        checkOptions(options, 'Image.radialGradient(100, 50, { stops })');
        const { stops, x: cx = width / 2, y: cy = height / 2, radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) } = options;
        const color = gradientFunction(stops);
        finite(cx, 'x');
        finite(cy, 'y');
        if (!(finite(radius, 'radius') > 0)) throw new RangeError('Invalid radius');
        const image = new Image(width, height);
        const bitmap = new DataView(image.bitmap.buffer, image.bitmap.byteOffset, image.bitmap.byteLength);
        for (let y = 0, i = 0; y < height; y++)
            for (let x = 0; x < width; x++, i += 4)
                bitmap.setUint32(i, color(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius), false);
        return image;
    }

    /**
     * Gets the pixel color at the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @returns The color value (`0xRRGGBBAA`)
     */
    getPixelAt(x: number, y: number): Color {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        return this.__view__.getUint32((y * this.width + x) * 4, false);
    }

    /**
     * Gets a view of the RGBA components of the pixel at the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @returns The pixel's 4 bytes in {@link Image.bitmap}: writing to them changes the pixel
     */
    getRGBAAt(x: number, y: number): Uint8ClampedArray {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        const idx = (y * this.width + x) * 4;
        return this.bitmap.subarray(idx, idx + 4);
    }

    /**
     * Sets the pixel color for the specified position (0-based)
     * @param x The x coordinate
     * @param y The y coordinate
     * @param color The new color (`0xRRGGBBAA`)
     */
    setPixelAt(x: number, y: number, color: Color): this {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        this.__check_boundaries__(x, y);
        this.__set_pixel__(x, y, checkColor(color));
        return this;
    }

    /**
     * @internal
     * @ignore
     */
    protected __set_pixel__(x: number, y: number, pixelColor: Color): void {
        this.__view__.setUint32((y * this.width + x) * 4, pixelColor, false);
    }

    /**
     * @internal
     * @ignore
     */
    protected __check_boundaries__(x: number, y: number): void {
        if (isNaN(x)) throw new TypeError(`Invalid pixel coordinates (x=${x})`);
        if (isNaN(y)) throw new TypeError(`Invalid pixel coordinates (y=${y})`);
        if (x < 0)
            throw new RangeError(`${Image.__out_of_bounds__} (x=${x})<0`);
        if (x >= this.width)
            throw new RangeError(`${Image.__out_of_bounds__} (x=${x})>=(width=${this.width})`);
        if (y < 0)
            throw new RangeError(`${Image.__out_of_bounds__} (y=${y})<0`);
        if (y >= this.height)
            throw new RangeError(`${Image.__out_of_bounds__} (y=${y})>=(height=${this.height})`);
    }

    /**
     * @private
     */
    /**
     * @internal
     * @ignore
     */
    protected static get __out_of_bounds__(): string {
        return 'Tried referencing a pixel outside of the images boundaries:';
    }

    /**
     * Fills the image data with the supplied color
     * @param color The color, or a function returning the color of each pixel
     */
    fill(color: Color | ColorFunction): this {
        const view = new DataView(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
        if (typeof color !== 'function') color = checkColor(color);
        // (the new pixels have no HDR light beyond their own: no boost anywhere)
        if (this.__gain_map__) this.__gain_map__ = gain.neutralMap(this.__gain_map__, this.width, this.width, this.height);

        if (typeof color === 'function') {
            let offset = 0;
            for (let y = 0; y < this.height; y++)
                for (let x = 0; x < this.width; x++, offset += 4)
                    view.setUint32(offset, color(x, y), false);
        } else {
            if (!this.bitmap.length) return this;
            view.setUint32(0, color, false);
            const u32 = new Uint32Array(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength / 4);
            u32.fill(u32[0]);
        }

        return this;
    }

    /**
     * Clones the current image
     */
    clone(): Image {
        // copying in the constructor of the array saves zeroing the memory first
        const image = new Image(1, 1);
        image.__width__ = this.width;
        image.__height__ = this.height;
        image.__set_bitmap__(new Uint8ClampedArray(this.bitmap));
        image.__gain_map__ = this.__gain_map__ ? this.__gain_map__.clone() : null;
        return image;
    }

    /**
     * Resizes the image by the given factor
     * @param factor The factor to resize the image with
     * @param options See {@link ResizeOptions}
     */
    scale(factor: number, options?: ResizeOptions): this;
    scale(factor: number, options?: ResizeOptions): this {
        checkOptions(options, 'scale(factor, { mode: \'area\' })');
        const { mode, fast } = resizeOptions(options);
        const image = this.__scale__(factor, mode, fast);
        this.__gain_map__?.__rescale__(this.width, this.height, image.width, image.height);
        return this.__apply__(image);
    }

    /** @private */
    /**
     * @internal
     * @ignore
     */
    protected __scale__(factor: number, mode: ResizeMode = 'bilinear', fast = true): Image {
        if (factor === 1) return this;
        return this.__resize__(this.width * factor, this.height * factor, mode, fast);
    }

    /**
     * Resizes the image to the given dimensions.
     * Pass {@link ResizeToOptions} with only a width or a height to keep the aspect ratio.
     * @param width The new width
     * @param height The new height
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    resize(width: number, height: number, options?: ResizeOptions): this;
    /**
     * Resizes the image: to the given width or height (the other side keeps the aspect ratio), or to both
     * @param options The size and how to resize, see {@link ResizeToOptions}
     * @returns The resized image
     */
    resize(options: ResizeToOptions): this;
    resize(widthOrOptions: number | ResizeToOptions, heightArgument?: number, optionsArgument?: ResizeOptions): this {
        const [width, height, options, fit] = resizeArguments(widthOrOptions, heightArgument, optionsArgument);
        const { mode, fast } = resizeOptions(options);
        const image = this.__resize__(...this.__resized_size__(width, height, fit), mode, fast);
        this.__gain_map__?.__rescale__(this.width, this.height, image.width, image.height);
        return this.__apply__(image);
    }

    /**
     * Resizes the image to fit inside the given box, keeping its aspect ratio, and centers it in a box of exactly that
     * size (like CSS' `object-fit: contain`): the bars where it doesn't fill the box are transparent or the
     * `background` color. To only resize it to fit inside the box, without the bars, use
     * `resize({ width, height, fit: 'inside' })`
     * @param width The width of the box
     * @param height The height of the box
     * @param options The background and how to resize, see {@link ContainOptions}
     * @returns The resized image
     */
    contain(width: number, height: number, options?: ContainOptions): this;
    contain(width: number, height: number, options?: ContainOptions): this {
        checkOptions(options, 'contain(width, height, { background: 0x000000ff })');
        const { background = 0x00000000, ...resizeOpts } = options ?? {};
        const backgroundColor = checkColor(background, 'background');
        resizeOptions(resizeOpts);
        width = Math.floor(finite(width, 'width'));
        height = Math.floor(finite(height, 'height'));
        // (checked before anything changes)
        if (width < 1) throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1) throw new RangeError('Image has to be at least 1 pixel high');
        const result = new Image(width, height);
        if (backgroundColor !== 0) result.fill(backgroundColor);
        this.resize(...insideSize(this.width, this.height, width, height), resizeOpts);
        const x = (width - this.width) / 2 | 0, y = (height - this.height) / 2 | 0;
        result.composite(this, { x, y });
        this.__gain_map__?.__transform__(this.width, this.height, result.width, result.height, (X, Y) => [X - x, Y - y]);
        return this.__apply__(result);
    }

    /**
     * Resizes the image so it covers the given bounding box, cropping the overflowing edges.
     * Always returns the exact dimensions of the bounding box.
     * @param width The width of the bounding box
     * @param height The height of the bounding box
     * @param options See {@link ResizeOptions}
     * @returns The resized image
     */
    cover(width: number, height: number, options?: ResizeOptions): this;
    cover(width: number, height: number, options?: ResizeOptions): this {
        checkOptions(options, 'cover(width, height, { mode: \'area\' })');
        const resizeOpts = resizeOptions(options);
        width = Math.floor(width);
        height = Math.floor(height);
        // (checked before anything changes: a box below a pixel used to resize the image, then fail to crop it)
        if (!(width >= 1 && Number.isFinite(width)))
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (!(height >= 1 && Number.isFinite(height)))
            throw new RangeError('Image has to be at least 1 pixel high');
        const scale = Math.max(width / this.width, height / this.height);
        const resizedWidth = Math.max(width, Math.round(this.width * scale)), resizedHeight = Math.max(height, Math.round(this.height * scale));
        // only the part the crop keeps is resampled (the same pixels as resizing the whole image, then cropping)
        if (resizeOpts.mode !== 'nearest-neighbor' && width >= 1 && height >= 1) {
            const region = { x: ~~((resizedWidth - width) / 2), y: ~~((resizedHeight - height) / 2), width, height };
            this.__rescaled__?.(resizedWidth, resizedHeight);
            const fx = resizedWidth / this.width, fy = resizedHeight / this.height;
            this.__gain_map__?.__transform__(this.width, this.height, width, height, (X, Y) => [(X + region.x) / fx, (Y + region.y) / fy], Math.min(fx, fy));
            return this.__apply__(this.__resize__(resizedWidth, resizedHeight, resizeOpts.mode, resizeOpts.fast, region));
        }
        this.resize(resizedWidth, resizedHeight, resizeOpts);
        return this.crop((this.width - width) / 2, (this.height - height) / 2, width, height);
    }

    /** @private */
    /**
     * @internal
     * @ignore
     */
    protected __resized_size__(width: number | undefined, height: number | undefined, fit: 'fill' | 'inside' = 'fill'): [width: number, height: number] {
        if (fit === 'inside' && width !== undefined && height !== undefined) return insideSize(this.width, this.height, width, height);
        // a side left out follows the other one, keeping the aspect ratio
        if (width === undefined) return [Math.max(1, Math.round(this.width / this.height * Math.floor(height as number))), height as number];
        if (height === undefined) return [width, Math.max(1, Math.round(this.height / this.width * Math.floor(width)))];
        return [width, height];
    }

    /** @private */
    /**
     * @internal
     * @ignore
     */
    protected __resize__(width: number, height: number, mode: ResizeMode = 'bilinear', fast = true, region?: Region): Image {
        width = Math.floor(width);
        height = Math.floor(height);
        if (width < 1)
            throw new RangeError('Image has to be at least 1 pixel wide');
        if (height < 1)
            throw new RangeError('Image has to be at least 1 pixel high');

        if (mode === 'nearest-neighbor') return this.__resize_nearest_neighbor__(width, height);

        const filter = mode === 'bilinear' ? TRIANGLE : mode === 'bicubic' ? CUBIC : mode === 'area' ? BOX : null;
        if (!filter) throw new Error('Invalid resize mode');

        const image = new Image(region?.width ?? width, region?.height ?? height);
        resample(this.bitmap, this.width, this.height, width, height, filter, image.bitmap, fast, region);
        return image;
    }

    /**
     * @private
     * @param width The new width
     * @param height The new height
     */
    /**
     * @internal
     * @ignore
     */
    protected __resize_nearest_neighbor__(width: number, height: number): Image {
        const image = new Image(width, height);
        const src = this.__u32__;
        const dst = image.__u32__;

        // sample at the centers of the output pixels
        for (let y = 0; y < height; y++) {
            const row = this.width * ((y + 0.5) * (this.height / height) | 0);
            for (let x = 0; x < width; x++)
                dst[y * width + x] = src[row + ((x + 0.5) * (this.width / width) | 0)];
        }

        return image;
    }

    /**
     * Crops an image to the specified dimensions.
     * The region is clipped to the image, so the result can be smaller than the requested size
     * @param x The x offset (0-based)
     * @param y The y offset (0-based)
     * @param width The new images width
     * @param height The new images height
     */
    crop(x: number, y: number, width: number, height: number): this {
        const bounds = this.__crop_bounds__(x, y, width, height);
        this.__crop_gain_map__(this, ...bounds);
        return this.__apply__(this.__crop__(...bounds));
    }

    /**
     * The gain map of a crop of this image (into the image `target`, which can be this one)
     * @internal
     * @ignore
     */
    protected __crop_gain_map__(target: Image, x: number, y: number, width: number, height: number): void {
        const map = this.__gain_map__;
        if (!map) return;
        const copy = target === this ? map : map.clone();
        copy.__transform__(this.width, this.height, width, height, (X, Y) => [X + x, Y + y]);
        target.__gain_map__ = copy;
    }

    /**
     * Copies a region of the image into a new image, this one stays unchanged (like {@link Image.crop} on a clone,
     * without copying the whole image). The region is clipped to the image, so the result can be smaller than the
     * requested size
     * @param x The x offset (0-based)
     * @param y The y offset (0-based)
     * @param width The region's width
     * @param height The region's height
     */
    region(x: number, y: number, width: number, height: number): Image {
        const bounds = this.__crop_bounds__(x, y, width, height);
        const image = this.__crop__(...bounds);
        this.__crop_gain_map__(image, ...bounds);
        return image;
    }

    /**
     * A crop region clipped to the image as [x, y, width, height]
     * @internal
     * @ignore
     */
    protected __crop_bounds__(x: number, y: number, width: number, height: number): [number, number, number, number] {
        x = ~~finite(x, 'x');
        y = ~~finite(y, 'y');
        width = ~~finite(width, 'width');
        height = ~~finite(height, 'height');

        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + width), bottom = Math.min(this.height, y + height);
        if (right <= left || bottom <= top)
            throw new RangeError('Crop region does not overlap the image');

        return [left, top, right - left, bottom - top];
    }

    /**
     * Removes borders of one color, e.g. the empty space around rendered text or around a logo on a solid background.
     * Frames keep their position: their offsets move by the trimmed amount. An image that only has the color stays
     * unchanged
     * @param options See {@link TrimOptions}
     */
    trim(options?: TrimOptions): this;
    trim(options: TrimOptions = {}): this {
        checkOptions(options, 'trim({ tolerance: 0.1 })');
        const { color, ...rest } = options;
        const bounds = this.__trim_bounds__(color, rest);
        if (!bounds) return this;
        this.__crop_gain_map__(this, ...bounds);
        return this.__apply__(this.__crop__(...bounds));
    }

    /**
     * The area that remains after trimming as [x, y, width, height], null if nothing would remain
     * @internal
     * @ignore
     */
    protected __trim_bounds__(color: Color | undefined, { tolerance = 0 }: TrimOptions): [number, number, number, number] | null {
        if (!(tolerance >= 0 && tolerance <= 1)) throw new RangeError('Invalid tolerance, it has to be between 0 and 1');

        const bitmap = this.bitmap;
        const { width, height } = this;
        if (color !== undefined) color = checkColor(color);
        const c = color === undefined ? [bitmap[0], bitmap[1], bitmap[2], bitmap[3]] : [color >>> 24, color >> 16 & 255, color >> 8 & 255, color & 255];
        const limit = tolerance * 255;
        const matches = (x: number, y: number): boolean => {
            const i = (y * width + x) * 4;
            if (Math.abs(bitmap[i + 3] - c[3]) > limit) return false;
            // transparent pixels have no color
            if (bitmap[i + 3] === 0 && c[3] === 0) return true;
            return Math.abs(bitmap[i] - c[0]) <= limit && Math.abs(bitmap[i + 1] - c[1]) <= limit && Math.abs(bitmap[i + 2] - c[2]) <= limit;
        };
        const rowMatches = (y: number): boolean => {
            for (let x = 0; x < width; x++) if (!matches(x, y)) return false;
            return true;
        };
        const columnMatches = (x: number, top: number, bottom: number): boolean => {
            for (let y = top; y < bottom; y++) if (!matches(x, y)) return false;
            return true;
        };

        let top = 0, bottom = height;
        while (top < height && rowMatches(top)) top++;
        if (top === height) return null;
        while (rowMatches(bottom - 1)) bottom--;
        let left = 0, right = width;
        while (columnMatches(left, top, bottom)) left++;
        while (columnMatches(right - 1, top, bottom)) right--;
        return [left, top, right - left, bottom - top];
    }

    /**
     * @internal
     * @ignore
     */
    protected __crop__(x: number, y: number, width: number, height: number): Image {
        x = ~~x;
        y = ~~y;

        const image = new Image(width, height);

        for (let tY = 0; tY < height; tY++) {
            const idx = (tY + y) * this.width + x;
            image.__u32__.set(this.__u32__.subarray(idx, idx + width), tY * width);
        }

        return image;
    }

    /**
     * Crops the image into a circle with an antialiased edge
     * @param options See {@link CropCircleOptions}
     */
    cropCircle(options: CropCircleOptions = {}): this {
        checkOptions(options, 'cropCircle({ size: \'cover\' })');
        const { size = 'contain', feathering = 0 } = options;
        finite(feathering, 'feathering');
        if (size !== 'contain' && size !== 'cover') throw new TypeError(`Invalid circle size: ${String(size)}`);
        const radius = (size === 'cover' ? Math.max : Math.min)(this.width, this.height) / 2;
        const cx = this.width / 2, cy = this.height / 2;
        // width of the soft edge, at least the one pixel of antialiasing
        const band = Math.min(1, Math.max(0, feathering)) * radius;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const alpha = 4 * (y * this.width + x) + 3;
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                // pixels well inside keep their alpha
                if (dx * dx + dy * dy <= (radius - Math.max(band, 1)) ** 2) continue;

                const factor = band > 1
                    ? Math.min(1, Math.max(0, (radius - Math.hypot(dx, dy)) / band))
                    : circleCoverage(x, y, cx, cy, radius);
                if (factor < 1) this.bitmap[alpha] *= factor;
            }
        }

        return this;
    }

    /**
     * Sets the RGB of every pixel to the given color, keeping each pixel's own alpha. Turns an image into a silhouette
     * or tints it: `image.recolor(0xffffffff)` makes every pixel white, keeping its transparency
     * @param color The color to use, its alpha is ignored
     */
    recolor(color: Color): this;
    /**
     * Sets the RGB of every pixel to the RGB of the same pixel of another image, keeping each pixel's own alpha. With a
     * gradient this fills a shape with it, e.g. gradient text:
     * `text.recolor(Image.linearGradient(text.width, text.height, { stops: [0x22d3eeff, 0xfb923cff], angle: 90 }))`
     * @param colors The image to take the colors from, it has to have the same size. Its alpha is ignored
     */
    recolor(colors: Image): this;
    recolor(colorOrImage: Color | Image): this {
        if (colorOrImage instanceof Image) {
            const colors = colorOrImage;
            if (colors.width !== this.width || colors.height !== this.height)
                throw new RangeError(`The image to take the colors from has to be ${this.width}x${this.height}, not ${colors.width}x${colors.height}`);
            // (the gain map's resolution gets the colors at its resolution)
            if (this.__gain_map__) return this.__recolor__(image => image.recolor(image.width === colors.width && image.height === colors.height ? colors : colors.clone().resize(image.width, image.height)));
            const from = colors.bitmap, to = this.bitmap;
            for (let i = 0; i < to.length; i += 4) {
                to[i] = from[i];
                to[i + 1] = from[i + 1];
                to[i + 2] = from[i + 2];
            }
            return this;
        }
        const color = checkColor(colorOrImage);
        if (this.__gain_map__) return this.__recolor__(image => image.recolor(color));
        const r = color >>> 24, g = color >> 16 & 0xff, b = color >> 8 & 0xff;
        for (let i = 0; i < this.bitmap.length; i += 4) {
            this.bitmap[i] = r;
            this.bitmap[i + 1] = g;
            this.bitmap[i + 2] = b;
        }

        return this;
    }

    /**
     * Scales the opacity of the image
     * @param opacity The factor to multiply the opacity with (0..1 lowers it, >1 raises it, results are clamped)
     */
    opacity(opacity: number): this {
        opacity = finite(opacity, 'opacity value');
        if (opacity < 0)
            throw new RangeError('Invalid opacity value');

        this.__set_channel_value__(opacity, 3);

        return this;
    }

    /**
     * Scales the red channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     */
    red(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.red(factor));
        factor = finite(factor, 'red factor');
        if (factor < 0)
            throw new RangeError('Invalid red factor');

        this.__set_channel_value__(factor, 0);

        return this;
    }

    /**
     * Scales the green channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     */
    green(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.green(factor));
        factor = finite(factor, 'green factor');
        if (factor < 0)
            throw new RangeError('Invalid green factor');

        this.__set_channel_value__(factor, 1);

        return this;
    }

    /**
     * Scales the blue channel
     * @param factor The factor to multiply the channel with (>= 0, results are clamped)
     */
    blue(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.blue(factor));
        factor = finite(factor, 'blue factor');
        if (factor < 0)
            throw new RangeError('Invalid blue factor');

        this.__set_channel_value__(factor, 2);

        return this;
    }

    /**
     * @internal
     * @ignore
     */
    protected __set_channel_value__(value: number, offset: number): void {
        for (let i = offset; i < this.bitmap.length; i += 4)
            this.bitmap[i] = value * this.bitmap[i];
    }

    /**
     * Scales the lightness of the image (HSL), keeping its hue and saturation
     * @param factor The factor to multiply the lightness with (>= 0, results are clamped)
     */
    lightness(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.lightness(factor));
        factor = finite(factor, 'lightness factor');
        if (factor < 0)
            throw new RangeError('Invalid lightness factor');

        return this.__map_hsla__(c => { c.l = factor * c.l; });
    }

    /**
     * Scales the saturation of the image (HSL), keeping its hue and lightness. 0 makes it grayscale
     * @param factor The factor to multiply the saturation with (>= 0, results are clamped)
     */
    saturation(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.saturation(factor), true);
        factor = finite(factor, 'saturation factor');
        if (factor < 0)
            throw new RangeError('Invalid saturation factor');

        return this.__map_hsla__(c => { c.s = factor * c.s; });
    }

    /**
     * Composites (overlays) the source onto this image
     * @param source The image to place
     * @param options Position, opacity and blend mode, see {@link CompositeOptions}
     */
    composite(source: Image, options?: CompositeOptions): this;
    composite(source: Image, options: CompositeOptions = {}): this {
        checkOptions(options, 'composite(source, { x: 10, y: 20 })');
        const { opacity = 1, mode = 'normal' } = options;
        let x = options.x ?? 0, y = options.y ?? 0;
        x = finite(x, 'x') | 0;
        y = finite(y, 'y') | 0;

        if (isNaN(opacity) || opacity < 0 || opacity > 1)
            throw new RangeError('Invalid composite opacity');
        const blend = BLEND_MODES[mode];
        if (!blend || !Object.prototype.hasOwnProperty.call(BLEND_MODES, mode))
            throw new RangeError(`Invalid blend mode: ${mode}`);
        if (opacity === 0) return this;
        if (this.__gain_map__ || source.__gain_map__) return this.__composite_gain__(source, x, y, opacity, mode);
        if (mode !== 'normal') return this.__blend__(source, x, y, opacity, blend);

        // (the loop stays inline here: as a method of its own it ran about 20% slower)
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        const dst = this.bitmap, src = source.bitmap;

        for (let row = top; row < bottom; row++) {
            for (let column = left, s = 4 * ((row - y) * source.width + left - x), d = 4 * (row * this.width + left); column < right; column++, s += 4, d += 4) {
                const sa = src[s + 3];
                if (sa === 0) continue;

                const da = dst[d + 3];
                if ((sa === 255 && opacity === 1) || da === 0) {
                    dst[d] = src[s];
                    dst[d + 1] = src[s + 1];
                    dst[d + 2] = src[s + 2];
                    dst[d + 3] = sa * opacity;
                    continue;
                }

                // source over with straight alpha (the source's scaled by the opacity), the clamped bitmap rounds on
                // assignment
                const fa = sa / 255 * opacity, ba = da / 255 * (1 - fa);
                const a = fa + ba;
                dst[d] = (src[s] * fa + dst[d] * ba) / a;
                dst[d + 1] = (src[s + 1] * fa + dst[d + 1] * ba) / a;
                dst[d + 2] = (src[s + 2] * fa + dst[d + 2] * ba) / a;
                dst[d + 3] = a * 255;
            }
        }

        return this;
    }

    /**
     * Composites (with a gain map on either side): the pixels, then the gain map where the source went (the HDR light
     * composited like the pixels, see util/gain.ts)
     * @internal
     * @ignore
     */
    protected __composite_gain__(source: Image, x: number, y: number, opacity: number, mode: BlendMode): this {
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        if (right <= left || bottom <= top) return this;
        const before = this.__crop__(left, top, right - left, bottom - top).bitmap, beforeWidth = right - left;
        // (the pixels: composited without the maps)
        const ownMap = this.__gain_map__, sourceMap = source.__gain_map__;
        this.__gain_map__ = source.__gain_map__ = null;
        try {
            this.composite(source, { x, y, opacity, mode });
        } finally {
            this.__gain_map__ = ownMap;
            source.__gain_map__ = sourceMap;
        }
        const blend = mode !== 'normal';

        const map = this.__gain_map__ ??= gain.neutralMap(sourceMap as GainMap, source.width, this.width, this.height);
        if (sourceMap) map.hdrCapacityMax = Math.max(map.hdrCapacityMax, sourceMap.hdrCapacityMax);
        const sample = gain.gainSampler(source);
        const sourceOS = sourceMap?.offsetSDR ?? [0, 0, 0], sourceOH = sourceMap?.offsetHDR ?? [0, 0, 0];
        const oS = map.offsetSDR, oH = map.offsetHDR;
        const src = source.bitmap, Gs = [0, 0, 0];
        let lastGain = NaN, lastPower = 1;
        gain.redraw(this, map, left, top, right, bottom, (px, py, S, boost, out) => {
            const s = 4 * ((py - y) * source.width + px - x), b = 4 * ((py - top) * beforeWidth + px - left);
            const as = src[s + 3] / 255 * opacity, ab = before[b + 3] / 255;
            const ao = as + ab * (1 - as);
            // (blend modes over an opaque backdrop keep the backdrop's boost on the blended color: no source light needed)
            if (blend && ab === 1) {
                for (let c = 0; c < 3; c++) out[c] = (S[c] + oS[c]) * boost[c] - oH[c];
                return;
            }
            if (ao <= 0) {
                out[0] = out[1] = out[2] = 0;
                return;
            }
            let sampled = false;
            for (let c = 0; c < 3; c++) {
                const Sd = gain.LINEAR[before[b + c]], Ss = gain.LINEAR[src[s + c]];
                const Hd = (Sd + oS[c]) * boost[c] - oH[c];
                // the source's share of the result as the pixels got it (composited in sRGB, not linear light): the
                // HDR light is mixed alike, so it looks like the SDR result, boosted
                const share = Math.abs(Ss - Sd) > 1e-4 ? Math.min(1, Math.max(0, (S[c] - Sd) / (Ss - Sd))) : as / ao;
                if (share === 0) {
                    // (nothing of the source is in the result: its light isn't needed)
                    out[c] = Hd;
                    continue;
                }
                let Hs = Ss;
                if (sample) {
                    if (!sampled) {
                        sample(px - x, py - y, Gs);
                        sampled = true;
                    }
                    // (the same gain as the one before has the same power: single channel maps have one in all three)
                    if (Gs[c] !== lastGain) {
                        lastGain = Gs[c];
                        lastPower = 2 ** lastGain;
                    }
                    Hs = (Ss + sourceOS[c]) * lastPower - sourceOH[c];
                }
                out[c] = share * Hs + (1 - share) * Hd;
            }
        }, map.channels === 1 && (!sourceMap || sourceMap.channels === 1), Math.max(0, ...(sourceMap?.__max__ ?? [0])));
        return this;
    }

    /**
     * Composites with opacity and a blend mode (the W3C compositing model: the blended color is drawn source-over)
     * @internal
     * @ignore
     */
    protected __blend__(source: Image, x: number, y: number, opacity: number, blend: (backdrop: number, source: number) => number): this {
        const left = Math.max(0, x), top = Math.max(0, y);
        const right = Math.min(this.width, x + source.width), bottom = Math.min(this.height, y + source.height);
        const dst = this.bitmap, src = source.bitmap;

        for (let row = top; row < bottom; row++) {
            for (let column = left; column < right; column++) {
                const s = 4 * ((row - y) * source.width + column - x);
                const as = src[s + 3] / 255 * opacity;
                if (as <= 0) continue;

                const d = 4 * (row * this.width + column);
                const ab = dst[d + 3] / 255;
                const ao = as + ab * (1 - as);

                for (let c = 0; c < 3; c++) {
                    const cs = src[s + c] / 255, cb = dst[d + c] / 255;
                    // where the backdrop is transparent the source color is used unblended
                    const cr = (1 - ab) * cs + ab * blend(cb, cs);
                    // the clamped bitmap rounds on assignment
                    dst[d + c] = (as * cr + ab * (1 - as) * cb) / ao * 255;
                }
                dst[d + 3] = ao * 255;
            }
        }

        return this;
    }

    /**
     * Inverts the images colors
     */
    invert(): this {
        if (this.__gain_map__) return this.__unboost__(image => image.invert());
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            bitmap[i] = 255 - bitmap[i];
            bitmap[i + 1] = 255 - bitmap[i + 1];
            bitmap[i + 2] = 255 - bitmap[i + 2];
        }

        return this;
    }

    /**
     * Inverts the images lightness (HSL), keeping hue and saturation: dark colors become light and vice versa
     */
    invertLightness(): this {
        if (this.__gain_map__) return this.__unboost__(image => image.invertLightness());
        return this.__map_hsla__(c => { c.l = 1 - c.l; });
    }

    /**
     * Inverts the images value (HSV), keeping hue and saturation: the brightest channel `v` becomes `255 - v`
     * and the others scale along, black becomes white
     */
    invertValue(): this {
        if (this.__gain_map__) return this.__unboost__(image => image.invertValue());
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const max = Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]);
            if (max === 0) {
                bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = 255;
                continue;
            }

            // the clamped bitmap rounds on assignment
            const factor = (255 - max) / max;
            bitmap[i] *= factor;
            bitmap[i + 1] *= factor;
            bitmap[i + 2] *= factor;
        }

        return this;
    }

    /**
     * Shifts the images hue
     * @param degrees How many degrees to shift the hue by
     */
    hueShift(degrees: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.hueShift(degrees), true);
        degrees = finite(degrees, 'hue shift');
        return this.__map_hsla__(c => { c.h += degrees / 360; });
    }

    /**
     * Converts every pixel to HSLA, lets `map` adjust the components in place and converts back
     * (the same math as {@link Colors.toHSLA} and {@link Colors.fromHSLA}, without allocating per pixel)
     * @internal
     * @ignore
     */
    protected __map_hsla__(map: (hsla: HSLA) => void): this {
        const bitmap = this.bitmap;
        const hsla: HSLA = { h: 0, s: 0, l: 0, a: 0 };
        const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2);

        // results of recently seen colors (direct mapped by a hash of the color), images often repeat colors
        const keys = new Uint32Array(4096), values = new Uint32Array(4096);
        keys[0] = 1; // so the empty slot 0 can't match the color 0

        for (let i = 0; i < bitmap.length; i += 4) {
            const color = pixels[i >> 2];
            const slot = Math.imul(color, 0x9e3779b1) >>> 20;
            if (keys[slot] === color) {
                pixels[i >> 2] = values[slot];
                continue;
            }

            const r = bitmap[i] / 255, g = bitmap[i + 1] / 255, b = bitmap[i + 2] / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const l = (max + min) / 2;
            let h = 0, s = 0;

            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
                else if (max === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6;
            }

            hsla.h = h;
            hsla.s = s;
            hsla.l = l;
            hsla.a = bitmap[i + 3] / 255;
            map(hsla);

            // see Colors.fromHSLA
            const nh = wrapHue(hsla.h);
            const ns = Math.min(1, Math.max(0, hsla.s));
            const nl = Math.min(1, Math.max(0, hsla.l));
            const na = Math.min(1, Math.max(0, hsla.a));

            if (ns === 0) bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = Math.round(nl * 255);
            else {
                const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns;
                const p = 2 * nl - q;
                bitmap[i] = Math.round(hue2rgb(p, q, nh + 1 / 3) * 255);
                bitmap[i + 1] = Math.round(hue2rgb(p, q, nh) * 255);
                bitmap[i + 2] = Math.round(hue2rgb(p, q, nh - 1 / 3) * 255);
            }
            bitmap[i + 3] = Math.round(na * 255);

            keys[slot] = color;
            values[slot] = pixels[i >> 2];
        }

        return this;
    }

    /**
     * Blurs the image with a gaussian blur (transparent pixels don't bleed their color)
     * @param radius The blur radius: the gaussian's standard deviation in pixels, like CSS' blur()
     */
    blur(radius: number): this {
        if (!Number.isFinite(radius) || radius < 0)
            throw new RangeError('Invalid blur radius');
        // (the gain map blurred alike, at its resolution)
        const map = this.__gain_map__;
        if (map && radius * map.width / this.width >= 0.5) map.image = map.image.clone().blur(radius * map.width / this.width);

        if (boxBlurRGBA(this.bitmap, this.width, this.height, radius)) return this;
        const pixels = premultiply(this.bitmap);
        gaussianBlur(pixels, this.width, this.height, radius);
        unpremultiply(pixels, this.bitmap);
        return this;
    }

    /**
     * Reduces the image to a palette of at most 256 colors (or a fixed one), in place, optionally dithered, e.g.
     * `image.quantize({ colors: 16, dither: 'floyd-steinberg' })` or `image.quantize({ palette: [0x0f380fff, 0x306230ff,
     * 0x8bac0fff, 0x9bbc0fff] })` for a Game Boy look. Transparent pixels (alpha 0) keep their color and don't count
     * towards the palette; the other pixels keep their alpha and only their RGB is reduced. The result is deterministic.
     * With a gain map (an HDR image), the HDR highlights are dropped, like {@link Image.invert} does: the map is neutral
     * afterwards. Frames quantize their own pixels
     * @param options See {@link QuantizeOptions}
     */
    quantize(options: QuantizeOptions = {}): this {
        checkOptions(options, 'image.quantize({ colors: 16 })');
        if (typeof options !== 'object' || options === null) throw new TypeError('quantize takes an options object');
        const { colors, palette, dither = 'none', ditherStrength = 1 } = options;

        // everything is checked before the image changes
        if (colors !== undefined && palette !== undefined) throw new TypeError('quantize takes colors or palette, not both');
        let fixed: Uint8Array | null = null, count = 256;
        if (palette !== undefined) {
            if (!Array.isArray(palette)) throw new TypeError('palette has to be an array of colors');
            if (palette.length < 1 || palette.length > 256) throw new RangeError(`palette needs 1 to 256 colors, not ${palette.length}`);
            const packed = new Uint8Array(palette.length * 3);
            palette.forEach((color, i) => {
                const value = checkColor(color, 'palette color');
                if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`Invalid palette color: ${color}`);
                packed[i * 3] = value >>> 24;
                packed[i * 3 + 1] = value >>> 16 & 255;
                packed[i * 3 + 2] = value >>> 8 & 255;
            });
            fixed = packed;
        } else if (colors !== undefined) {
            count = finite(colors, 'colors');
            if (!Number.isInteger(count) || count < 2 || count > 256) throw new RangeError(`colors must be an integer from 2 to 256, not ${colors}`);
        }
        if (!(DITHER_METHODS as readonly unknown[]).includes(dither)) throw new TypeError(`dither must be one of ${DITHER_METHODS.map(name => `'${name}'`).join(', ')}, not ${String(dither)}`);
        const strength = finite(ditherStrength, 'ditherStrength');
        if (strength < 0 || strength > 1) throw new RangeError(`ditherStrength must be 0-1, not ${ditherStrength}`);

        const reduce = (image: Image): void => {
            const bytes = image.__bytes__();
            const table = fixed ?? quantize.buildPalette(bytes, count, 1);
            quantize.applyPalette(bytes, image.width, image.height, table, dither, strength);
        };
        if (this.__gain_map__) return this.__unboost__(reduce);
        reduce(this);
        return this;
    }

    /**
     * Mixes the colors of every pixel with a color matrix, like SVG's `feColorMatrix`: the new red, green, blue and alpha
     * are each a sum of the old red, green, blue and alpha times a factor, plus an offset. Grayscale, sepia, tints,
     * swapped channels, color blindness simulation or a mix of those in one pass.
     *
     * The values are 20 numbers, four rows of `[red, green, blue, alpha, offset]` for the new red, green, blue and alpha,
     * with the colors and the offsets as 0 to 1 (like CSS and SVG): `[1, 0, 0, 0, 0,  0, 1, 0, 0, 0,  0, 0, 1, 0, 0,
     * 0, 0, 0, 1, 0]` changes nothing, `[0, 0, 1, 0, 0,  0, 1, 0, 0, 0,  1, 0, 0, 0, 0,  0, 0, 0, 1, 0]` swaps red and
     * blue. Nine numbers are the first three rows without the alpha and the offsets (the alpha stays as it is). The
     * colors are the sRGB values, not premultiplied, and the results are clamped. With a gain map (an HDR image), the
     * HDR highlights follow the change as they do for other color changes
     * @param matrix The 9 or 20 values
     */
    colorMatrix(matrix: ArrayLike<number>): this {
        if (matrix === null || typeof matrix !== 'object' || (matrix.length !== 9 && matrix.length !== 20))
            throw new RangeError('A color matrix has 9 or 20 values');
        const m = new Float64Array(20);
        // (numbers only: a string is a mistake in data like this)
        const value = (v: unknown): number => finite(typeof v === 'number' ? v : NaN, 'color matrix value');
        if (matrix.length === 20) for (let i = 0; i < 20; i++) m[i] = value(matrix[i]);
        else for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) m[row * 5 + column] = value(matrix[row * 3 + column]);
        // (nine values leave the alpha as it is)
        if (matrix.length === 9) m[18] = 1;

        if (this.__gain_map__) return this.__recolor__(image => image.colorMatrix(m));
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const r = bitmap[i], g = bitmap[i + 1], b = bitmap[i + 2], a = bitmap[i + 3];
            // (the offsets are 0 to 1, the values 0 to 255; the clamped array rounds and clamps)
            bitmap[i] = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4] * 255;
            bitmap[i + 1] = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9] * 255;
            bitmap[i + 2] = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14] * 255;
            bitmap[i + 3] = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19] * 255;
        }
        return this;
    }

    /**
     * Moves every point of the image with an affine transform, in one resampling: rotation, scaling, skew, flips and
     * shifts in any mix and around any point. The six numbers are SVG's `matrix(a b c d e f)`: a point (x, y) of the
     * image ends up at (a x + c y + e, b x + d y + f), with y pointing down.
     * ```ts
     * image.transform([1, 0, Math.tan(-0.3), 1, 0, 0]);             // slanted like italics, around the middle
     * image.transform([0.5, 0, 0, 0.5, 0, 0], { origin: { x: 0, y: 0 } }); // half the size
     * image.transform([-1, 0, 0, 1, 0, 0]);                         // flipped horizontally
     * const a = Math.PI / 6;
     * image.transform([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); // turned 30° clockwise
     * ```
     * The image grows to hold the result (`expand: false` keeps its size), so a shift only shows with `expand: false`.
     * The edges fade, like the pixels outside were transparent. A transform that flattens the image (a factor of 0) is
     * refused. With a gain map (an HDR image), the map moves with the image
     * @param matrix The six values [a, b, c, d, e, f]
     * @param options See {@link TransformOptions}
     */
    transform(matrix: ArrayLike<number>, options: TransformOptions = {}): this {
        checkOptions(options, 'image.transform([1, 0, 0, 1, 0, 0], { expand: false })');
        if (matrix === null || typeof matrix !== 'object' || matrix.length !== 6) throw new RangeError('A transform has 6 values: [a, b, c, d, e, f]');
        // (numbers only: a string is a mistake in data like this)
        const values = Array.from({ length: 6 }, (_, i) => finite(typeof matrix[i] === 'number' ? matrix[i] : NaN, 'transform value'));
        if (typeof options !== 'object' || options === null) throw new TypeError('transform takes an options object');
        const { origin = {}, expand = true, mode = 'bilinear' } = options;
        if (!TRANSFORM_MODES.includes(mode)) throw new TypeError(`transform mode must be one of ${TRANSFORM_MODES.map(name => `'${name}'`).join(', ')}, not ${String(mode)}`);
        const { x: pivotX = this.width / 2, y: pivotY = this.height / 2 } = origin;
        finite(pivotX, 'origin x');
        finite(pivotY, 'origin y');

        // around the origin: move it to (0, 0), transform, move it back
        const around = multiply(multiply([1, 0, 0, 1, pivotX, pivotY], values), [1, 0, 0, 1, -pivotX, -pivotY]);
        const inverse = invert(around);
        if (!inverse) throw new RangeError('The transform has to be invertible: it can\'t flatten the image');

        const { width, height } = this;
        // (the canvas's top left corner in the transformed space, which isn't on a pixel border for a scale around the
        // middle of an image of odd size: then the grid starts there, so that doubling an image is exactly doubling)
        let left = 0, top = 0, outWidth = width, outHeight = height;
        if (expand) {
            const xs: number[] = [], ys: number[] = [];
            for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
                xs.push(around[0] * x + around[2] * y + around[4]);
                ys.push(around[1] * x + around[3] * y + around[5]);
            }
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            // the size rounds, the transformed image is centered on the canvas (a turned image is a bit off a pixel size)
            outWidth = Math.max(1, Math.round(maxX - minX));
            outHeight = Math.max(1, Math.round(maxY - minY));
            left = minX - (outWidth - (maxX - minX)) / 2;
            top = minY - (outHeight - (maxY - minY)) / 2;
            // frames only grow as far up and left as their offset allows
            const room = this.__room__();
            if (left < -room.left) {
                left = -room.left;
                outWidth = Math.max(1, Math.round(maxX - left));
            }
            if (top < -room.top) {
                top = -room.top;
                outHeight = Math.max(1, Math.round(maxY - top));
            }
            if (outWidth * outHeight > MAX_PIXELS) throw new RangeError(`The transformed image would have ${outWidth}x${outHeight} pixels, more than the ${MAX_PIXELS} allowed`);
        }

        const out = new Image(outWidth, outHeight);
        sampleAffine(this.bitmap, width, height, out.bitmap, outWidth, outHeight, inverse, left, top, mode);
        const scale = Math.sqrt(Math.abs(around[0] * around[3] - around[1] * around[2]));
        this.__gain_map__?.__transform__(width, height, outWidth, outHeight, (X, Y) => {
            const x = X + left, y = Y + top;
            return [inverse[0] * x + inverse[2] * y + inverse[4], inverse[1] * x + inverse[3] * y + inverse[5]];
        }, scale);
        this.__apply__(out);
        // (a frame's offsets are whole pixels)
        if (left || top) this.__grown__(-Math.round(left), -Math.round(top));
        return this;
    }

    /**
     * Adds a shadow behind the image, shaped by its alpha: a drop shadow with an offset, or a glow without one
     * (`image.dropShadow({ blur: 8, color: 0xff2fb9ff })`, with `spread` to make it stronger). The image grows to fit
     * the shadow, unless `expand` is `false`. Frames stay where they are (their offsets move with the growth), they only
     * grow up and left as far as their offset allows
     * @param options See {@link ShadowOptions}
     */
    dropShadow(options: ShadowOptions = {}): this {
        checkOptions(options, 'image.dropShadow({ blur: 8 })');
        const { x = 0, y = 0, blur = 0, spread = 0, color = 0x00000080, expand = true } = options;
        finite(x, 'x');
        finite(y, 'y');
        if (finite(blur, 'blur') < 0) throw new RangeError('Invalid blur radius');
        if (finite(spread, 'spread') < 0) throw new RangeError('Invalid spread');
        const [r, g, b, a] = Colors.toRGBA(checkColor(color));

        // the shadow's room: the spread and what the blur reaches (3 standard deviations), and a border for the outline
        const reach = spread + 3 * blur, margin = Math.ceil(reach) + 1;
        const layer = this.__shape_layer__(margin);
        const width = layer.width;
        const coverage = new Uint8Array(width * layer.height);
        for (let i = 0; i < coverage.length; i++) coverage[i] = layer.bitmap[i * 4 + 3];
        const grown = spread > 0 ? outline(coverage, width, layer.height, spread) : null;
        const bitmap = layer.bitmap;
        for (let i = 0; i < coverage.length; i++) {
            bitmap[i * 4] = r;
            bitmap[i * 4 + 1] = g;
            bitmap[i * 4 + 2] = b;
            bitmap[i * 4 + 3] = (grown ? grown[i] * 255 : coverage[i]) * a / 255;
        }
        if (blur > 0) {
            layer.blur(blur);
            // (a flat color: blurring the alpha only, the exact color goes back, 8 bit premultiplied colors drift where it's faint)
            for (let i = 0; i < coverage.length; i++) {
                if (!bitmap[i * 4 + 3]) continue;
                bitmap[i * 4] = r;
                bitmap[i * 4 + 1] = g;
                bitmap[i * 4 + 2] = b;
            }
        }

        const room = this.__room__();
        return this.__under__(layer, x - margin, y - margin, expand ? {
            left: Math.min(room.left, Math.max(0, Math.ceil(reach - x))),
            top: Math.min(room.top, Math.max(0, Math.ceil(reach - y))),
            right: Math.max(0, Math.ceil(reach + x)),
            bottom: Math.max(0, Math.ceil(reach + y))
        } : { left: 0, top: 0, right: 0, bottom: 0 });
    }

    /**
     * Draws an outline around the image's shape (its alpha): the sticker effect for cut-out images, or an outline for
     * text. The image grows to fit it, unless `expand` is `false`. Frames stay where they are (their offsets move with
     * the growth), they only grow up and left as far as their offset allows
     * @param options See {@link OutlineOptions}
     */
    outline(options: OutlineOptions = {}): this {
        checkOptions(options, 'image.outline({ width: 4 })');
        const { width = 1, color = 0x000000ff, expand = true } = options;
        if (finite(width, 'outline width') < 0) throw new RangeError('Invalid outline width');
        const [r, g, b, a] = Colors.toRGBA(checkColor(color));
        if (width === 0) return this;

        const margin = Math.ceil(width) + 1;
        const layer = this.__shape_layer__(margin);
        const coverage = new Uint8Array(layer.width * layer.height);
        for (let i = 0; i < coverage.length; i++) coverage[i] = layer.bitmap[i * 4 + 3];
        const stroke = outline(coverage, layer.width, layer.height, width);
        const bitmap = layer.bitmap;
        for (let i = 0; i < coverage.length; i++) {
            // (around the shape only: it shows through translucent pixels neither)
            bitmap[i * 4] = r;
            bitmap[i * 4 + 1] = g;
            bitmap[i * 4 + 2] = b;
            bitmap[i * 4 + 3] = stroke[i] * (1 - coverage[i] / 255) * a;
        }

        const room = this.__room__(), grow = Math.ceil(width);
        return this.__under__(layer, -margin, -margin, expand
            ? { left: Math.min(room.left, grow), top: Math.min(room.top, grow), right: grow, bottom: grow }
            : { left: 0, top: 0, right: 0, bottom: 0 });
    }

    /**
     * A transparent image with this one's alpha in the middle, with a margin all around
     * @internal
     * @ignore
     */
    protected __shape_layer__(margin: number): Image {
        const layer = new Image(this.width + 2 * margin, this.height + 2 * margin);
        for (let y = 0; y < this.height; y++)
            for (let x = 0; x < this.width; x++)
                layer.bitmap[((y + margin) * layer.width + x + margin) * 4 + 3] = this.bitmap[(y * this.width + x) * 4 + 3];
        return layer;
    }

    /**
     * Puts a layer behind the image on a larger canvas (the layer's position is relative to the image), keeping the
     * gain map in place
     * @internal
     * @ignore
     */
    protected __under__(layer: Image, layerX: number, layerY: number, grow: { left: number, top: number, right: number, bottom: number }): this {
        const { left, top, right, bottom } = grow;
        const width = this.width + left + right, height = this.height + top + bottom;
        const result = new Image(width, height);
        result.composite(layer, { x: layerX + left, y: layerY + top });
        const map = this.__gain_map__;
        this.__gain_map__ = null;
        try {
            result.composite(this, { x: left, y: top });
        } finally {
            this.__gain_map__ = map;
        }
        map?.__transform__(this.width, this.height, width, height, (X, Y) => [X - left, Y - top]);
        this.__apply__(result);
        if (left || top) this.__grown__(left, top);
        return this;
    }

    /**
     * How far the image may grow up and left
     * @internal
     * @ignore
     */
    protected __room__(): { left: number, top: number } {
        return { left: Infinity, top: Infinity };
    }

    /**
     * Called when the image has grown up and left
     * @internal
     * @ignore
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected __grown__(_left: number, _top: number): void {
        // (frames move their offsets)
    }

    /**
     * Sharpens the image with an unsharp mask: the difference to a blurred copy is amplified
     * @param options See {@link SharpenOptions}
     */
    sharpen(options?: SharpenOptions): this;
    sharpen(options: SharpenOptions = {}): this {
        checkOptions(options, 'sharpen({ amount: 0.5 })');
        const { amount = 1, radius = 1 } = options;
        if (!Number.isFinite(amount) || amount < 0)
            throw new RangeError('Invalid sharpen amount');
        if (!Number.isFinite(radius) || radius <= 0)
            throw new RangeError('Invalid sharpen radius');

        const blurred = premultiply(this.bitmap);
        gaussianBlur(blurred, this.width, this.height, radius);

        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const a = blurred[i + 3];
            if (a < 0.5 || bitmap[i + 3] === 0) continue;

            // the clamped bitmap rounds and clamps
            const f = 255 / a;
            bitmap[i] += amount * (bitmap[i] - blurred[i] * f);
            bitmap[i + 1] += amount * (bitmap[i + 1] - blurred[i + 1] * f);
            bitmap[i + 2] += amount * (bitmap[i + 2] - blurred[i + 2] * f);
        }

        return this;
    }

    /**
     * Multiplies the color channels, e.g. 1.2 makes the image 20% brighter
     * @param factor The factor (>= 0, 1 keeps the image)
     */
    brightness(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.brightness(factor), false, v => v * factor);
        factor = finite(factor, 'brightness factor');
        if (factor < 0)
            throw new RangeError('Invalid brightness factor');
        return this.__map_channels__(v => v * factor);
    }

    /**
     * Scales the color channels' distance from mid gray, e.g. 1.5 increases the contrast, 0.5 reduces it
     * @param factor The factor (>= 0, 1 keeps the image, 0 makes it gray)
     */
    contrast(factor: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.contrast(factor), false, v => (v - 0.5) * factor + 0.5);
        factor = finite(factor, 'contrast factor');
        if (factor < 0)
            throw new RangeError('Invalid contrast factor');
        return this.__map_channels__(v => (v - 127.5) * factor + 127.5);
    }

    /**
     * Applies a gamma correction, values above 1 brighten the dark tones, values below 1 darken them
     * @param gamma The gamma (> 0, 1 keeps the image)
     */
    gamma(gamma: number): this {
        if (this.__gain_map__) return this.__recolor__(image => image.gamma(gamma), false, v => Math.max(0, v) ** (1 / gamma));
        gamma = finite(gamma, 'gamma');
        if (gamma <= 0)
            throw new RangeError('Invalid gamma');
        return this.__map_channels__(v => 255 * (v / 255) ** (1 / gamma));
    }

    /**
     * Converts the image to grayscale by its luma (ITU-R 601, like Pillow), keeping the alpha
     */
    grayscale(): this {
        if (this.__gain_map__) return this.__recolor__(image => image.grayscale(), true);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4)
            bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = bitmap[i] * 19595 + bitmap[i + 1] * 38470 + bitmap[i + 2] * 7471 + 0x8000 >> 16;
        return this;
    }

    /**
     * Applies a sepia tone
     */
    sepia(): this {
        if (this.__gain_map__) return this.__recolor__(image => image.sepia(), true);
        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            const r = bitmap[i], g = bitmap[i + 1], b = bitmap[i + 2];
            bitmap[i] = 0.393 * r + 0.769 * g + 0.189 * b;
            bitmap[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
            bitmap[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
        }
        return this;
    }

    /**
     * Makes a color transparent, like GIMP's "Color to Alpha": the color is removed from every pixel and replaced by
     * transparency, so pixels that are partly the color (e.g. antialiased edges against a background) become
     * semi-transparent instead of keeping a fringe of it.
     * The color is removed everywhere in the image, not only from a connected background: removing a white
     * background also makes white areas inside the subject (e.g. eyes in a logo) transparent
     * @param options See {@link ColorToAlphaOptions}
     */
    colorToAlpha(options?: ColorToAlphaOptions): this;
    colorToAlpha(options: ColorToAlphaOptions = {}): this {
        checkOptions(options, 'colorToAlpha({ color: 0xffffffff })');
        const { color: colorOption, transparencyThreshold = 0, opacityThreshold = 1 } = options;
        let color = colorOption;
        if (!(transparencyThreshold >= 0 && opacityThreshold <= 1 && transparencyThreshold < opacityThreshold))
            throw new RangeError('Invalid thresholds, they have to satisfy 0 <= transparencyThreshold < opacityThreshold <= 1');

        const bitmap = this.bitmap;
        if (color !== undefined) color = checkColor(color);
        const c = color === undefined ? [bitmap[0], bitmap[1], bitmap[2]] : [color >>> 24, color >> 16 & 255, color >> 8 & 255];

        for (let i = 0; i < bitmap.length; i += 4) {
            // how far the pixel is from the color: the alpha it needs to be "pixel = alpha * X + (1 - alpha) * color"
            let distance = 0;
            for (let k = 0; k < 3; k++) {
                const d = bitmap[i + k] - c[k];
                const a = d > 0 ? d / (255 - c[k]) : d < 0 ? -d / c[k] : 0;
                if (a > distance) distance = a;
            }

            const alpha = distance <= transparencyThreshold ? 0 : distance >= opacityThreshold ? 1
                : (distance - transparencyThreshold) / (opacityThreshold - transparencyThreshold);

            // unmix the color, so it looks the same over the removed color
            if (alpha > 0) for (let k = 0; k < 3; k++) bitmap[i + k] = Math.round((bitmap[i + k] - c[k]) / alpha + c[k]);
            bitmap[i + 3] = Math.round(bitmap[i + 3] * alpha);
        }

        return this;
    }

    /**
     * Maps every color channel value through a function (evaluated once per value 0..255), alpha is kept
     * @internal
     * @ignore
     */
    protected __map_channels__(map: (value: number) => number): this {
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) lut[v] = map(v);

        const bitmap = this.bitmap;
        for (let i = 0; i < bitmap.length; i += 4) {
            bitmap[i] = lut[bitmap[i]];
            bitmap[i + 1] = lut[bitmap[i + 1]];
            bitmap[i + 2] = lut[bitmap[i + 2]];
        }

        return this;
    }

    /**
     * Gets the average color of the image, weighting each pixel by its opacity
     * @returns The average color (fully opaque), black for fully transparent images
     */
    averageColor(): Color {
        let r = 0, g = 0, b = 0, weight = 0;
        for (let i = 0; i < this.bitmap.length; i += 4) {
            const a = this.bitmap[i + 3];
            r += this.bitmap[i] * a;
            g += this.bitmap[i + 1] * a;
            b += this.bitmap[i + 2] * a;
            weight += a;
        }

        if (!weight) return Colors.fromRGBA(0, 0, 0, 0xff);
        return Colors.fromRGBA(Math.round(r / weight), Math.round(g / weight), Math.round(b / weight), 0xff);
    }

    /**
     * Gets the image's dominant color: the colors are grouped into a few clusters (median cut and k-means),
     * the average color of the largest one is returned
     * @param options Which colors to ignore, see {@link DominantColorOptions}
     * @return The image's dominant color (fully opaque); mostly transparent pixels are ignored.
     *     If every pixel is ignored as black or white, the filter is dropped
     */
    dominantColor(options?: DominantColorOptions): Color;
    dominantColor(options: DominantColorOptions = {}): Color {
        checkOptions(options, 'dominantColor({ ignoreBlack: false })');
        const { ignoreBlack = true, ignoreWhite = true, threshold: bwThreshold = 0xf } = options;
        const threshold = Math.min(64, Math.max(0, finite(bwThreshold, 'threshold'))) * 4;
        const pixels = this.__bytes__();

        const color = quantize.dominantColor(pixels, (r, g, b) =>
            !(ignoreBlack && Math.max(r, g, b) < threshold) && !(ignoreWhite && Math.min(r, g, b) > 255 - threshold))
            || quantize.dominantColor(pixels, () => true);

        return color ? Colors.fromRGB(...color) : Colors.fromRGBA(0, 0, 0, 0xff);
    }

    /**
     * Rotates the image clockwise by the given angle in degrees (like CSS' `rotate()`; negative angles turn it
     * counterclockwise). Multiples of 90° move whole pixels; other angles resample the image (see
     * {@link RotateOptions.mode}) and, by default, grow it so the corners fit
     * @param angle The angle in degrees, clockwise
     * @param options See {@link RotateOptions}
     */
    rotate(angle: number, options?: RotateOptions): this;
    rotate(angle: number, options: RotateOptions = {}): this {
        checkOptions(options, 'rotate(angle, { expand: false })');
        const { expand = true, mode = 'bilinear' } = options;
        if (!TRANSFORM_MODES.includes(mode)) throw new TypeError(`rotate mode must be one of ${TRANSFORM_MODES.map(name => `'${name}'`).join(', ')}, not ${String(mode)}`);
        // (counterclockwise from here on: the image's y axis points down, so this turns it clockwise on screen)
        angle = ((-finite(angle, 'angle') % 360) + 360) % 360;
        if (angle === 0) return this;

        const {width, height} = this;
        const src = this.__u32__;

        // (the gain map: the same rotation, sampled)
        const rotateGainMap = (outWidth: number, outHeight: number): void => {
            const rad = angle * Math.PI / 180, sin = Math.sin(rad), cos = Math.cos(rad);
            this.__gain_map__?.__transform__(width, height, outWidth, outHeight, (X, Y) => {
                const dx = X - outWidth / 2, dy = Y - outHeight / 2;
                return [dx * cos - dy * sin + width / 2, dx * sin + dy * cos + height / 2];
            });
        };

        // right angles are exact pixel permutations
        if (angle === 90 || angle === 180 || angle === 270) {
            const out = new Image(angle === 180 ? width : height, angle === 180 ? height : width);
            const dst = out.__u32__;

            for (let y = 0; y < height; y++)
                for (let x = 0; x < width; x++) {
                    const i = src[y * width + x];
                    if (angle === 90) dst[(width - 1 - x) * height + y] = i;
                    else if (angle === 180) dst[(height - 1 - y) * width + width - 1 - x] = i;
                    else dst[x * height + height - 1 - y] = i;
                }

            rotateGainMap(out.width, out.height);
            return this.__apply__(out);
        }

        const rad = angle * Math.PI / 180;
        const sin = Math.sin(rad), cos = Math.cos(rad);
        const outWidth = expand ? Math.round(Math.abs(width * cos) + Math.abs(height * sin)) : width;
        const outHeight = expand ? Math.round(Math.abs(width * sin) + Math.abs(height * cos)) : height;
        const out = new Image(outWidth, outHeight);
        rotateGainMap(outWidth, outHeight);
        // the source position of each output position (pixel centers), around the middles of both images
        const inverse: [number, number, number, number, number, number] = [cos, sin, -sin, cos,
            width / 2 - cos * outWidth / 2 + sin * outHeight / 2, height / 2 - sin * outWidth / 2 - cos * outHeight / 2];
        sampleAffine(this.bitmap, width, height, out.bitmap, outWidth, outHeight, inverse, 0, 0, mode);
        return this.__apply__(out);
    }

    /**
     * Flips / mirrors the image horizontally or vertically
     * @param direction The direction to flip
     */
    flip(direction: 'horizontal' | 'vertical'): this {
        const u32 = this.__u32__;
        const {width, height} = this;

        if (direction === 'horizontal') {
            for (let y = 0; y < height; y++) u32.subarray(y * width, (y + 1) * width).reverse();
        } else if (direction === 'vertical') {
            for (let y = 0; y < height >> 1; y++) {
                const top = u32.slice(y * width, (y + 1) * width);
                u32.copyWithin(y * width, (height - 1 - y) * width, (height - y) * width);
                u32.set(top, (height - 1 - y) * width);
            }
        } else throw new RangeError('Invalid flip direction');

        this.__gain_map__?.__transform__(width, height, width, height, direction === 'horizontal' ? (X, Y) => [width - X, Y] : (X, Y) => [X, height - Y]);
        return this;
    }

    /**
     * @internal the bitmap as a plain byte view
     * @ignore
     */
    protected __bytes__(): Uint8Array {
        return new Uint8Array(this.bitmap.buffer, this.bitmap.byteOffset, this.bitmap.byteLength);
    }

    /**
     * A change after which the image has no HDR highlights (the inverts: the boosted light would become the darkest):
     * made to the pixels, the map then boosts nothing
     * @internal
     * @ignore
     */
    protected __unboost__(apply: (image: Image) => void): this {
        const map = this.__gain_map__ as GainMap;
        this.__gain_map__ = null;
        try {
            apply(this);
        } finally {
            this.__gain_map__ = gain.neutralMap(map, this.width, this.width, this.height);
        }
        return this;
    }

    /**
     * A color change with a gain map: made to the pixels (without the map), then to the map (the same change made to
     * the HDR rendition, see util/gain.ts; `exact`: the change as a function of an encoded value, for values above SDR
     * white too). Changes of only the colors' hue and saturation leave a single channel map as it is
     * @internal
     * @ignore
     */
    protected __recolor__(apply: (image: Image) => void, chromaOnly = false, exact?: (value: number) => number): this {
        const map = this.__gain_map__ as GainMap;
        this.__gain_map__ = null;
        try {
            if (chromaOnly && map.channels === 1) {
                apply(this);
                return this;
            }
            const before = this.__resize__(map.width, map.height);
            apply(this);
            gain.recolor(map, before, apply, exact);
            return this;
        } finally {
            this.__gain_map__ = map;
        }
    }

    /**
     * For a resize to the given size that only produces a part of it (frames scale their offsets)
     * @internal
     * @ignore
     */
    protected __rescaled__?(width: number, height: number): void;

    /**
     * @internal
     * @ignore
     */
    protected __apply__(image: Image): this {
        this.__width__ = image.__width__;
        this.__height__ = image.__height__;
        this.__bitmap__ = image.__bitmap__;
        this.__view__ = image.__view__;
        this.__u32__ = image.__u32__;

        return this;
    }

    /**
     * Rounds the images corners, with antialiased edges
     * @param options See {@link RoundCornersOptions}
     */
    roundCorners(options?: RoundCornersOptions): this;
    roundCorners(options: RoundCornersOptions = {}): this {
        checkOptions(options, 'roundCorners({ radius: 10 })');
        let radius = options.radius ?? Math.min(this.width, this.height) / 4;
        radius = finite(radius, 'radius');
        radius = Math.max(0, Math.min(radius, this.width / 2, this.height / 2));
        const size = Math.ceil(radius);

        // coverage of the top left corner, mirrored onto the others
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const coverage = pixelCoverage(x, y, (sx, sy) => sx >= radius || sy >= radius || (sx - radius) ** 2 + (sy - radius) ** 2 <= radius * radius);
                if (coverage >= 1) continue;

                // corners can share the middle row/column of odd sized images
                const corners = new Set([[x, y], [this.width - 1 - x, y], [x, this.height - 1 - y], [this.width - 1 - x, this.height - 1 - y]].map(([px, py]) => py * this.width + px));
                for (const pixel of corners) this.bitmap[pixel * 4 + 3] *= coverage;
            }
        }

        return this;
    }

    /**
     * Applies a fisheye (barrel distortion) effect
     * @param options See {@link FisheyeOptions}
     */
    fisheye(options?: FisheyeOptions): this;
    fisheye(options: FisheyeOptions = {}): this {
        checkOptions(options, 'fisheye({ strength: 3 })');
        const strength = finite(options.strength ?? 2, 'strength');
        const r = new Image(this.width, this.height);

        const w = this.width;
        const h = this.height;
        const tu32 = this.__u32__;
        const ru32 = r.__u32__;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const xco = (x + 0.5) / w - 0.5;
                const yco = (y + 0.5) / h - 0.5;
                const dfc = Math.sqrt(xco ** 2 + yco ** 2);

                if (dfc === 0) {
                    ru32[y * w + x] = tu32[y * w + x];
                    continue;
                }

                const dis = 2 * dfc ** strength;
                const nx = Math.floor((dis * xco / dfc + 0.5) * w);
                const ny = Math.floor((dis * yco / dfc + 0.5) * h);
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

                ru32[y * w + x] = tu32[ny * w + nx];
            }
        }

        this.__gain_map__?.__transform__(w, h, w, h, (X, Y) => {
            const xco = X / w - 0.5, yco = Y / h - 0.5, dfc = Math.sqrt(xco ** 2 + yco ** 2);
            if (dfc === 0) return [X, Y];
            const dis = 2 * dfc ** strength;
            return [(dis * xco / dfc + 0.5) * w, (dis * yco / dfc + 0.5) * h];
        });
        return this.__apply__(r);
    }


    /**
     * Encodes the image into a PNG, with the smallest lossless color type (a palette for up to 256 colors,
     * grayscale or RGB, alpha only if needed). Uses the runtime's native zlib when available
     * @param options See {@link PNGEncodeOptions}
     * @return The encoded data
     */
    encodePNG(options?: PNGEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodePNG(options: PNGEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodePNG({ compression: 9, metadata: { author: \'me\' } })');
        const { compression = 4, metadata = {} } = options;

        return png.encodeRGBA(this.__bytes__(), this.width, this.height, compressionLevel(compression), pngText(resolveMetadata(metadata)));
    }

    /**
     * Encodes the image into a JPEG
     * @param options See {@link JPEGEncodeOptions}
     */
    encodeJPEG(options?: JPEGEncodeOptions): Promise<Uint8Array<ArrayBuffer>>;
    async encodeJPEG(options: JPEGEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'encodeJPEG({ quality: 80 })');
        const { quality = 90, subsampling, metadata = {}, gainMap: gainMapOption = true } = options;
        if (subsampling !== undefined && subsampling !== '4:4:4' && subsampling !== '4:2:0') throw new TypeError(`subsampling must be '4:4:4' or '4:2:0', not ${String(subsampling)}`);
        const m = resolveMetadata(metadata);
        const base = { exif: exifData(m), comment: m.comment ? utf8(m.comment) : undefined, subsampling };
        const gainMap = this.__gain_map__;
        if (!gainMap || gainMapOption === false) return jpeg.encode(this.__bytes__(), this.width, this.height, finite(quality, 'quality'), base);

        // the gain map's JPEG first: the primary's XMP holds its length
        const { quality: mapQuality, scale } = typeof gainMapOption === 'object' && gainMapOption !== null ? gainMapOption : {} as GainMapEmbedOptions;
        let width: number | undefined, height: number | undefined;
        if (scale !== undefined) {
            const s = finite(scale, 'gain map scale');
            if (!(s > 0 && s <= 1)) throw new RangeError(`The gain map scale must be above 0 and at most 1, not ${s}`);
            width = Math.max(1, Math.round(this.width * s));
            height = Math.max(1, Math.round(this.height * s));
        }
        const params = gainMap.__params__();
        const map = gainMapCodec.mapWithMetadata(gainMap.__body__(mapQuality === undefined ? undefined : Math.max(1, checkQuality(mapQuality, 'gain map quality')), width, height), params);
        const primary = jpeg.encode(this.__bytes__(), this.width, this.height, finite(quality, 'quality'), { ...base, segments: gainMapCodec.primarySegments(map.length) });
        return gainMapCodec.finish(primary, map);
    }

    /**
     * Encodes the image as WebP: lossless (usually 20-30% smaller than PNG, but slower to encode), or lossy with a
     * quality
     * @param options See {@link WebPEncodeOptions}
     */
    async encodeWebP(options: WebPEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'image.encodeWebP({ quality: 80 })');
        const { quality, effort = 2, sharpYuv = false, alphaQuality = 100, threads = defaultThreads(), metadata = {} } = options;
        checkThreads(threads);
        const exif = exifData(resolveMetadata(metadata));
        const lossy = webp.lossyOptions(quality, effort, sharpYuv, alphaQuality);
        if (!lossy) return webp.encode(this.__bytes__(), this.width, this.height, exif, threads, effort);
        return webp.encodeLossy(this.__bytes__(), this.width, this.height, lossy, exif);
    }

    /**
     * Encodes the image as run length encoded TGA (32 bit, or 24 bit if the image is opaque)
     * @param options See {@link EncodeOptions}
     */
    async encodeTGA(options: TGAEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'image.encodeTGA({ metadata })');
        const { metadata = {} } = options;
        const { author, comment, creationTime: time, software } = resolveMetadata(metadata);
        return tga.encode(this.__bytes__(), this.width, this.height, { author, comment, time, software });
    }

    /**
     * Encodes the image as BMP: with a palette if it is opaque and has at most 256 colors, else with 24 bit pixels, or
     * 32 bit ones if it has transparency
     */
    async encodeBMP(): Promise<Uint8Array<ArrayBuffer>> {
        return bmp.encode(this.__bytes__(), this.width, this.height);
    }

    /**
     * Encodes the image as QOI (3 channels if the image is opaque)
     */
    async encodeQOI(): Promise<Uint8Array<ArrayBuffer>> {
        return qoi.encode(this.__bytes__(), this.width, this.height);
    }

    /**
     * Encodes the image as AVIF (AV1, with an alpha image if the image has transparency)
     * @param options See {@link AVIFEncodeOptions}
     */
    async encodeAVIF(options: AVIFEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'image.encodeAVIF({ quality: 60 })');
        const { quality = 60, alphaQuality = 100, subsampling = '4:4:4', effort = 1, threads = defaultThreads(), metadata = {}, gainMap = true } = options;
        checkEffort(effort, 2);
        checkThreads(threads);
        if (subsampling !== '4:4:4' && subsampling !== '4:2:0') throw new TypeError(`subsampling must be '4:4:4' or '4:2:0', not ${String(subsampling)}`);
        const exif = exifData(resolveMetadata(metadata));
        return avifEnc.encode(this.__bytes__(), this.width, this.height, {
            quality: checkQuality(quality), alphaQuality: checkQuality(alphaQuality, 'alphaQuality'), subsampling, effort, exif, threads, gainMap: this.__gain_map_pixels__(gainMap)
        });
    }

    /**
     * The gain map to write for an encode's gainMap option (its pixels at the asked scale, its parameters, the
     * quality), undefined without one
     * @internal
     * @ignore
     */
    protected __gain_map_pixels__(option: boolean | { quality?: number, scale?: number }): { pixels: Uint8Array, width: number, height: number, params: gainMapCodec.Params, quality: number } | undefined {
        const gainMap = this.__gain_map__;
        if (!gainMap || option === false) return undefined;
        const { quality = 90, scale } = typeof option === 'object' && option !== null ? option : {} as { quality?: number, scale?: number };
        const mapQuality = Math.max(1, checkQuality(quality, 'gain map quality'));
        let map = gainMap.image;
        if (scale !== undefined) {
            const s = finite(scale, 'gain map scale');
            if (!(s > 0 && s <= 1)) throw new RangeError(`The gain map scale must be above 0 and at most 1, not ${s}`);
            const width = Math.max(1, Math.round(this.width * s)), height = Math.max(1, Math.round(this.height * s));
            if (width !== map.width || height !== map.height) map = map.clone().resize(width, height);
        }
        return { pixels: map.__bytes__(), width: map.width, height: map.height, params: gainMap.__params__(), quality: mapQuality };
    }

    /**
     * Encodes the image as JPEG XL: losslessly (the default) like libjxl's `cjxl -e 3` (a palette of up to 1024 colors,
     * else palettes of channels using few of their values; YCoCg; the weighted predictor in contexts of its error;
     * grayscale if the image is), at effort 0 the codestream byte for byte like `cjxl -e 1` on CPUs with AVX2 or NEON
     * (its fast lossless mode: the gradient predictor, a palette if the image has at most 511 colors besides black,
     * else YCoCg), or lossy with a quality (like `cjxl -q`: XYB, varblocks of libjxl's search, chroma from luma, the
     * edge preserving filter). Alpha (if the image has transparency) is lossless either way. The codestream is in the
     * container, with the metadata as Exif
     * @param options See {@link JXLEncodeOptions}
     */
    async encodeJXL(options: JXLEncodeOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
        checkOptions(options, 'image.encodeJXL({ quality: 90 })');
        const { quality, effort = 1, threads = defaultThreads(), metadata = {}, gainMap = true } = options;
        checkEffort(effort, 2);
        checkThreads(threads);
        // (cjxl's distance of a quality)
        const distanceOf = (q: number): number => q >= 100 ? 0 : q >= 30 ? 0.1 + (100 - q) * 0.09 : 53 / 3000 * q * q - 23 / 20 * q + 25;
        const distance = quality === undefined ? 0 : distanceOf(checkQuality(quality));
        const map = this.__gain_map_pixels__(gainMap);
        return jxl.encode(this.__bytes__(), this.width, this.height, exifData(resolveMetadata(metadata)), distance, effort, threads, map && { ...map, distance: distanceOf(map.quality) });
    }

    /**
     * Encodes the image as the smallest fitting Netpbm format: PBM for black and white images, PGM for grayscale ones,
     * PPM for others, PAM if the image has transparency
     */
    async encodePNM(): Promise<Uint8Array<ArrayBuffer>> {
        return netpbm.encode(this.__bytes__(), this.width, this.height);
    }

    /**
     * Decodes an image (PNG, JPEG, TIFF, WebP, BMP, ICO, CUR, QOI, PBM, PGM, PPM, PAM, PFM, Radiance HDR, TGA, AVIF or
     * JPEG XL). For animations (GIFs, animated WebPs, AVIF image sequences, JPEG XL animations) this is the first frame,
     * composed onto the canvas as {@link Animation.decode} has it, and decoding stops after it: use
     * {@link Animation.decode} for all frames. For APNGs this is the default image, which is what viewers without APNG
     * support show; for icons and cursors it's their largest image
     * @param input The binary data to decode
     * @param options See {@link DecodeOptions}. JPEGs, TIFFs and PNGs are rotated/mirrored as their orientation tag
     *     (Exif, for PNGs also XMP) says by default: photos taken with a rotated camera are stored sideways
     * @return The decoded image
     */
    static async decode(input: BinaryData, options: DecodeOptions = {}): Promise<Image> {
        checkOptions(options, 'Image.decode(data, { maxPixels: 1e8 })');
        const { applyOrientation = true, applyColorProfile = true, maxPixels = MAX_PIXELS, toneMapping = 'reinhard', threads = defaultThreads(), gainMap = true } = options;
        checkThreads(threads);
        if (!(Number(maxPixels) > 0)) throw new RangeError(`maxPixels must be a positive number, not ${maxPixels}`);
        if (toneMapping !== 'reinhard' && toneMapping !== 'clamp') throw new TypeError(`toneMapping must be 'reinhard' or 'clamp', not ${String(toneMapping)}`);
        const data = view(input);
        const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

        const decoded: { width: number, height: number, pixels: Uint8Array, orientation?: number, icc?: Uint8Array, cicp?: [number, number], colorSpace?: jxl.ColorSpace, gainMap?: avif.DecodedGainMap } = await decoding(() => {
            if (ImageType.isPNG(dataView)) return png.decode(data, maxPixels);
            if (ImageType.isJPEG(dataView)) return jpeg.decode(data, { maxPixels });
            if (ImageType.isTIFF(dataView)) return tiff.decode(data, maxPixels);
            if (ImageType.isWebP(dataView)) {
                if (!webp.isAnimated(data)) return webp.decode(data, maxPixels);
                // the first frame only: the rest of the file isn't decoded
                const animation = webp.decodeAnimation(data, true, maxPixels);
                return { width: animation.width, height: animation.height, pixels: webp.composite(animation)[0].pixels, orientation: animation.orientation, icc: animation.icc };
            }
            // bitmaps can hold a JPEG or PNG, icons PNGs
            const bitmap = async (decoded: bmp.Decoded): Promise<{ width: number, height: number, pixels: Uint8Array }> => {
                if (!('embedded' in decoded)) return decoded;
                // (without their orientation tags)
                const { width, height, pixels } = decoded.embedded === 'png' ? await png.decode(decoded.data, maxPixels) : jpeg.decode(decoded.data, { maxPixels });
                return { width, height, pixels };
            };
            if (ImageType.isAVIF(dataView)) return avif.decode(data, maxPixels, toneMapping, threads, gainMap);
            if (ImageType.isJXL(dataView)) return jxl.decode(data, maxPixels, toneMapping, threads, gainMap);
            if (ImageType.isBMP(dataView)) return bitmap(bmp.decode(data, maxPixels));
            if (ImageType.isICO(dataView)) return bitmap(ico.decode(data, maxPixels));
            if (ImageType.isQOI(dataView)) return qoi.decode(data, maxPixels);
            if (ImageType.isPNM(dataView)) return netpbm.decode(data, maxPixels, toneMapping);
            if (ImageType.isHDR(dataView)) return hdr.decode(data, maxPixels, toneMapping);
            if (ImageType.isTGA(dataView)) return tga.decode(data, maxPixels);
            if (ImageType.isGIF(dataView)) {
                // the first frame only: the rest of the file isn't decoded
                const gifData = gif.decode(data, true, maxPixels);
                const [first] = gif.composite(gifData);
                if (!first) throw new Error('GIF: no frames');
                return { width: gifData.width, height: gifData.height, pixels: first.pixels };
            }
            throw new Error('Unsupported image type');
        });

        // (without one: an AVIF's color primaries and transfer, a JPEG XL's enumerated color space)
        if (applyColorProfile) {
            const { icc, cicp, colorSpace } = decoded;
            (icc ? profileTransform(icc) : cicp ? cicpTransform(...cicp) : colorSpace ? colorSpaceTransform(colorSpace.xy, colorSpace.curve) : null)?.(decoded.pixels);
        }
        // the decoded pixels become the bitmap, without a copy
        const image = new Image(decoded.width, decoded.height);
        image.bitmap = decoded.pixels;
        // (a gain map that can't be read leaves the image without one, it doesn't fail the decoding)
        if (gainMap && ImageType.isJPEG(dataView)) {
            try {
                const found = gainMapCodec.find(data);
                const size = found && gainMapCodec.dimensions(found.map);
                if (found && size && size.width * size.height <= maxPixels) image.__gain_map__ = GainMap.__from_jpeg__(found.map, found.params, found.apple);
            } catch {
                image.__gain_map__ = null;
            }
        }
        if (decoded.gainMap) {
            const { width, height, pixels, params } = decoded.gainMap;
            const map = new Image(width, height);
            map.bitmap = pixels;
            image.__gain_map__ = GainMap.__from_pixels__(map, params);
        }
        if (applyOrientation && decoded.orientation && decoded.orientation > 1) {
            image.__orient__(decoded.orientation);
            const map = image.__gain_map__;
            if (map) {
                try {
                    map.image = map.image.__orient__(decoded.orientation);
                } catch {
                    image.__gain_map__ = null;
                }
            }
        }
        return image;
    }

    /**
     * Applies an Exif orientation (1-8), turning the stored pixels into the displayed ones
     * @internal
     * @ignore
     */
    __orient__(orientation: number): this {
        if (orientation <= 1 || orientation > 8) return this;

        const w = this.width, h = this.height;
        const swap = orientation >= 5;
        const out = new Image(swap ? h : w, swap ? w : h);
        const src = this.__u32__, dst = out.__u32__;
        const ow = out.width, oh = out.height;

        // source pixel of every output pixel (X, Y)
        for (let Y = 0; Y < oh; Y++) {
            for (let X = 0; X < ow; X++) {
                let x: number, y: number;
                switch (orientation) {
                    case 2: x = w - 1 - X; y = Y; break; // mirrored horizontally
                    case 3: x = w - 1 - X; y = h - 1 - Y; break; // rotated 180
                    case 4: x = X; y = h - 1 - Y; break; // mirrored vertically
                    case 5: x = Y; y = X; break; // transposed
                    case 6: x = Y; y = h - 1 - X; break; // needs a 90 degree clockwise rotation
                    case 7: x = w - 1 - Y; y = h - 1 - X; break; // transversed
                    default: x = w - 1 - Y; y = X; break; // 8, needs a 90 degree counterclockwise rotation
                }
                dst[Y * ow + X] = src[y * w + x];
            }
        }

        return this.__apply__(out);
    }

    /**
     * Creates a new image from the given SVG
     * Supports shapes, paths, transforms, use/symbol, CSS styles, gradients, patterns, strokes, markers, clip paths,
     * masks, opacity, blend modes, filters (all primitives and the filter functions) and images embedded as data URIs
     * (PNG, JPEG, GIF, WebP, SVG) or given with {@link SVGOptions.images}, and text with the given or embedded fonts
     * (see {@link SVGOptions.fonts}). Hrefs are resolved from the options and the data URIs only, never from files or URLs.
     * @example
     * ```ts
     * const logo = await Image.renderSVG(
     *     '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="logo.png" width="64" height="64"/></svg>',
     *     { images: { 'logo.png': logoPNG } } // (the PNG's bytes, e.g. from a fetch or a file you read)
     * );
     * ```
     * @param svg The SVG content
     * @param options See {@link SVGOptions}
     * @return The rendered SVG graphic
     */
    static renderSVG(svg: string | BinaryData, options?: SVGOptions): Promise<Image>;
    static async renderSVG(svg: string | BinaryData, options: SVGOptions = {}): Promise<Image> {
        checkOptions(options, 'renderSVG(svg, { width: 512 })');
        const { width: givenWidth, height: givenHeight, scale, fonts = [], images: givenImages = {} } = options;
        const sizes = [givenWidth, givenHeight, scale].filter(value => value !== undefined).length;
        if (sizes > 1) throw new TypeError('renderSVG() takes one of width, height and scale');
        const mode = givenWidth !== undefined ? 'width' : givenHeight !== undefined ? 'height' : 'scale';
        const size = finite(givenWidth ?? givenHeight ?? scale ?? 1, `SVG ${mode}`);
        if (mode === 'scale' && size <= 0)
            throw new RangeError('SVG scale must be > 0');
        if (mode !== 'scale' && size < 1)
            throw new RangeError(`SVG ${mode} must be >= 1`);

        // the images given by href, checked before anything is decoded
        if (typeof givenImages !== 'object' || givenImages === null || Array.isArray(givenImages) || givenImages instanceof Map)
            throw new TypeError('SVG images must be an object of hrefs to image data');
        const given = new Map<string, BinaryData | Image>();
        for (const href of Object.keys(givenImages)) {
            const value = givenImages[href];
            if (!(value instanceof Image) && !(value instanceof ArrayBuffer || ArrayBuffer.isView(value)))
                throw new TypeError(`SVG image ${JSON.stringify(href)} must be BinaryData or an Image`);
            given.set(href, value);
        }

        // the raster images it references are decoded first (decoding can be asynchronous), the SVG is rendered at once.
        // A given image wins over a data URI with the same href; each is decoded once, and only if the SVG uses it
        const source = typeof svg === 'string' ? svg : view(svg);
        const images = new Map<string, svgRenderer.RasterImage>();
        for (const { href, data } of svgRenderer.imageReferences(source)) {
            const value = given.get(href) ?? data;
            if (!value) continue;
            try {
                if (value instanceof Image) {
                    images.set(href, { width: value.width, height: value.height, pixels: value.bitmap });
                } else if (ImageType.getType(value) === 'gif') {
                    // (a GIF's first frame)
                    const decoded = gif.decode(view(value), true);
                    images.set(href, { width: decoded.width, height: decoded.height, pixels: gif.composite(decoded)[0].pixels });
                } else {
                    const image = await Image.decode(value);
                    images.set(href, { width: image.width, height: image.height, pixels: image.bitmap });
                }
            } catch {
                // (images that can't be decoded aren't drawn, like resvg's)
            }
        }

        const {width, height, pixels} = svgRenderer.render(source, mode, size, images, fonts.map(font => view(font)));
        const image = new Image(width, height);
        image.bitmap.set(pixels);

        return image;
    }

    /**
     * Creates a new image containing the rendered text.
     * @param text Text to render
     * @param options The font and size, color, layout and style, see {@link RenderTextOptions}; the image grows by the
     *     outline width on every side
     * @return The rendered text
     */
    static async renderText(text: string, options: RenderTextOptions): Promise<Image> {
        if (typeof text !== 'string' || !isOptions(options)) throw new TypeError('renderText() takes the text and an options object, like renderText(\'Hello\', { font, size: 32 })');
        if (options.font === undefined) throw new TypeError('renderText(text, options) needs the font in the options');
        const { font, color = 0xffffffff, strokeWidth = 0, strokeColor = 0x000000ff, hinting = true, features = {}, variations = {} } = options;
        const layout = new TextLayout(options.layout);
        const axes = textRenderer.axisValues(variations);
        const size = finite(options.size, 'font size');
        if (size < 0) throw new RangeError(`Invalid font size: ${size}`);
        if (finite(strokeWidth, 'stroke width') < 0)
            throw new RangeError('Invalid stroke width');
        const fonts = Array.isArray(font) ? font : [font];
        if (!fonts.length) throw new RangeError('No font given');

        const [r, g, b, a] = Colors.toRGBA(color);
        // color glyph layers in the text color take it without its alpha, which applies to the whole color glyph
        const rendered = await textRenderer.render(fonts.map(view), size, text, layout, hinting, (r << 24 | g << 16 | b << 8 | 255) >>> 0, featureList(features), axes);

        // the outline needs room around the glyphs
        const pad = Math.ceil(strokeWidth);
        const width = rendered.width + 2 * pad, height = rendered.height + 2 * pad;
        const coverage = new Uint8Array(width * height);
        for (let y = 0; y < rendered.height; y++)
            coverage.set(rendered.coverage.subarray(y * rendered.width, (y + 1) * rendered.width), (y + pad) * width + pad);
        let colored: Uint8ClampedArray | null = null;
        if (rendered.color) {
            colored = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < rendered.height; y++)
                colored.set(rendered.color.subarray(y * rendered.width * 4, (y + 1) * rendered.width * 4), ((y + pad) * width + pad) * 4);
        }

        const image = new Image(width, height);
        const bitmap = image.bitmap;

        if (!strokeWidth && !colored) {
            // the pixel for each coverage value, written as one word
            const pixels = new Uint32Array(bitmap.buffer, bitmap.byteOffset, bitmap.length >> 2), lut = new Uint32Array(256);
            const bytes = new Uint8ClampedArray(lut.buffer);
            for (let v = 1; v < 256; v++) bytes.set([r, g, b, v * a / 255], v * 4);
            for (let i = 0; i < coverage.length; i++) if (coverage[i]) pixels[i] = lut[coverage[i]];
            return image;
        }

        // the outline goes around the color glyphs as well
        let shape = coverage;
        if (colored) {
            shape = coverage.slice();
            for (let i = 0; i < shape.length; i++) shape[i] = Math.max(shape[i], colored[i * 4 + 3]);
        }
        const stroke = strokeWidth ? outline(shape, width, height, strokeWidth) : null;
        const [sr, sg, sb, sa] = Colors.toRGBA(strokeColor);

        // color glyphs over the text (premultiplied, with the text's alpha), both within their outline
        for (let i = 0; i < coverage.length; i++) {
            let af = coverage[i] / 255 * a / 255, pr = r * af, pg = g * af, pb = b * af;
            if (colored && colored[i * 4 + 3]) {
                const ca = colored[i * 4 + 3] / 255 * a / 255, keep = 1 - ca, f = a / 255;
                pr = colored[i * 4] * f + pr * keep;
                pg = colored[i * 4 + 1] * f + pg * keep;
                pb = colored[i * 4 + 2] * f + pb * keep;
                af = ca + af * keep;
            }
            if (stroke) {
                // the outline shows around the glyphs only, not through translucent ones (for opaque text it's the
                // same as drawing the glyphs over it)
                const as = stroke[i] * sa / 255 * (1 - shape[i] / 255);
                pr += sr * as;
                pg += sg * as;
                pb += sb * as;
                af += as;
            }
            if (af <= 0) continue;

            bitmap[i * 4] = pr / af;
            bitmap[i * 4 + 1] = pg / af;
            bitmap[i * 4 + 2] = pb / af;
            bitmap[i * 4 + 3] = af * 255;
        }

        return image;
    }

}

// samples per pixel axis for antialiased edges
const SUBSAMPLES = 4;

// share of the pixel's area for which inside(x, y) holds, estimated on a regular grid
function pixelCoverage(px: number, py: number, inside: (x: number, y: number) => boolean): number {
    let count = 0;
    for (let j = 0; j < SUBSAMPLES; j++)
        for (let i = 0; i < SUBSAMPLES; i++)
            if (inside(px + (i + 0.5) / SUBSAMPLES, py + (j + 0.5) / SUBSAMPLES)) count++;
    return count / (SUBSAMPLES * SUBSAMPLES);
}

// share of the pixel covered by a circle, only edge pixels are sampled
function circleCoverage(px: number, py: number, cx: number, cy: number, radius: number): number {
    const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
    if (d <= radius - Math.SQRT1_2) return 1;
    if (d >= radius + Math.SQRT1_2) return 0;
    return pixelCoverage(px, py, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius);
}

// rounds and clamps a channel value to 0..255 (NaN becomes 0)
interface HSLA {
    h: number;
    s: number;
    l: number;
    a: number;
}

/**
 * The width, height and mode of resize()'s signatures: a side left out of the options is `undefined`
 * @internal
 */
export function resizeArguments(widthOrOptions: number | ResizeToOptions, height?: number, options?: ResizeOptions): [width: number | undefined, height: number | undefined, options: ResizeOptions | undefined, fit: 'fill' | 'inside'] {
    if (!isOptions(widthOrOptions)) {
        checkOptions(options, 'resize(width, height, { mode: \'area\' })');
        return [finite(widthOrOptions, 'width'), finite(height as number, 'height'), options, 'fill'];
    }
    const { width, height: optionsHeight, fit = 'fill', ...rest } = widthOrOptions;
    if (width === undefined && optionsHeight === undefined) throw new TypeError('resize() needs a width, a height or both');
    if (fit !== 'fill' && fit !== 'inside') throw new TypeError(`fit must be 'fill' or 'inside', not ${String(fit)}`);
    return [width === undefined ? undefined : finite(width, 'width'), optionsHeight === undefined ? undefined : finite(optionsHeight, 'height'), rest, fit];
}

/**
 * The size of an image of `width` x `height` resized to fit inside a box of `boxWidth` x `boxHeight`, keeping its aspect
 * ratio: the limiting side matches the box exactly (rounded instead of floored), the other one is at least 1 pixel
 */
export function insideSize(width: number, height: number, boxWidth: number, boxHeight: number): [width: number, height: number] {
    boxWidth = Math.floor(boxWidth);
    boxHeight = Math.floor(boxHeight);
    const scale = Math.min(boxWidth / width, boxHeight / height);
    return [Math.max(1, Math.min(boxWidth, Math.round(width * scale))), Math.max(1, Math.min(boxHeight, Math.round(height * scale)))];
}

function resizeOptions(options?: ResizeOptions): { mode: ResizeMode, fast: boolean } {
    return { mode: options?.mode ?? 'bilinear', fast: options?.fast ?? true };
}

// separable blend functions of normalized channel values (W3C Compositing and Blending Level 1)
const hardLight = (b: number, s: number): number => s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1));

const BLEND_MODES: Record<BlendMode, (backdrop: number, source: number) => number> = {
    'normal': (_b, s) => s,
    'multiply': (b, s) => b * s,
    'screen': (b, s) => b + s - b * s,
    'overlay': (b, s) => hardLight(s, b),
    'darken': (b, s) => Math.min(b, s),
    'lighten': (b, s) => Math.max(b, s),
    'color-dodge': (b, s) => b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s)),
    'color-burn': (b, s) => b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s),
    'hard-light': hardLight,
    'soft-light': (b, s) => {
        if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
        const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        return b + (2 * s - 1) * (d - b);
    },
    'difference': (b, s) => Math.abs(b - s),
    'exclusion': (b, s) => b + s - 2 * b * s,
    'add': (b, s) => Math.min(1, b + s)
};

// the color at every position of a gradient, from its stops
function gradientFunction(stops: Record<number, Color> | Color[]): (position: number) => Color {
    return Colors.gradient(stops);
}

/**
 * Grows a coverage mask by a radius, using the distance of every pixel to the glyphs (an exact euclidean distance
 * transform, so the cost doesn't depend on the radius). Near the outline's edge, the distance goes to the glyph edge
 * within the pixels around the nearest covered one (estimated from their coverage and its gradient, like Gustavson's
 * antialiased distance transform), so the outline follows the antialiased edge instead of the pixels
 * @return the outline's coverage (0..1) per pixel, including the area under the glyphs
 */
// covered pixels around the nearest one (on either side) whose edge points the outline's edge is measured to
const OUTLINE_WINDOW = 1;

function outline(coverage: Uint8Array, width: number, height: number, radius: number): Float32Array {
    const count = width * height;
    // squared distance to the nearest pixel that is at least half covered, and that pixel's coordinates
    const distance = new Float64Array(count);
    for (let i = 0; i < count; i++) distance[i] = coverage[i] >= 128 ? 0 : Infinity;
    const nearestY = new Int32Array(count), nearestX = new Int32Array(count);

    const size = Math.max(width, height);
    const line = new Float64Array(size), result = new Float64Array(size), nearest = new Int32Array(size);
    const parabolas = new Int32Array(size), bounds = new Float64Array(size + 1);

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) line[y] = distance[y * width + x];
        distanceTransform(line, height, result, parabolas, bounds, nearest);
        for (let y = 0; y < height; y++) {
            distance[y * width + x] = result[y];
            nearestY[y * width + x] = nearest[y];
        }
    }

    // distances beyond the outline don't matter: leaving them out of the rows saves most of their work
    const far = (radius + 2) ** 2;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) line[x] = distance[row + x] < far ? distance[row + x] : Infinity;
        distanceTransform(line, width, result, parabolas, bounds, nearest);
        for (let x = 0; x < width; x++) {
            distance[row + x] = result[x];
            nearestX[row + x] = nearest[x];
        }
    }

    // where the glyph edge crosses an edge pixel (partly covered, or covered next to an uncovered one): from its
    // center along the outward normal (the coverage gradient) to where a straight edge would cover it as much. The
    // coverage has an empty border (the outline's room), so covered pixels have all their neighbors
    const pointX = new Float32Array(count), pointY = new Float32Array(count), isEdge = new Uint8Array(count);
    for (let y = 1; y < height - 1; y++)
        for (let x = 1, e = y * width + 1; x < width - 1; x++, e++) {
            const c = coverage[e];
            if (!c || c === 255 && coverage[e - 1] >= 128 && coverage[e + 1] >= 128 && coverage[e - width] >= 128 && coverage[e + width] >= 128) continue;
            // Sobel gradient, pointing inwards
            const above = e - width, below = e + width;
            const gx = coverage[above + 1] + 2 * coverage[e + 1] + coverage[below + 1] - coverage[above - 1] - 2 * coverage[e - 1] - coverage[below - 1];
            const gy = coverage[below - 1] + 2 * coverage[below] + coverage[below + 1] - coverage[above - 1] - 2 * coverage[above] - coverage[above + 1];
            const length = Math.sqrt(gx * gx + gy * gy);
            if (!length) continue;
            // the center lies 1/2 - c outside the edge
            const outside = 0.5 - c / 255;
            pointX[e] = x + outside * gx / length;
            pointY[e] = y + outside * gy / length;
            isEdge[e] = 1;
        }

    // the distance to the nearest covered pixel's center is within a pixel of the distance to the edge: outside of that
    // band around the outline's edge, a pixel is fully covered or not at all
    // (pixels next to the glyph edge are covered by the glyph's own antialiasing)
    const out = new Float32Array(count);
    const inner = radius - 1.5, near = inner > 0 ? inner * inner : -1;
    for (let y = 0, i = 0; y < height; y++)
        for (let x = 0; x < width; x++, i++) {
            const d2 = distance[i];
            if (d2 <= near) out[i] = 1;
            if (d2 <= near || d2 >= far) {
                if (d2 >= far) out[i] = coverage[i] / 255;
                continue;
            }

            // the closest edge point around the nearest covered pixel
            const qx = nearestX[i], qy = nearestY[y * width + qx];
            let closest = Infinity;
            for (let wy = Math.max(0, qy - OUTLINE_WINDOW); wy <= Math.min(height - 1, qy + OUTLINE_WINDOW); wy++)
                for (let wx = Math.max(0, qx - OUTLINE_WINDOW), e = wy * width + wx; wx <= Math.min(width - 1, qx + OUTLINE_WINDOW); wx++, e++) {
                    if (!isEdge[e]) continue;
                    const ex = x - pointX[e], ey = y - pointY[e];
                    closest = Math.min(closest, ex * ex + ey * ey);
                }
            closest = closest === Infinity ? Math.sqrt(d2) - 0.5 : Math.sqrt(closest);
            out[i] = Math.max(coverage[i] / 255, Math.min(1, Math.max(0, radius + 0.5 - closest)));
        }

    return out;
}

// 1D squared euclidean distance transform (Felzenszwalb & Huttenlocher): lower envelope of parabolas, also the index
// of the nearest sample
function distanceTransform(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array, nearest: Int32Array): void {
    let k = -1;
    for (let q = 0; q < n; q++) {
        if (f[q] === Infinity) continue;
        let s = 0;
        while (k >= 0) {
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            if (s > z[k]) break;
            k--;
        }
        k++;
        v[k] = q;
        z[k] = k === 0 ? -Infinity : s;
        z[k + 1] = Infinity;
    }

    if (k < 0) {
        d.fill(Infinity, 0, n);
        return;
    }

    for (let q = 0, j = 0; q < n; q++) {
        while (z[j + 1] < q) j++;
        d[q] = (q - v[j]) ** 2 + f[v[j]];
        nearest[q] = v[j];
    }
}
