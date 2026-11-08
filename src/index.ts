import { BinaryData } from './util/mem.ts';
import { Image, DecodeOptions } from './image.ts';
import { Frame } from './frame.ts';
import { Animation, AnimationDecodeOptions } from './animation.ts';
import { isOptions } from './util/options.ts';
import * as png from './codecs/png.ts';
import * as webp from './codecs/webp.ts';
import { view } from './util/mem.ts';
import { ImageType } from './image-type.ts';

export { Image, ResizeModes, SVGScaleModes } from './image.ts';
export { Colors } from './colors.ts';
export type { Color, ColorFunction, ResizeMode, SVGScaleMode, TextStyle, DecodeOptions, CompositeOptions, BlendMode, CropCircleOptions, DominantColorOptions, RotateOptions, ColorToAlphaOptions, ResizeOptions, ResizeToOptions, SharpenOptions, PNGEncodeOptions, JPEGEncodeOptions, WebPEncodeOptions, AVIFEncodeOptions, JXLEncodeOptions, EncodeOptions, SVGOptions, RenderTextOptions, ShadowOptions, OutlineOptions, QuantizeOptions, TransformOptions, TransformMode, GradientOptions, LinearGradientOptions, RadialGradientOptions, RoundCornersOptions, FisheyeOptions, TrimOptions } from './image.ts';
export { Frame, FrameDisposalModes } from './frame.ts';
export type { FrameDisposalModeName, FrameOptions } from './frame.ts';
export { GainMap } from './gainmap.ts';
export type { GainMapOptions, GainMapEncodeOptions } from './gainmap.ts';
export { Animation } from './animation.ts';
export type { AnimationOptions, AnimationDecodeOptions, AnimationEncodeOptions, WebPAnimationEncodeOptions, GIFEncodeOptions, APNGEncodeOptions } from './animation.ts';
export { AnimationEncoder } from './animation-encoder.ts';
export { TextLayout } from './text-layout.ts';
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
 * @param data The image data
 * @param options See {@link AnimationDecodeOptions} and {@link DecodeOptions}
 */
export function decode(data: BinaryData, options?: AnimationDecodeOptions & DecodeOptions): Promise<Image | Animation>;
/**
 * Decodes any supported image. A file with more than one frame is returned as an {@link Animation}, anything else as
 * an {@link Image} (see the overload with options). With `onlyFirstFrame` the rest of the file isn't decoded, so the
 * frame count isn't known: the first frame is returned as an Image.
 * @param data The image data
 * @param onlyFirstFrame Whether to end animation decoding after the first frame
 */
export function decode(data: BinaryData, onlyFirstFrame?: boolean): Promise<Image | Animation>;
export async function decode(data: BinaryData, onlyFirstFrameOrOptions: boolean | (AnimationDecodeOptions & DecodeOptions) = false): Promise<Image | Animation> {
    const options: AnimationDecodeOptions & DecodeOptions = isOptions(onlyFirstFrameOrOptions) ? onlyFirstFrameOrOptions : { onlyFirstFrame: onlyFirstFrameOrOptions };
    const bytes = view(data);
    const type = ImageType.getType(bytes);
    const animated = type === 'gif' || type === 'jxl' || (type === 'webp' && webp.isAnimated(bytes)) || (type === 'png' && png.isAnimated(bytes));
    if (!animated) return Image.decode(data, options);

    const animation = await Animation.decode(data, options);
    if (animation.length !== 1) return animation;
    // the only frame, as an image: its pixels and gain map
    const frame: Frame = animation.frames[0];
    const image = new Image(frame.width, frame.height);
    image.bitmap = frame.bitmap;
    image.gainMap = frame.gainMap;
    return image;
}
