import { BinaryData } from './util/mem.ts';
import { Image, DecodeOptions } from './image.ts';
import { Animation } from './animation.ts';
import { checkOptions } from './util/options.ts';
import * as png from './codecs/png.ts';
import * as webp from './codecs/webp.ts';
import { view } from './util/mem.ts';
import { ImageType } from './image-type.ts';

export { Image } from './image.ts';
export { Colors } from './colors.ts';
export type { Color, ColorFunction, ResizeMode, ResizeFit, TextStyleOptions, DecodeOptions, CompositeOptions, BlendMode, CropCircleOptions, DominantColorOptions, RotateOptions, ColorToAlphaOptions, ResizeOptions, ResizeToOptions, SharpenOptions, PNGEncodeOptions, JPEGEncodeOptions, WebPEncodeOptions, AVIFEncodeOptions, JXLEncodeOptions, EncodeOptions, TGAEncodeOptions, GIFEncodeOptions, DitherMethod, GainMapEmbedOptions, RenderSVGOptions, RenderTextOptions, ShadowOptions, OutlineOptions, QuantizeOptions, TransformOptions, TransformMode, AffineTransform, GradientOptions, LinearGradientOptions, RadialGradientOptions, RoundCornersOptions, FisheyeOptions, TrimOptions } from './image.ts';
export { Frame } from './frame.ts';
export type { FrameDisposalMode, FrameOptions } from './frame.ts';
export { GainMap } from './gainmap.ts';
export type { GainMapOptions, GainMapEncodeOptions, GainMapChannelValues } from './gainmap.ts';
export { Animation } from './animation.ts';
export type { AnimationOptions, AnimationCanvasOptions, AnimationEncodeOptions, WebPAnimationEncodeOptions, GIFAnimationEncodeOptions, APNGEncodeOptions } from './animation.ts';
export { AnimationEncoder } from './animation-encoder.ts';
export type { TextLayoutOptions, WrapStyle, HorizontalAlign, VerticalAlign } from './text-layout.ts';
export { ImageType } from './image-type.ts';
export type { ImageTypeName } from './image-type.ts';
export type { ToneMapping } from './codecs/hdr.ts';
export type { BinaryData } from './util/mem.ts';
export type { Metadata } from './metadata.ts';

/**
 * Decodes any supported image. A file with more than one frame (GIF, APNG, animated WebP, animated JPEG XL) is
 * returned as an {@link Animation} of its frames, and any other file as an {@link Image}: a file with a single frame
 * (also a GIF, APNG, WebP or JPEG XL with one frame) becomes an Image of that frame, without its offsets and duration.
 * Static formats (PNG, JPEG, AVIF, ...) are always Images, AVIF image sequences decode to their first frame, as
 * {@link Image.decode} does. The options are passed on to {@link Animation.decode} or {@link Image.decode}.
 * @param input The image data
 * @param options See {@link DecodeOptions}
 */
export function decode(input: BinaryData, options?: DecodeOptions): Promise<Image | Animation>;
export async function decode(input: BinaryData, options: DecodeOptions = {}): Promise<Image | Animation> {
    checkOptions(options, 'decode(data, { maxPixels: 1e8 })');
    const bytes = view(input);
    const type = ImageType.getType(bytes);
    const animated = type === 'gif' || type === 'jxl' || (type === 'webp' && webp.isAnimated(bytes)) || (type === 'png' && png.isAnimated(bytes));
    if (!animated) return Image.decode(input, options);

    const animation = await Animation.decode(input, options);
    if (animation.length !== 1) return animation;
    // the only frame, as an image: its pixels and gain map
    return animation.frames[0].image;
}
