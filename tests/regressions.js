const {Image, Frame, GIF, Animation, TextLayout} = require('..');
const {ResizeModes, SVGScaleModes, FrameDisposalModes, Colors} = require('..');
const zlib = require('zlib');
// (encoders stamp the current time into the metadata: tests that compare two encodes freeze it, or they differ when a second ends in between)
const withFrozenTime = async run => {
    const now = Date.now;
    Date.now = () => 1.7e12;
    try { await run(); } finally { Date.now = now; }
};

const assert = (condition, message) => {
    if (condition) return;
    console.error(message);
    process.exit(1);
};

const rgba = (image, x, y) => Colors.toRGBA(image.getPixelAt(x, y));

(async () => {
    // rotating non-square images by right angles (#29)
    {
        const image = new Image(3, 2).fill((x, y) => Colors.fromRGBA(x + 1, y + 1, 0, 255));
        const ccw = image.clone().rotate(90);
        assert(ccw.width === 2 && ccw.height === 3, 'rotate(90): dimensions not swapped');
        assert(rgba(ccw, 0, 2).slice(0, 2).join() === '1,1', 'rotate(90): top left should end up bottom left');
        assert(rgba(ccw, 1, 0).slice(0, 2).join() === '3,2', 'rotate(90): bottom right should end up top right');

        const cw = image.clone().rotate(270);
        assert(rgba(cw, 1, 0).slice(0, 2).join() === '1,1', 'rotate(270): top left should end up top right');
        for (const [x, y, color] of cw.pixels()) assert((color & 0xff) === 255, `rotate(270): hole at ${x},${y}`);
    }

    // free rotation keeps the edges
    {
        const image = new Image(4, 4).fill(0xff0000ff).rotate(0.001, {resize: false});
        for (const [x, y, color] of image.pixels()) assert((color & 0xff) > 250, `rotate: edge pixel ${x},${y} lost`);
    }

    // compositing respects the destination alpha
    {
        const image = new Image(1, 1).composite(new Image(1, 1).fill(Colors.fromRGBA(255, 255, 255, 128)));
        assert(rgba(image, 0, 0).join() === '255,255,255,128', 'composite: semi-transparent white onto transparent turned ' + rgba(image, 0, 0));

        const blend = new Image(1, 1).fill(Colors.fromRGBA(255, 0, 0, 128)).composite(new Image(1, 1).fill(Colors.fromRGBA(0, 0, 255, 128)));
        assert(rgba(blend, 0, 0)[3] === 192, 'composite: alpha should combine to 0.75');
    }

    // cropCircle({ size })
    {
        const count = image => [...image.pixels()].filter(([, , c]) => c & 0xff).length;
        assert(count(new Image(8, 2).fill(0xffffffff).cropCircle({ size: 'cover' })) > count(new Image(8, 2).fill(0xffffffff).cropCircle({ size: 'contain' })), 'cropCircle: cover has no effect');
    }

    // crop is clipped to the image
    {
        const image = new Image(10, 2).fill((x, y) => Colors.fromRGBA(x + 1, y + 1, 0, 255)).crop(5, 0, 10, 2);
        assert(image.width === 5 && image.height === 2, 'crop: region not clipped');
        assert(rgba(image, 0, 1).slice(0, 2).join() === '6,2', 'crop: wrong pixels');

        let threw = false;
        try { new Image(10, 10).crop(20, 20, 5, 5); } catch { threw = true; }
        assert(threw, 'crop: region outside the image should throw');
    }

    // drawBox outside of the image
    {
        new Image(10, 10).drawBox(0, 20, 5, 5, 0xffffffff).drawBox(20, 0, 5, 5, 0xffffffff).drawBox(-10, -10, 5, 5, 0xffffffff);
        const image = new Image(4, 4).drawBox(-2, -2, 3, 3, 0xffffffff);
        assert(image.getPixelAt(0, 0) === 0xffffffff && image.getPixelAt(1, 1) === 0, 'drawBox: clipping failed');
    }

    // averageColor is weighted by alpha
    {
        assert(new Image(2, 2).fill(Colors.fromRGBA(255, 0, 0, 128)).averageColor() === 0xff0000ff, 'averageColor: semi-transparent red');
        const image = new Image(2, 1);
        image.setPixelAt(0, 0, 0x00ff00ff);
        image.setPixelAt(1, 0, 0xff000000);
        assert(image.averageColor() === 0x00ff00ff, 'averageColor: transparent pixels must not count');
    }

    // gradients return unsigned colors like rgbaToColor
    assert(Colors.gradient({0: 0xff0000ff, 1: 0xff0000ff})(0.5) === 0xff0000ff, 'gradient: signed color');

    // PNG metadata in { metadata }
    {
        const encoded = await new Image(1, 1).encodePNG({metadata: {title: 'regression'}});
        assert(Buffer.from(encoded).includes(Buffer.from('regression')), 'encode(metadata): title missing');
    }

    // frames keep their metadata
    {
        const frame = new Frame(10, 10, {duration: 500, xOffset: 2, yOffset: 4, disposalMode: FrameDisposalModes.BACKGROUND});
        const clone = frame.clone();
        assert(clone instanceof Frame && clone.duration === 500 && clone.xOffset === 2 && clone.disposalMode === 'background', 'Frame.clone lost metadata');

        const resized = frame.resize(5, 5);
        assert(resized === frame && frame.duration === 500 && frame.xOffset === 1 && frame.yOffset === 2, 'Frame.resize lost metadata');
    }

    // GIFs behave like arrays
    {
        const gif = new GIF([new Frame(4, 4), new Frame(4, 4), new Frame(4, 4)], 2);
        assert(gif.slice(1).length === 2 && gif.slice(1).loopCount === 2, 'GIF.slice(start)');
        assert(gif.slice(-1).length === 1, 'GIF.slice(negative)');
        assert(gif.map(frame => frame.width).join() === '4,4,4', 'GIF.map');
        assert(gif.filter(() => true).length === 3, 'GIF.filter');
    }

    // resizing GIFs scales partial frames proportionally
    {
        const gif = new GIF([new Frame(10, 10), new Frame(4, 4, {duration: 100, xOffset: 6, yOffset: 6})]).resize(5, 5);
        assert(gif.width === 5 && gif.height === 5, `GIF.resize: canvas is ${gif.width}x${gif.height}`);
        assert(gif[1].width === 2 && gif[1].xOffset === 3, 'GIF.resize: partial frame not scaled');
    }

    // coordinates are 0-based everywhere
    {
        const image = new Image(3, 3);
        image.setPixelAt(0, 0, 0xff0000ff);
        assert(image.bitmap[0] === 0xff, 'setPixelAt(0, 0) should set the first pixel');
        assert([...image.coordinates()][0].join() === '0,0' && [...image.coordinates()].pop().join() === '2,2', 'coordinates() should be 0-based');

        let threw = false;
        try { image.getPixelAt(3, 0); } catch { threw = true; }
        assert(threw, 'getPixelAt(width, 0) should be out of bounds');

        const filled = [];
        new Image(2, 1).fill((x, y) => (filled.push([x, y]), 0));
        assert(filled.join(';') === '0,0;1,0', 'fill callback should be 0-based');

        const box = new Image(3, 3).drawBox(1, 1, 1, 1, 0xffffffff);
        assert(box.getPixelAt(1, 1) === 0xffffffff && box.getPixelAt(0, 0) === 0, 'drawBox should be 0-based');

        const target = new Image(3, 3).composite(new Image(1, 1).fill(0xffffffff), {x: 1, y: 1});
        assert(target.getPixelAt(1, 1) === 0xffffffff, 'composite and getPixelAt should agree');

        const corners = new Image(8, 8).fill(0xffffffff).roundCorners({radius: 3});
        const alpha = (x, y) => corners.getPixelAt(x, y) & 0xff;
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
                assert(alpha(x, y) === alpha(7 - x, y) && alpha(x, y) === alpha(x, 7 - y), `roundCorners should be symmetric (${x}, ${y})`);
        assert(alpha(0, 0) < 64 && alpha(3, 0) === 255 && alpha(0, 1) > 0 && alpha(0, 1) < 255, 'roundCorners should antialias the arc');
    }

    // text layout accepts the pre 3.0 (swapped) option names
    {
        const legacy = new TextLayout({verticalAlign: 'center', horizontalAlign: 'bottom'});
        assert(legacy.horizontalAlign === 'center' && legacy.verticalAlign === 'bottom', 'TextLayout: legacy names');
        const current = new TextLayout({horizontalAlign: 'right', verticalAlign: 'middle'});
        assert(current.horizontalAlign === 'right' && current.verticalAlign === 'middle', 'TextLayout: names');
    }

    // HSL conversions round instead of truncating, so identity operations keep the image
    {
        const image = new Image(64, 64).fill((x, y) => Colors.fromRGBA(x * 4, y * 4, (x * y) & 255, 255 - x));
        const original = Buffer.from(image.bitmap);
        assert(Buffer.from(image.clone().lightness(1).bitmap).equals(original), 'lightness(1) should not change the image');
        assert(Buffer.from(image.clone().saturation(1).bitmap).equals(original), 'saturation(1) should not change the image');
        assert(Buffer.from(image.clone().hueShift(360).bitmap).equals(original), 'hueShift(360) should not change the image');
    }

    // negative hues wrap around
    {
        const color = Colors.fromRGB(255, 40, 0);
        const shifted = new Image(1, 1).fill(color).hueShift(-300).getPixelAt(0, 0);
        assert(shifted === new Image(1, 1).fill(color).hueShift(60).getPixelAt(0, 0), 'hueShift(-300) should equal hueShift(60), got ' + Colors.toRGBA(shifted));
    }

    // compositing rounds to the nearest value instead of up
    {
        const image = new Image(1, 1).fill(Colors.fromRGBA(0, 0, 0, 255)).composite(new Image(1, 1).fill(Colors.fromRGBA(100, 100, 100, 51)));
        assert(rgba(image, 0, 0)[0] === 20, 'composite: 100 at 20% over black should be 20, got ' + rgba(image, 0, 0)[0]);
    }

    // cover and contain hit the requested dimensions despite floating point scale factors
    {
        for (let width = 1; width < 200; width++) {
            for (const target of [7, 50, 99, 128]) {
                const covered = new Image(width, 61).cover(target, 33);
                assert(covered.width === target && covered.height === 33, `cover(${target}, 33) of ${width}x61 returned ${covered}`);
                const contained = new Image(width, 61).contain(target, 33);
                assert((contained.width === target || contained.height === 33) && contained.width <= target && contained.height <= 33, `contain(${target}, 33) of ${width}x61 returned ${contained}`);
            }
        }
    }

    // decoding an uncompressed TIFF with a predictor leaves the input untouched
    {
        const entries = [[256, 3, 4], [257, 3, 1], [258, 3, 8], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 3, 1], [279, 4, 4], [317, 3, 2]];
        const offset = 8 + 2 + entries.length * 12 + 4;
        const data = Buffer.alloc(offset + 4);
        data.write('II*\0', 0, 'latin1');
        data.writeUInt32LE(8, 4);
        data.writeUInt16LE(entries.length, 8);
        entries.forEach(([tag, type, value], i) => {
            const entry = 10 + i * 12;
            data.writeUInt16LE(tag, entry);
            data.writeUInt16LE(type, entry + 2);
            data.writeUInt32LE(1, entry + 4);
            if (type === 3) data.writeUInt16LE(value, entry + 8);
            else data.writeUInt32LE(tag === 273 ? offset : value, entry + 8);
        });
        data.set([10, 10, 10, 10], offset);

        const first = await Image.decode(data), second = await Image.decode(data);
        assert(Buffer.from(first.bitmap).equals(Buffer.from(second.bitmap)), 'TIFF: decoding twice should give the same result');
        assert(rgba(second, 3, 0)[0] === 40, 'TIFF: horizontal predictor not applied correctly');
    }

    // zlib streams with more data than the image needs (and a broken checksum, so the JS inflater is used)
    {
        const chunk = (type, body) => {
            const out = Buffer.alloc(12 + body.length);
            out.writeUInt32BE(body.length);
            out.write(type, 4, 'latin1');
            body.copy(out, 8);
            out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
            return out;
        };
        const stored = (final, bytes) => Buffer.from([final, bytes.length, 0, ~bytes.length & 255, 255, ...bytes]);
        const header = Buffer.alloc(13);
        header.writeUInt32BE(1);
        header.writeUInt32BE(1, 4);
        header.set([8, 6], 8);
        const idat = Buffer.concat([Buffer.from([0x78, 0x01]), stored(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), stored(1, [1, 2, 3, 4, 5]), Buffer.alloc(4)]);
        const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
        const image = await Image.decode(png);
        assert(rgba(image, 0, 0).join() === '1,2,3,4', 'PNG: overlong zlib stream decoded incorrectly');
    }

    // nested entities can't blow up the SVG parser
    {
        let dtd = '<!ENTITY e0 "x">';
        for (let i = 1; i <= 4; i++) dtd += `<!ENTITY e${i} "${`&e${i - 1};`.repeat(40)}">`;
        const svg = `<!DOCTYPE svg [${dtd}]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><desc>${'&e4;'.repeat(50)}</desc></svg>`;
        let error = null;
        try { await Image.renderSVG(svg); } catch (err) { error = err; }
        assert(error && /entity expansion/.test(error.message), 'SVG: entity expansion should be limited');
    }

    // resizing filters average instead of skipping pixels, in premultiplied alpha
    {
        const checker = new Image(64, 64).fill((x, y) => (x + y) & 1 ? 0xffffffff : 0x000000ff);
        for (const mode of [ResizeModes.BILINEAR, ResizeModes.BICUBIC, ResizeModes.AREA]) {
            const small = checker.clone().resize(8, 8, {mode});
            for (const [x, y, color] of small.pixels())
                assert(Math.abs((color >>> 24) - 128) <= 2, `${mode}: checkerboard should average to grey at ${x},${y}, got ${color >>> 24}`);
        }

        // fully transparent pixels must not bleed their (garbage) color
        const half = new Image(4, 1).fill((x) => x < 2 ? 0xff000000 : 0x0000ffff).resize(2, 1);
        assert(rgba(half, 0, 0).slice(0, 3).join() === '0,0,255', 'resize: transparent pixels bled into the result: ' + rgba(half, 0, 0));

        const nearest = new Image(4, 1).fill((x) => Colors.fromRGB(x, 0, 0)).resize(2, 1, {mode: ResizeModes.NEAREST_NEIGHBOR});
        assert(rgba(nearest, 0, 0)[0] === 1 && rgba(nearest, 1, 0)[0] === 3, 'nearest neighbor should sample pixel centers');

        // (the upper case names of the removed Image.RESIZE_* constants are unknown modes too)
        for (const unknown of ['RESIZE_FOO', 'RESIZE_BILINEAR', 'RESIZE_AREA']) {
            let threw = false;
            try { checker.clone().resize(8, 8, {mode: unknown}); } catch { threw = true; }
            assert(threw, `resize should reject unknown mode ${unknown}`);
        }
    }

    // circles are antialiased and symmetric around the pixel center
    {
        const circle = new Image(9, 9).drawCircle(4, 4, 3.5, 0xffffffff);
        const alpha = (x, y) => circle.getPixelAt(x, y) & 0xff;
        for (let y = 0; y < 9; y++)
            for (let x = 0; x < 9; x++)
                assert(alpha(x, y) === alpha(8 - x, y) && alpha(x, y) === alpha(y, x), `drawCircle should be symmetric (${x}, ${y})`);
        assert(alpha(4, 4) === 255 && alpha(0, 0) === 0 && alpha(1, 2) > 0 && alpha(1, 2) < 255, 'drawCircle should antialias its edge');

        const cropped = new Image(6, 6).fill(0xffffffff).cropCircle();
        const a = (x, y) => cropped.getPixelAt(x, y) & 0xff;
        for (let y = 0; y < 6; y++)
            for (let x = 0; x < 6; x++)
                assert(a(x, y) === a(5 - x, y) && a(x, y) === a(x, 5 - y), `cropCircle should be symmetric (${x}, ${y})`);

        const feathered = new Image(41, 41).fill(0xffffffff).cropCircle({ feathering: 0.5 });
        const f = x => feathered.getPixelAt(x, 20) & 0xff;
        assert(f(20) === 255 && f(12) === 255 && f(5) > 0 && f(5) < 255 && f(0) < 32, 'cropCircle feathering should only soften the outer part');
    }

    // dominant colors are exact and dark saturated colors aren't treated as black
    {
        assert(new Image(4, 4).fill(0xff0000ff).dominantColor() === 0xff0000ff, 'dominantColor of pure red');
        assert(new Image(4, 4).fill(0x336699ff).dominantColor() === 0x336699ff, 'dominantColor of #336699');

        const navy = new Image(10, 10).fill(0x00006eff).drawBox(0, 0, 2, 2, 0xc8c800ff);
        assert(navy.dominantColor() === 0x00006eff, 'dominantColor: navy should beat a small yellow area');
        assert(new Image(4, 4).fill(0x000000ff).dominantColor() === 0x000000ff, 'dominantColor: all black falls back to black');
        assert(new Image(4, 4).dominantColor() === 0x000000ff, 'dominantColor: transparent image');
    }

    // PNGs use the smallest lossless color type
    {
        const cases = {
            palette: [new Image(20, 10).fill((x) => x & 1 ? 0xff000080 : 0x00ff00ff), 3],
            greys: [new Image(300, 1).fill((x) => Colors.fromRGB(x & 255, x & 255, x & 255)), 3],
            greyAlpha: [new Image(300, 3).fill((x, y) => Colors.fromRGBA(x & 255, x & 255, x & 255, 100 + y)), 4],
            rgb: [new Image(300, 2).fill((x, y) => Colors.fromRGB(x & 255, x >> 8, y)), 2],
            rgba: [new Image(300, 2).fill((x, y) => Colors.fromRGBA(x & 255, x >> 8, y, 200)), 6]
        };
        for (const [name, [image, type]] of Object.entries(cases)) {
            const encoded = await image.encodePNG();
            const decoded = await Image.decode(encoded);
            assert(Buffer.from(decoded.bitmap).equals(Buffer.from(image.bitmap)), `PNG ${name}: roundtrip failed`);
            assert(encoded[25] === type, `PNG ${name}: expected color type ${type}, got ${encoded[25]}`);
        }

        // truecolor rows are filtered, which makes smooth gradients tiny
        const gradient = new Image(512, 512).fill((x, y) => Colors.fromRGB(x / 2, y / 2, (x + y) / 4));
        const size = (await gradient.encodePNG()).length;
        assert(size < 20000, `PNG: gradient should compress well with row filters, got ${size} bytes`);
        assert(Buffer.from((await Image.decode(await gradient.encodePNG({compression: 9}))).bitmap).equals(Buffer.from(gradient.bitmap)), 'PNG: filtered roundtrip failed');
    }

    // invertValue inverts HSV value and invertLightness HSL lightness
    {
        const value = new Image(3, 1).fill(x => [Colors.fromRGBA(200, 100, 50, 128), Colors.fromRGB(0, 0, 0), Colors.fromRGB(255, 128, 0)][x]).invertValue();
        assert([0, 1, 2].map(x => rgba(value, x, 0).join(' ')).join() === '55 28 14 128,255 255 255 255,0 0 0 255', 'invertValue should invert HSV value, got ' + [0, 1, 2].map(x => rgba(value, x, 0)));
        const lightness = new Image(1, 1).fill(Colors.fromRGB(200, 100, 50)).invertLightness();
        assert(rgba(lightness, 0, 0).join() === '205,105,55,255', 'invertLightness should invert HSL lightness, got ' + rgba(lightness, 0, 0));
    }

    // gif frame durations are rounded to centiseconds
    {
        // (different frames: identical ones are merged)
        const gif = new GIF([new Frame(2, 2, {duration: 16}), new Frame(2, 2, {duration: 14}).fill(0xff0000ff)]);
        const decoded = await GIF.decode(await gif.encode());
        assert(decoded[0].duration === 20 && decoded[1].duration === 10, `gif durations should round, got ${decoded[0].duration}, ${decoded[1].duration}`);
    }

    // jpegs are rotated as their exif orientation says (fixtures written by Pillow, checked against ImageOps.exif_transpose)
    {
        const fs = require('fs');
        const read = n => fs.readFileSync(`./tests/jpegs/exif-orientation-${n}.jpg`);
        const raw = await Image.decode(read(3), {applyOrientation: false});
        assert(raw.width === 48 && raw.height === 32, 'decode: applyOrientation: false should keep the stored pixels');
        for (const [n, angle] of [[3, 180], [6, 270], [8, 90]]) {
            const oriented = await Image.decode(read(n));
            const expected = (await Image.decode(read(n), {applyOrientation: false})).rotate(angle);
            assert(oriented.width === expected.width && Buffer.from(oriented.bitmap).equals(Buffer.from(expected.bitmap)), `decode: orientation ${n} not applied`);
        }
    }

    // replacing the bitmap keeps every accessor in sync
    {
        const image = new Image(2, 2);
        image.bitmap = new Uint8ClampedArray(16).fill(255);
        assert(image.getPixelAt(1, 1) === 0xffffffff && image.averageColor() === 0xffffffff, 'bitmap setter: views out of sync');
        image.bitmap = new Uint8Array(16);
        assert(image.getPixelAt(0, 0) === 0 && image.bitmap instanceof Uint8ClampedArray, 'bitmap setter: Uint8Array not wrapped');
        let threw = false;
        try { image.bitmap = new Uint8ClampedArray(12); } catch { threw = true; }
        assert(threw, 'bitmap setter should reject a wrong size');
    }

    // color components are rounded and clamped instead of wrapping
    {
        assert(Colors.fromRGBA(256, -1, 127.6, 300) === 0xff0080ff, 'Colors.fromRGBA should clamp and round, got ' + Colors.fromRGBA(256, -1, 127.6, 300).toString(16));
        let threw = false;
        try { Colors.fromRGB(NaN, 0, 0); } catch (e) { threw = e instanceof RangeError; }
        assert(threw, 'Colors.fromRGB(NaN) should throw a RangeError');
    }

    // disposal modes read back as the names they are set with
    {
        const frame = new Frame(1, 1, {duration: 100, xOffset: 0, yOffset: 0, disposalMode: FrameDisposalModes.PREVIOUS});
        assert(frame.disposalMode === 'previous', 'disposalMode should be a name, got ' + frame.disposalMode);
        // the numeric ids (0-3) are not accepted any more, the names are
        let threw = false;
        try { frame.disposalMode = 0; } catch (e) { threw = e instanceof RangeError; }
        assert(threw && frame.disposalMode === 'previous', 'disposalMode should only take names');
        const decoded = await GIF.decode(await new GIF([new Frame(2, 2, {duration: 100, xOffset: 0, yOffset: 0, disposalMode: 'background'}), new Frame(2, 2).fill(0xff0000ff)]).encode());
        assert(decoded.length === 2, 'gif with disposal modes should roundtrip');
    }

    // the constant classes hold the names of the modes (the deprecated Image/Frame constants were removed in 4.0)
    {
        assert(ResizeModes.NEAREST_NEIGHBOR === 'nearest-neighbor' && ResizeModes.BILINEAR === 'bilinear' && ResizeModes.BICUBIC === 'bicubic' && ResizeModes.AREA === 'area', 'ResizeModes values');
        assert(SVGScaleModes.SCALE === 'scale' && SVGScaleModes.WIDTH === 'width' && SVGScaleModes.HEIGHT === 'height', 'SVGScaleModes values');
        assert(FrameDisposalModes.ANY === 'any' && FrameDisposalModes.KEEP === 'keep' && FrameDisposalModes.PREVIOUS === 'previous' && FrameDisposalModes.BACKGROUND === 'background', 'FrameDisposalModes values');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="7" height="3" fill="red"/></svg>';
        for (const [mode, size, width, height] of [[SVGScaleModes.SCALE, 2, 20, 10], [SVGScaleModes.WIDTH, 20, 20, 10], [SVGScaleModes.HEIGHT, 20, 40, 20]]) {
            const rendered = await Image.renderSVG(svg, {size, mode});
            assert(rendered.width === width && rendered.height === height, `renderSVG mode ${mode}: ${rendered.width}x${rendered.height}`);
        }
        assert(new Image(8, 4).resize({width: 4, mode: ResizeModes.AREA}).height === 2, 'resize({width}) with a mode keeps the aspect ratio');
        const photo = new Image(9, 7).fill((x, y) => Colors.fromRGBA(x * 28, y * 36, (x ^ y) * 16, 255 - x * 10));
        let threw = false;
        try { photo.clone().resize(4, 4, {mode: 'Area'}); } catch { threw = true; }
        assert(threw, 'resize modes are case sensitive');
    }

    // resize({width}) / resize({height}) keep the aspect ratio
    {
        const {Animation} = require('..');
        const photo = new Image(12, 8).fill((x, y) => Colors.fromRGBA(x * 20, y * 30, 90, 255));
        const same = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
        assert(same(photo.clone().resize({width: 6}), photo.clone().resize(6, 4)), 'resize({width})');
        assert(photo.clone().resize({width: 6}).height === 4, 'resize({width}) keeps the aspect ratio');
        assert(same(photo.clone().resize({height: 4, mode: 'bicubic'}), photo.clone().resize(6, 4, {mode: ResizeModes.BICUBIC})), 'resize({height, mode})');
        assert(same(photo.clone().resize({width: 5, height: 9, fast: false}), photo.clone().resize(5, 9, {fast: false})), 'resize({width, height, fast})');
        let threw = false;
        try { photo.clone().resize({}); } catch (e) { threw = e instanceof TypeError; }
        assert(threw, 'resize({}) throws');

        const frame = Frame.from(photo.clone(), {duration: 100, xOffset: 4, yOffset: 2});
        frame.resize({width: 6});
        assert(frame.width === 6 && frame.height === 4 && frame.xOffset === 2 && frame.yOffset === 1, `Frame.resize({width}): ${frame.width}x${frame.height}+${frame.xOffset}+${frame.yOffset}`);

        const animation = new Animation([Frame.from(photo.clone(), {duration: 100}), Frame.from(photo.clone().invert(), {duration: 100})]);
        const other = new Animation([Frame.from(photo.clone(), {duration: 100}), Frame.from(photo.clone().invert(), {duration: 100})]);
        animation.resize({height: 4});
        other.resize(6, 4);
        assert(animation.width === 6 && animation.height === 4 && [...animation].every((f, i) => same(f, other[i])), 'Animation.resize({height})');
    }

    // coordinates() and pixels() yield every pixel row by row
    {
        const image = new Image(3, 2).fill((x, y) => Colors.fromRGBA(x * 50, y * 100, 7, 255));
        const coordinates = [...image.coordinates()], pixels = [...image.pixels()];
        assert(coordinates.length === 6 && pixels.length === 6, 'coordinates()/pixels() count');
        assert(coordinates.every(([x, y], i) => x === i % 3 && y === Math.floor(i / 3)), 'coordinates() row by row');
        assert(pixels.every(([x, y, color], i) => x === i % 3 && y === Math.floor(i / 3) && color === Colors.fromRGBA(x * 50, y * 100, 7, 255)), 'pixels() row by row');
        assert(coordinates[4].join() === '1,1' && pixels[4][2] === Colors.fromRGBA(50, 100, 7, 255), 'coordinates() and pixels() are row by row');
    }

    // cropCircle({size}): 'contain' is the default
    {
        const wide = new Image(40, 20).fill(Colors.fromRGBA(200, 100, 50, 255));
        const same = (a, b) => Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
        assert(same(wide.clone().cropCircle(), wide.clone().cropCircle({size: 'contain'})), 'cropCircle() is contain');
        assert(!same(wide.clone().cropCircle({size: 'cover'}), wide.clone().cropCircle({size: 'contain'})), 'cover differs from contain');
        assert(wide.clone().cropCircle({size: 'contain'}).getPixelAt(20, 1) >>> 0 !== 0 && (wide.clone().cropCircle({size: 'contain'}).getPixelAt(1, 10) & 0xff) === 0, 'contain: the circle fits the height');
        let threw = false;
        try { wide.clone().cropCircle({size: 'max'}); } catch (e) { threw = e instanceof TypeError; }
        assert(threw, 'cropCircle({size}) validates');
    }

    // the encoders take the options of the encode functions
    await withFrozenTime(async () => {
        const {Animation} = require('..');
        const frames = () => [Frame.from(new Image(6, 6).fill(0x336699ff), {duration: 100}), Frame.from(new Image(6, 6).fill(0x996633ff), {duration: 100})];
        for (const [format, options] of [['GIF', {quality: 80, optimize: false}], ['APNG', {compression: 9}], ['WebP', {quality: 70, effort: 1}]]) {
            const animation = new Animation(frames(), {loopCount: 3});
            const encoder = Animation[`${format.toLowerCase()}Encoder`](6, 6, {...options, loopCount: 3});
            for (const frame of frames()) await encoder.add(frame);
            assert(Buffer.from(await encoder.finish()).equals(Buffer.from(await animation[`encode${format}`](options))), `${format}: encoder vs encode${format} with options`);
        }
    });

    // Infinity is a loop count for ever (like -1, which is removed in 4.0), the encoders take the options of the encode functions
    await withFrozenTime(async () => {
        const {Animation} = require('..');
        const still = new Image(6, 6).fill(0x336699ff);
        const frames = () => [Frame.from(still.clone(), {duration: 100}), Frame.from(still.clone().invert(), {duration: 100})];
        const forever = new Animation(frames(), {loopCount: Infinity}), minusOne = new Animation(frames(), {loopCount: -1});
        assert(forever.loopCount === Infinity && new Animation(frames(), {loopCount: Infinity}).loopCount === Infinity, 'Animation keeps Infinity');
        for (const format of ['GIF', 'APNG', 'WebP']) {
            const a = await forever[`encode${format}`](), b = await minusOne[`encode${format}`]();
            assert(Buffer.from(a).equals(Buffer.from(b)), `${format}: Infinity vs -1`);
            assert((await Animation.decode(a)).loopCount === -1, `${format}: decodes as -1 until 4.0`);
            const encoder = Animation[`${format.toLowerCase()}Encoder`](6, 6, {loopCount: Infinity});
            for (const frame of frames()) await encoder.add(frame);
            assert(Buffer.from(await encoder.finish()).equals(Buffer.from(a)), `${format}: encoder with Infinity`);
        }
        for (const loopCount of [1.5, -2, NaN]) {
            let threw = false;
            try { new Animation(frames(), {loopCount}); } catch (e) { threw = e instanceof RangeError || e instanceof TypeError; }
            assert(threw, `loopCount ${loopCount} is rejected`);
            threw = false;
            try { Animation.gifEncoder(6, 6, {loopCount}); } catch (e) { threw = e instanceof RangeError; }
            assert(threw, `encoder loopCount ${loopCount} is rejected`);
        }
    });

    // Animation.decode: orientation, tone mapping and gain maps like Image.decode
    {
        const {GainMap} = require('..');
        const fs = require('fs');
        const pixel = (image, x, y) => Array.from(image.bitmap.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
        const tiff = orientation => Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0]);
        const source = () => [0, 1].map(i => Frame.from(new Image(3, 2).fill((x, y) => Colors.fromRGBA(x * 100, y * 100, i * 120, 255)), {duration: 100}));

        // APNG (eXIf) and animated WebP (EXIF): orientation 6 turns the top left into the top right
        const png = Buffer.from(await new Animation(source(), {loopCount: 2}).encodeAPNG({metadata: {software: ''}}));
        const chunk = (type, body) => {
            const out = Buffer.alloc(12 + body.length);
            out.writeUInt32BE(body.length);
            out.write(type, 4, 'latin1');
            body.copy(out, 8);
            out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
            return out;
        };
        const withExif = Buffer.concat([png.subarray(0, png.length - 12), chunk('eXIf', tiff(6)), png.subarray(png.length - 12)]);
        const webp = Buffer.from(await new Animation(source(), {loopCount: 2}).encodeWebP({metadata: {software: ''}}));
        const exifChunk = Buffer.concat([Buffer.from('EXIF'), Buffer.from(new Uint8Array(new Uint32Array([tiff(6).length]).buffer)), tiff(6)]);
        // (the encoder's own EXIF chunk, with the creation time, becomes one decoders skip)
        const own = webp.indexOf('EXIF', 12, 'latin1');
        assert(own > 12, 'the animated WebP has an EXIF chunk of its own');
        webp.write('JUNK', own, 'latin1');
        const webpWithExif = Buffer.concat([webp, exifChunk]);
        webpWithExif.writeUInt32LE(webpWithExif.length - 8, 4);
        // (the VP8X flags: bit 3 is Exif)
        webpWithExif[20] |= 0x08;

        for (const [name, data] of [['APNG', withExif], ['WebP', webpWithExif]]) {
            const stored = await Animation.decode(data, {applyOrientation: false});
            assert(stored.width === 3 && stored.height === 2 && stored.length === 2, `${name}: applyOrientation false keeps the stored pixels`);
            for (const options of [undefined, {}, {applyOrientation: true}]) {
                const oriented = await Animation.decode(data, options);
                assert(oriented.width === 2 && oriented.height === 3 && oriented.length === 2, `${name}: rotated (${JSON.stringify(options)})`);
                for (let i = 0; i < 2; i++)
                    assert(pixel(oriented[i], 1, 0).join() === pixel(stored[i], 0, 0).join() && pixel(oriented[i], 0, 2).join() === pixel(stored[i], 2, 1).join(), `${name}: frame ${i} not oriented like Image.decode`);
            }
        }
        // (without an orientation tag nothing changes)
        assert((await Animation.decode(png)).width === 3, 'APNG without orientation');

        // JPEG XL: the gain map of a jhgm box on every frame, in a container around the animation's codestream
        const boxes = data => {
            const out = [];
            for (let o = 0; o < data.length;) {
                const size = data.readUInt32BE(o), type = data.toString('latin1', o + 4, o + 8);
                out.push({type, box: data.subarray(o, o + size)});
                o += size;
            }
            return out;
        };
        const box = (type, ...body) => {
            const content = Buffer.concat(body);
            const out = Buffer.alloc(8 + content.length);
            out.writeUInt32BE(out.length);
            out.write(type, 4, 'latin1');
            content.copy(out, 8);
            return out;
        };
        const mapped = new Image(8, 8).fill(0x808080ff);
        mapped.gainMap = new GainMap(new Image(4, 4).fill(0xc0c0c0ff), {gainMapMin: 0, gainMapMax: 2});
        const jhgm = boxes(Buffer.from(await mapped.encodeJXL())).find(b => b.type === 'jhgm').box;
        const codestream = fs.readFileSync('./tests/jxl/animation.jxl');
        const container = Buffer.concat([box('JXL ', Buffer.from([0x0d, 0x0a, 0x87, 0x0a])), box('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1')), jhgm, box('jxlc', codestream)]);
        const plain = await Animation.decode(container, {gainMap: false});
        const withMap = await Animation.decode(container);
        assert(plain.length > 1 && withMap.length === plain.length, 'JPEG XL animation with a jhgm box decodes');
        assert(plain.every(f => f.gainMap === null) && (await Animation.decode(codestream)).every(f => f.gainMap === null), 'JPEG XL: gainMap false, or no jhgm box');
        assert(withMap.every(f => f.gainMap && f.gainMap.width === 4 && f.gainMap.gainMapMax[0] === 2), 'JPEG XL: every frame has the gain map');
        assert(withMap[0].gainMap !== withMap[1].gainMap && withMap.every((f, i) => Buffer.from(f.bitmap).equals(Buffer.from(plain[i].bitmap))), 'JPEG XL: the frames are the same with the map, with maps of their own');

        // toneMapping is checked
        let threw = false;
        try { await Animation.decode(png, {toneMapping: 'linear'}); } catch (e) { threw = e instanceof TypeError; }
        assert(threw, 'Animation.decode validates toneMapping');
        assert((await Animation.decode(codestream, {toneMapping: 'clamp'})).length === plain.length, 'Animation.decode with toneMapping clamp');
    }

    // trim and colorToAlpha take their color in the options too
    {
        const {GainMap} = require('..');
        const bordered = () => new Image(6, 5).fill(0x102030ff).setPixelAt(2, 2, 0xffffffff).setPixelAt(3, 2, 0x00000000);
        const same = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
        assert(same(bordered().trim(), bordered().trim(undefined)) && same(bordered().trim(), bordered().trim({})), 'trim() without arguments');
        const frame = () => Frame.from(bordered(), {duration: 100, xOffset: 3, yOffset: 4});
        assert(frame().trim({color: 0x102030ff}).xOffset === 5, 'Frame.trim({color}) moves the offsets');
        assert(same(bordered().colorToAlpha(), bordered().colorToAlpha(undefined)) && same(bordered().colorToAlpha(), bordered().colorToAlpha({})), 'colorToAlpha() without arguments');
        const map = new GainMap(new Image(4, 4).fill(0x808080ff), {gainMapMin: 0, gainMapMax: 2});
        assert(Buffer.from(await map.encode()).equals(Buffer.from(await map.encode({}))), 'GainMap.encode() without arguments');
    }

    // gradients, recolor with an image, drop shadows / glows and outlines
    {
        const {GainMap} = require('..');
        const px = (image, x, y) => Array.from(image.bitmap.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
        const alphaAt = (image, x, y) => image.bitmap[(y * image.width + x) * 4 + 3];
        const throws = (fn, type, message) => {
            let error = null;
            try { fn(); } catch (e) { error = e; }
            assert(error instanceof type, `${message}: should throw a ${type.name}, got ${error}`);
        };
        const stops = {0: 0xff0000ff, 0.5: 0x00ff00ff, 1: 0x0000ffff};
        const gradient = Colors.gradient(stops);
        const rgba = color => Colors.toRGBA(color);

        // linear gradients follow Colors.gradient along CSS' directions (0 up, 90 right, 180 down, 270 left)
        for (const [angle, at] of [[90, x => [x, 0, (x + 0.5) / 4]], [270, x => [x, 0, 1 - (x + 0.5) / 4]]]) {
            const horizontal = Image.linearGradient(4, 1, {stops, angle});
            for (let x = 0; x < 4; x++) {
                const [X, Y, t] = at(x);
                assert(px(horizontal, X, Y).join() === rgba(gradient(t)).join(), `linearGradient ${angle}deg, x ${x}: ${px(horizontal, X, Y)} vs ${rgba(gradient(t))}`);
            }
        }
        for (const [angle, t] of [[180, y => (y + 0.5) / 4], [0, y => 1 - (y + 0.5) / 4]]) {
            const vertical = Image.linearGradient(1, 4, {stops, angle});
            for (let y = 0; y < 4; y++)
                assert(px(vertical, 0, y).join() === rgba(gradient(t(y))).join(), `linearGradient ${angle}deg, y ${y}`);
        }
        const defaultDirection = Image.linearGradient(2, 3, {stops: [0xff0000ff, 0x0000ffff]});
        assert(px(defaultDirection, 0, 0).join() === px(defaultDirection, 1, 0).join() && px(defaultDirection, 0, 0)[0] > px(defaultDirection, 0, 2)[0], 'linearGradient goes down by default');
        const diagonal = Image.linearGradient(8, 8, {stops: [0x000000ff, 0xffffffff], angle: 135});
        assert(px(diagonal, 0, 0)[0] < 20 && px(diagonal, 7, 7)[0] > 235 && px(diagonal, 7, 0).join() === px(diagonal, 0, 7).join(), 'linearGradient at 135deg runs from corner to corner');
        // (an array of colors is evenly spaced, one color is a plain fill, alpha is part of the color)
        assert(px(Image.linearGradient(3, 1, {stops: [0xff0000ff, 0x00ff00ff, 0x0000ffff], angle: 90}), 1, 0).join() === rgba(Colors.gradient({0: 0xff0000ff, 0.5: 0x00ff00ff, 1: 0x0000ffff})(0.5)).join(), 'linearGradient with an array of colors');
        assert(px(Image.linearGradient(3, 3, {stops: [0x336699ff]}), 2, 2).join() === '51,102,153,255', 'linearGradient with one color');
        assert(px(Image.linearGradient(2, 1, {stops: [0xff000000, 0xff0000ff], angle: 90}), 0, 0)[3] < 100, 'linearGradient keeps alpha');

        // radial gradients: the center is the first stop, the radius the last
        const radial = Image.radialGradient(9, 9, {stops: [0xffffffff, 0x000000ff]});
        assert(px(radial, 4, 4)[0] > 240 && px(radial, 0, 0)[0] < 40 && px(radial, 0, 8).join() === px(radial, 8, 0).join(), 'radialGradient from the center to the farthest corner');
        const circle = Image.radialGradient(20, 20, {stops: [0xff0000ff, 0x0000ffff], x: 5.5, y: 5.5, radius: 4});
        assert(px(circle, 5, 5)[0] > 240 && px(circle, 15, 15).join() === '0,0,255,255' && px(circle, 9, 5)[2] > 200, 'radialGradient with a center and a radius');
        for (const [name, call] of Object.entries({
            'no stops': () => Image.linearGradient(2, 2, {stops: []}),
            'no stops (object)': () => Image.radialGradient(2, 2, {stops: {}}),
            'NaN angle': () => Image.linearGradient(2, 2, {stops: [1, 2], angle: NaN}),
            'zero radius': () => Image.radialGradient(2, 2, {stops: [1, 2], radius: 0}),
            'NaN center': () => Image.radialGradient(2, 2, {stops: [1, 2], x: NaN})
        })) throws(call, RangeError, name);

        // recolor(image) takes the RGB, keeps the alpha
        const shape = new Image(4, 1).fill(x => [0xffffff00, 0xffffff40, 0xffffff80, 0xffffffff][x]);
        const filled = shape.clone().recolor(Image.linearGradient(4, 1, {stops: [0xff0000ff, 0x0000ffff], angle: 90}));
        const colors = Image.linearGradient(4, 1, {stops: [0xff0000ff, 0x0000ffff], angle: 90});
        for (let x = 0; x < 4; x++)
            assert(px(filled, x, 0).join() === [...px(colors, x, 0).slice(0, 3), px(shape, x, 0)[3]].join(), `recolor(image), x ${x}`);
        assert(px(shape.clone().recolor(new Image(4, 1).fill(0x112233ff)), 3, 0).join() === '17,34,51,255', 'recolor(image) with a flat image');
        throws(() => shape.clone().recolor(new Image(3, 1)), RangeError, 'recolor(image) with another size');
        assert(shape.clone().recolor(0x336699ff).bitmap[0] === 0x33, 'recolor(color) still works');
        const mapped = new Image(8, 8).fill(0xffffffff);
        mapped.gainMap = new GainMap(new Image(4, 4).fill(0x808080ff), {gainMapMin: 0, gainMapMax: 2});
        mapped.recolor(Image.linearGradient(8, 8, {stops: [0xff0000ff, 0x0000ffff], angle: 90}));
        assert(px(mapped, 0, 0)[0] > 200 && px(mapped, 7, 0)[2] > 200 && mapped.gainMap && mapped.gainMap.width === 4, 'recolor(image) keeps the gain map');

        // drop shadows and glows
        const square = () => new Image(10, 10).fill((x, y) => x >= 3 && x < 7 && y >= 3 && y < 7 ? 0xff8040ff : 0);
        let image = square().dropShadow();
        assert(image.width === 10 && image.height === 10 && px(image, 4, 4).join() === '255,128,64,255' && px(image, 2, 4)[3] === 0, 'dropShadow() without offset or blur changes nothing outside of the shape');
        image = square().dropShadow({x: 2, y: 3});
        assert(image.width === 12 && image.height === 13, `dropShadow({x, y}) grows right and down: ${image.width}x${image.height}`);
        assert(px(image, 8, 9).join() === '0,0,0,128' && px(image, 4, 4).join() === '255,128,64,255' && px(image, 9, 9)[3] === 0, `dropShadow: the shadow is 50% black behind the shape, shifted: ${px(image, 8, 9)}`);
        image = square().dropShadow({x: -2, y: -1, color: 0xff0000ff});
        assert(image.width === 12 && image.height === 11 && px(image, 3, 3).join() === '255,0,0,255' && px(image, 5, 5).join() === '255,128,64,255', `dropShadow({x: -2, y: -1}) grows left and up, the image moves: ${image.width}x${image.height} ${px(image, 3, 3)}`);
        image = square().dropShadow({x: 2, y: 3, expand: false});
        assert(image.width === 10 && image.height === 10 && px(image, 8, 9).join() === '0,0,0,128', 'dropShadow({expand: false}) keeps the size');
        image = square().dropShadow({blur: 2});
        assert(image.width === 22 && image.height === 22, `dropShadow({blur}) leaves room for the blur (3 deviations): ${image.width}x${image.height}`);
        assert(alphaAt(image, 3 + 6 - 1, 3 + 6 + 2) > 0 && alphaAt(image, 0, 0) <= 1 && alphaAt(image, 3 + 6 + 1, 3 + 6 + 1) === 255 && px(image, 11, 11).join() === '255,128,64,255', 'dropShadow({blur}): a soft shadow around the shape, the shape on top');
        image = square().dropShadow({spread: 1.5, color: 0x00ff00ff});
        assert(image.width === 14 && px(image, 4, 7).join() === '0,255,0,255' && alphaAt(image, 3, 7) > 64 && alphaAt(image, 3, 7) < 192 && alphaAt(image, 2, 7) === 0, `dropShadow({spread}) grows the shape by the spread: ${[2, 3, 4].map(x => alphaAt(image, x, 7))}`);
        const glowing = square().dropShadow({blur: 3, spread: 1, color: 0xff2fb9ff});
        let pinks = 0;
        for (let i = 0; i < glowing.bitmap.length; i += 4)
            if (glowing.bitmap[i + 3] > 0 && glowing.bitmap[i + 3] < 255) pinks += glowing.bitmap[i] === 255 && glowing.bitmap[i + 1] === 47 && glowing.bitmap[i + 2] === 185 ? 1 : 0;
        assert(pinks > 200 && pinks === (() => { let n = 0; for (let i = 0; i < glowing.bitmap.length; i += 4) if (glowing.bitmap[i + 3] > 0 && glowing.bitmap[i + 3] < 255) n++; return n; })(), `a glow is exactly the color all around, also where it's faint: ${pinks} pixels`);
        throws(() => square().dropShadow({blur: -1}), RangeError, 'negative blur');
        throws(() => square().dropShadow({spread: -1}), RangeError, 'negative spread');
        throws(() => square().dropShadow({x: NaN}), RangeError, 'NaN offset');
        const translucent = new Image(6, 6).fill(0xffffff80);
        const shadowed = translucent.clone().dropShadow({color: 0x000000ff});
        assert(px(shadowed, 2, 2).join() === px(translucent, 2, 2).join() || px(shadowed, 2, 2)[3] >= 128, 'dropShadow keeps translucent pixels over their shadow');

        // frames stay in place: the offsets move with the growth, up and left only as far as they allow
        const frame = Frame.from(square(), {duration: 40, xOffset: 2, yOffset: 5}).dropShadow({blur: 2});
        assert(frame.xOffset === 0 && frame.yOffset === 0 && frame.width === 10 + 2 + 6 && frame.height === 10 + 5 + 6 && frame.duration === 40, `Frame.dropShadow: ${frame.width}x${frame.height} at ${frame.xOffset},${frame.yOffset}`);
        assert(px(frame, 2 + 4, 5 + 4).join() === '255,128,64,255', 'Frame.dropShadow: the pixels stay where they were on the animation canvas');
        const farFrame = Frame.from(square(), {xOffset: 20, yOffset: 20}).dropShadow({blur: 1});
        assert(farFrame.xOffset === 17 && farFrame.yOffset === 17, 'Frame.dropShadow with room moves the offsets by the growth');

        // gain maps grow with the image
        const hdr = square();
        hdr.gainMap = new GainMap(new Image(5, 5).fill(0xc0c0c0ff), {gainMapMin: 0, gainMapMax: 2});
        const hdrShadow = hdr.clone().dropShadow({x: 5, y: 0, blur: 1});
        assert(hdrShadow.gainMap && Math.abs(hdrShadow.gainMap.width / hdrShadow.width - 0.5) < 0.1 && Math.abs(hdrShadow.gainMap.height / hdrShadow.height - 0.5) < 0.1, 'dropShadow keeps the gain map at its scale');

        // outlines
        const outlined = square().outline({width: 2, color: 0xff0000ff});
        assert(outlined.width === 14 && outlined.height === 14, `outline({width}) grows by the width on every side: ${outlined.width}x${outlined.height}`);
        assert(px(outlined, 2 + 4, 2 + 4).join() === '255,128,64,255', 'outline keeps the shape');
        assert(px(outlined, 2 + 2, 2 + 4).join() === '255,0,0,255' && px(outlined, 2 + 1, 2 + 4)[3] > 100 && alphaAt(outlined, 0, 2 + 4) === 0 && alphaAt(outlined, 2 + 3, 0) === 0, `outline: the stroke is next to the shape and as wide as asked: ${px(outlined, 4, 6)} ${px(outlined, 3, 6)} ${px(outlined, 0, 6)}`);
        assert(alphaAt(outlined, 2 + 3 - 1, 2 + 3 - 1) > 200 && alphaAt(outlined, 2 + 3 - 2, 2 + 3 - 2) < 128, 'outline rounds the corners');
        const clipped = square().outline({width: 2, expand: false});
        assert(clipped.width === 10 && px(clipped, 2, 4).join() === '0,0,0,255' && px(clipped, 4, 4).join() === '255,128,64,255', 'outline({expand: false}) keeps the size');
        assert(square().outline({width: 0}).width === 10 && Buffer.from(square().outline({width: 0}).bitmap).equals(Buffer.from(square().bitmap)), 'outline({width: 0}) does nothing');
        assert(px(square().outline({width: 1, color: 0x00ff0080}), 2 + 2, 2 + 4).slice(3).join() === '128' || Math.abs(alphaAt(square().outline({width: 1, color: 0x00ff0080}), 3 - 1 + 1, 3 + 2 + 1) - 128) <= 1, 'outline with a translucent color');
        const holey = new Image(9, 9).fill((x, y) => x >= 2 && x < 7 && y >= 2 && y < 7 && !(x === 4 && y === 4) ? 0xffffffff : 0);
        assert(alphaAt(holey.clone().outline({width: 1, color: 0x000000ff}), 1 + 4, 1 + 4) === 255, 'outline fills small holes of the shape');
        throws(() => square().outline({width: -1}), RangeError, 'negative outline width');
        throws(() => square().outline({width: Infinity}), RangeError, 'infinite outline width');
        const outlinedFrame = Frame.from(square(), {xOffset: 1, yOffset: 4}).outline({width: 3});
        assert(outlinedFrame.xOffset === 0 && outlinedFrame.yOffset === 1 && outlinedFrame.width === 10 + 1 + 3 && outlinedFrame.height === 10 + 3 + 3, `Frame.outline: ${outlinedFrame.width}x${outlinedFrame.height} at ${outlinedFrame.xOffset},${outlinedFrame.yOffset}`);
        const glowOnText = new Image(12, 12).fill((x, y) => (x - 5.5) ** 2 + (y - 5.5) ** 2 < 16 ? 0xffffffff : 0).outline({width: 2, color: 0xfacc15ff}).dropShadow({blur: 1, y: 2});
        assert(glowOnText.width > 16 && glowOnText.height > 18, 'outline and dropShadow chain');
    }

    // Colors: the color helpers
    {
        assert(Colors.toRGB(0x11223344).join() === '17,34,51', 'Colors.toRGB ignores alpha');
        assert(Colors.toHSLA(0xff0000ff)[0] === 0, 'Colors.toHSLA');
        // HSLA round trip: each channel comes back within one step
        const rgba = Colors.toRGBA(Colors.fromRGBA(200, 100, 50, 255)), [h, s2, l, a2] = Colors.toHSLA(Colors.fromRGBA(200, 100, 50, 255));
        const back = Colors.toRGBA(Colors.fromHSLA(h, s2, l, a2));
        assert(back.every((c, i) => Math.abs(c - rgba[i]) <= 1), 'HSLA round trip: ' + back + ' vs ' + rgba);
    }

    // recolor: every pixel takes the color's RGB and keeps its own alpha (the color's alpha is ignored)
    {
        const image = new Image(2, 1);
        image.setPixelAt(0, 0, 0x102030ff);
        image.setPixelAt(1, 0, 0x40506080);
        assert(image.clone().recolor(0xffffffff).getPixelAt(0, 0) === 0xffffffff, 'recolor opaque pixel');
        const tinted = image.clone().recolor(0xaabbcc00);
        assert(tinted.getPixelAt(0, 0) === 0xaabbccff && tinted.getPixelAt(1, 0) === 0xaabbcc80, 'recolor keeps alpha: ' + tinted.getPixelAt(1, 0).toString(16));
        assert(image.clone().recolor(0xaabbccff).bitmap.length === 8, 'recolor size');
    }

    // options objects as alternatives to positional arguments
    {
        const base = new Image(20, 20).fill(0xff0000ff);
        assert(base.clone().rotate(45, {resize: false}).width === 20 && base.clone().rotate(45).width > 20, 'rotate options');
        const navy = new Image(10, 10).fill(0x00002aff).drawBox(0, 0, 3, 3, 0xc8c800ff);
        assert(navy.dominantColor({threshold: 0}) === 0x00002aff, 'dominantColor options');
    }

    // type checks take any binary data
    {
        const {ImageType} = require('..');
        const png = await new Image(1, 1).encodePNG();
        assert(ImageType.isPNG(png) && ImageType.isPNG(Buffer.from(png)) && ImageType.isPNG(new DataView(png.buffer)) && !ImageType.isGIF(png), 'ImageType checks');
    }

    // blur and sharpen: uniform images stay as they are, transparent pixels don't bleed their color
    {
        const flat = new Image(16, 16).fill(0x336699ff);
        for (const [name, op] of [['blur', i => i.blur(3)], ['blur small', i => i.blur(0.8)], ['sharpen', i => i.sharpen({amount: 2, radius: 1.5})]])
            assert(Buffer.from(op(flat.clone()).bitmap).equals(Buffer.from(flat.bitmap)), `${name} changed a uniform image`);
        assert(Buffer.from(flat.clone().blur(0).bitmap).equals(Buffer.from(flat.bitmap)) && Buffer.from(flat.clone().sharpen({amount: 0}).bitmap).equals(Buffer.from(flat.bitmap)), 'blur(0)/sharpen(0) should do nothing');

        const half = new Image(16, 16).fill((x) => x < 8 ? 0xff000000 : 0x0000ffff).blur(2);
        for (let x = 0; x < 16; x++) {
            const [r, , b, a] = rgba(half, x, 8);
            assert(a === 0 || (r === 0 && b === 255), `blur bled transparent color at ${x}: ${rgba(half, x, 8)}`);
        }

        const edge = new Image(16, 1).fill((x) => x < 8 ? 0x000000ff : 0xffffffff);
        const sharpened = edge.clone().sharpen({amount: 1, radius: 1});
        assert(rgba(sharpened, 7, 0)[0] === 0 && rgba(sharpened, 8, 0)[0] === 255, 'sharpen should keep a hard edge hard');
        const soft = new Image(16, 1).fill((x) => Colors.fromRGB(x * 16, x * 16, x * 16)).blur(1);
        const sharp = soft.clone().sharpen({amount: 3, radius: 2});
        assert(rgba(sharp, 15, 0)[0] >= rgba(soft, 15, 0)[0] && rgba(sharp, 0, 0)[0] <= rgba(soft, 0, 0)[0], 'sharpen should increase contrast');
    }

    // rgb adjustments
    {
        const image = new Image(64, 4).fill((x, y) => Colors.fromRGBA(x * 4, 255 - x * 4, y * 60, 200));
        for (const [name, op] of [['brightness(1)', i => i.brightness(1)], ['contrast(1)', i => i.contrast(1)], ['gamma(1)', i => i.gamma(1)]])
            assert(Buffer.from(op(image.clone()).bitmap).equals(Buffer.from(image.bitmap)), `${name} should not change the image`);

        const px = color => new Image(1, 1).fill(color);
        assert(rgba(px(0x804020ff).brightness(2), 0, 0).join() === '255,128,64,255', 'brightness(2)');
        assert(rgba(px(0x804020ff).contrast(0), 0, 0).join() === '128,128,128,255', 'contrast(0) should be grey');
        assert(rgba(px(0x40404080).gamma(2), 0, 0).join() === '128,128,128,128', 'gamma(2) should brighten and keep alpha, got ' + rgba(px(0x40404080).gamma(2), 0, 0));
        assert(rgba(px(0xff0000ff).greyscale(), 0, 0).join() === '76,76,76,255', 'greyscale should use the 601 luma');
        assert(rgba(px(0xffffff80).sepia(), 0, 0).join() === '255,255,239,128', 'sepia, got ' + rgba(px(0xffffff80).sepia(), 0, 0));

        let threw = 0;
        for (const op of [i => i.brightness(-1), i => i.contrast(NaN), i => i.gamma(0), i => i.blur(-1), i => i.sharpen({amount: 1, radius: 0})])
            try { op(px(0)); } catch { threw++; }
        assert(threw === 5, 'invalid adjustment arguments should throw');
    }

    // composite with opacity and blend modes
    {
        const base = new Image(2, 1).fill((x) => x ? 0x808080ff : 0x00000000);
        const top = new Image(2, 1).fill(0x4080c0ff);
        assert(Buffer.from(base.clone().composite(top, {x: 0, y: 0, opacity: 0}).bitmap).equals(Buffer.from(base.bitmap)), 'opacity 0 should change nothing');
        assert(rgba(base.clone().composite(top, {x: 0, y: 0, opacity: 0.5}), 1, 0).join() === '96,128,160,255', 'opacity 0.5');
        assert(rgba(base.clone().composite(top, {x: 0, y: 0, mode: 'multiply'}), 1, 0).join() === '32,64,96,255', 'multiply');
        assert(rgba(base.clone().composite(top, {x: 0, y: 0, mode: 'screen'}), 1, 0).join() === '160,192,224,255', 'screen');
        // over a transparent backdrop blend modes draw the plain source
        assert(rgba(base.clone().composite(top, {x: 0, y: 0, mode: 'multiply'}), 0, 0).join() === '64,128,192,255', 'blend over transparency');
        assert(Buffer.from(base.clone().composite(top, {x: 0, y: 0, mode: 'normal', opacity: 1}).bitmap).equals(Buffer.from(base.clone().composite(top).bitmap)), 'normal mode');

        // normal mode with an opacity (source over with the source alpha scaled) matches the general compositing model,
        // also for translucent pixels, off the edges
        let seed = 3;
        const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32;
        const pixel = () => Colors.fromRGBA(random() * 256 | 0, random() * 256 | 0, random() * 256 | 0, [0, 255, random() * 256 | 0][random() * 3 | 0]);
        const backdrop = new Image(24, 16).fill(pixel), source = new Image(16, 24).fill(pixel);
        for (const opacity of [0.3, 0.85, 0.999]) {
            const expected = backdrop.clone().__blend__(source, 12, -4, opacity, (_, s) => s).bitmap;
            const actual = backdrop.clone().composite(source, {x: 12, y: -4, opacity}).bitmap;
            assert(actual.every((v, i) => Math.abs(v - expected[i]) <= 1), `normal mode with opacity ${opacity} differs from the compositing model`);
        }

        let threw = 0;
        for (const options of [{mode: 'foo'}, {mode: 'toString'}, {opacity: 2}, {opacity: NaN}])
            try { base.clone().composite(top, {x: 0, y: 0, ...options}); } catch { threw++; }
        assert(threw === 4, 'invalid composite options should throw');
    }

    // outlined text grows by the stroke width and puts the stroke color around the glyphs
    {
        const font = require('fs').readFileSync('./tests/fonts/opensans bold.ttf');
        const plain = await Image.renderText('Hi', { font, size: 40 });
        const outlined = await Image.renderText('Hi', { font, size: 40, color: 0xffffffff, strokeWidth: 3, strokeColor: 0xff0000ff });
        assert(outlined.width === plain.width + 6 && outlined.height === plain.height + 6, 'stroke should grow the image');
        let red = 0, white = 0;
        for (const [, , color] of outlined.pixels()) {
            if (color === 0xff0000ff) red++;
            if (color === 0xffffffff) white++;
        }
        assert(red > 100 && white > 100, `outlined text should contain both colors (${red} red, ${white} white)`);

        // the stroke goes around translucent text, it doesn't show through it
        const translucent = await Image.renderText('Hi', { font, size: 40, color: 0x0000ff80, strokeWidth: 3, strokeColor: 0xff0000ff });
        const fill = await Image.renderText('Hi', { font, size: 40, color: 0x0000ff80 });
        let inside = 0, tinted = 0;
        // pixels the glyphs cover fully (the stroked image is 3 pixels larger on every side)
        for (const [x, y, color] of fill.pixels()) {
            if (color !== 0x0000ff80) continue;
            inside++;
            if (translucent.getPixelAt(x + 3, y + 3) !== 0x0000ff80) tinted++;
        }
        assert(inside > 100 && !tinted, `translucent text should show no stroke inside (${tinted} of ${inside} pixels tinted)`);
    }

    // PNGs are oriented by their eXIf chunk, ImageMagick's Exif text or XMP, in that order
    {
        const chunk = (type, body) => {
            const out = Buffer.alloc(12 + body.length);
            out.writeUInt32BE(body.length);
            out.write(type, 4, 'latin1');
            body.copy(out, 8);
            out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
            return out;
        };
        const tiff = orientation => Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0]);
        const xmp = orientation => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/"><tiff:Orientation>${orientation}</tiff:Orientation></rdf:Description></rdf:RDF></x:xmpmeta>`;
        const chunks = {
            exif: o => chunk('eXIf', tiff(o)),
            raw: o => {
                const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(o)]);
                return chunk('tEXt', Buffer.from(`Raw profile type exif\0\nexif\n${String(data.length).padStart(8)}\n${data.toString('hex').replace(/.{1,72}/g, '$&\n')}`, 'latin1'));
            },
            xmp: o => chunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\x01\0\0\0', 'latin1'), zlib.deflateSync(xmp(o))])),
        };

        const source = new Image(3, 2).fill((x, y) => Colors.fromRGBA(x * 100, y * 100, 0, 255));
        const encoded = Buffer.from(await source.encodePNG());
        const withChunks = (...extra) => Buffer.concat([encoded.subarray(0, encoded.length - 12), ...extra, encoded.subarray(encoded.length - 12)]);

        for (const [name, make] of Object.entries(chunks)) {
            const image = await Image.decode(withChunks(make(6)));
            assert(image.width === 2 && image.height === 3, `PNG ${name} orientation: not rotated`);
            assert(rgba(image, 1, 0).slice(0, 2).join() === '0,0', `PNG ${name} orientation: top left should end up top right`);
            const stored = await Image.decode(withChunks(make(6)), {applyOrientation: false});
            assert(stored.width === 3, `PNG ${name} orientation: applyOrientation false should keep the stored pixels`);
        }
        const both = await Image.decode(withChunks(chunks.xmp(6), chunks.exif(3)));
        assert(both.width === 3 && rgba(both, 2, 1).slice(0, 2).join() === '0,0', 'PNG orientation: eXIf should win over XMP');
    }

    // colorToAlpha removes the color, so compositing the result over that color gives the original back (#39)
    {
        const image = new Image(40, 40).fill(0xffffffff).drawCircle(20, 20, 12, 0xff0000ff);
        const cut = image.clone().colorToAlpha();
        assert(cut.getPixelAt(0, 0) === 0xffffff00, 'colorToAlpha: the background should become transparent');
        assert(cut.getPixelAt(20, 20) === 0xff0000ff, 'colorToAlpha: other colors should stay opaque');
        const back = new Image(40, 40).fill(0xffffffff).composite(cut);
        assert(Buffer.from(back.bitmap).equals(Buffer.from(image.bitmap)), 'colorToAlpha: compositing over the color should give the original');
        const edge = cut.getRGBAAt(32, 20);
        assert(edge[3] > 0 && edge[3] < 255 && edge[0] === 255 && edge[1] === 0, 'colorToAlpha: antialiased edges should become translucent red');
        const loose = image.clone().colorToAlpha({color: 0xffffffff, transparencyThreshold: 0.5});
        assert(loose.getRGBAAt(32, 20)[3] < edge[3], 'colorToAlpha: the threshold should make more of the edge transparent');
    }

    // slice-by-16 crc32 matches zlib for every length around the 16 byte steps and for unaligned views (#12)
    {
        const {crc32} = await import('../dist/codecs/crc.js');
        const data = new Uint8Array(1100).map((_, i) => i * 7919 >> 3);
        for (const offset of [0, 1, 3])
            for (let length = 0; length < 70; length++) {
                const view = data.subarray(offset, offset + length);
                assert(crc32(view) === zlib.crc32(view), `crc32: wrong for ${length} bytes at offset ${offset}`);
            }
        assert(crc32(data) === zlib.crc32(data), 'crc32: wrong for a long buffer');
    }

    // a VP8L prefix code with a single symbol >= 256 (here: a prefix group whose green alphabet only has one length
    // code) takes zero bits per symbol, the encoder wrote one (#82). Lossy WebPs code their alpha as VP8L too
    {
        for (const [colors, width, height, rows, start] of [[16, 128, 128, 8, 2], [4, 128, 256, 16, 5], [2, 256, 600, 64, 3]]) {
            let seed = start;
            const random = () => (seed = seed * 1103515245 + 12345 >>> 0) / 2 ** 32;
            // noisy rows on top and a noisy strip in the bottom left, the rest transparent
            const image = new Image(width, height).fill((x, y) => {
                const c = y < rows || y > height * 2 / 3 && x < 64 ? random() * colors | 0 : 0;
                return c ? Colors.fromRGBA(c * 37, c * 11, c, 255) : 0;
            });
            for (const options of [{}, {quality: 85}]) {
                const decoded = await Image.decode(await image.encodeWebP(options)).catch(err => assert(false, `WebP ${JSON.stringify(options)} of the ${width}x${height} mask: ${err.message}`));
                for (let i = 3; i < image.bitmap.length; i += 4)
                    assert(decoded.bitmap[i] === image.bitmap[i], `WebP ${JSON.stringify(options)} of the ${width}x${height} mask: wrong alpha`);
            }
        }
    }

    // damaged fonts (truncated, bytes changed) render or throw a font error, quickly: no runaway memory or time (contours
    // with decreasing end points, composite glyphs containing themselves, huge COLR clip boxes)
    {
        const fs = require('fs');
        let seed = 7;
        const random = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32;
        // (a damaged copy of the Noto-COLRv1 subset with 3329 contours of decreasing end points in a glyph ran out of memory)
        const start = Date.now();
        await Image.renderText('😀🔥👍❤️', { font: fs.readFileSync('./tests/fonts/damaged noto colrv1 subset.ttf'), size: 40 }).catch(err => assert(/^Font: /.test(err.message), err.message));
        assert(Date.now() - start < 3000, 'the damaged Noto-COLRv1 subset took too long');
        for (const file of ['sourcesans3 regular.otf', 'opensans bold.ttf', 'noto colrv1 subset.ttf', 'noto color emoji subset.ttf']) {
            const original = fs.readFileSync(`./tests/fonts/${file}`);
            for (let k = 0; k < 30; k++) {
                let data = original.subarray(0, Math.floor(random() * original.length));
                if (k >= 10) {
                    data = Buffer.from(original);
                    for (let n = 0; n < 1 + random() * 20; n++) data[Math.floor(random() * data.length)] = random() * 256;
                }
                const start = Date.now();
                try {
                    await Image.renderText('Hi office 😀🔥 👍🏽 🇩🇪 1️⃣ e\u0301', { font: data, size: 40 });
                } catch (err) {
                    assert(/^Font: /.test(err.message), `${file} #${k}: unexpected error for a damaged font: ${err.message}`);
                }
                assert(Date.now() - start < 3000, `${file} #${k}: a damaged font took ${Date.now() - start} ms`);
            }
        }
    }

    // decompression bombs: tiny files declaring huge images throw a RangeError before anything that size is allocated,
    // maxPixels sets the limit; damaged data throws an error saying so
    {
        const chunk = (type, body) => {
            const out = Buffer.alloc(12 + body.length);
            out.writeUInt32BE(body.length);
            out.write(type, 4, 'latin1');
            body.copy(out, 8);
            out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
            return out;
        };
        const png = (width, height) => {
            const header = Buffer.alloc(13);
            header.writeUInt32BE(width);
            header.writeUInt32BE(height, 4);
            header.set([8, 6, 0, 0, 0], 8);
            return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.alloc(64))), chunk('IEND', Buffer.alloc(0))]);
        };
        // a 4000x4000 screen with 50 frames of a pixel
        const frame = Buffer.from([0x21, 0xf9, 4, 0, 1, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]);
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0xa0, 0x0f, 0xa0, 0x0f, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]), ...Array(50).fill(frame), Buffer.from([0x3b])]);
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0xff, 0xdc, 0xff, 0xdc, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
        // 278x374 with 57859 samples per pixel (a damaged TIFF that took 6 GB)
        const entries = [[256, 4, 1, 278], [257, 4, 1, 374], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 8], [277, 3, 1, 57859], [278, 4, 1, 374], [279, 4, 1, 4]];
        const tiff = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
        tiff.write('II*\0', 0, 'latin1');
        tiff.writeUInt32LE(8, 4);
        tiff.writeUInt16LE(entries.length, 8);
        entries.forEach(([tag, type, count, value], k) => {
            const o = 10 + k * 12;
            tiff.writeUInt16LE(tag, o);
            tiff.writeUInt16LE(type, o + 2);
            tiff.writeUInt32LE(count, o + 4);
            if (type === 3) tiff.writeUInt16LE(value, o + 8);
            else tiff.writeUInt32LE(value, o + 8);
        });

        const tooLarge = async (name, decode) => {
            const start = Date.now();
            let error = null;
            try { await decode(); } catch (err) { error = err; }
            assert(error instanceof RangeError && /too large/.test(error.message), `${name}: should be too large (${error && error.message})`);
            assert(Date.now() - start < 1000, `${name}: took ${Date.now() - start} ms`);
        };
        await tooLarge('png', () => Image.decode(png(30000, 30000)));
        await tooLarge('png animation', () => Animation.decode(png(30000, 30000)));
        await tooLarge('jpeg', () => Image.decode(jpeg));
        await tooLarge('tiff samples', () => Image.decode(tiff));
        await tooLarge('gif frames', () => Animation.decode(gif, {maxPixels: 4000 * 4000 * 10}));
        await tooLarge('gif frames through GIF.decode', () => GIF.decode(gif, {maxPixels: 4000 * 4000 * 10}));
        await tooLarge('maxPixels', () => Image.decode(png(100, 100), {maxPixels: 9999}));

        // without a limit, the PNG gets as far as its data (which is too short)
        let error = null;
        try { await Image.decode(png(30000, 30000), {maxPixels: Infinity}); } catch (err) { error = err; }
        assert(error && /truncated/.test(error.message), `maxPixels: Infinity should lift the limit (${error && error.message})`);
        // the first frame alone fits
        assert((await Animation.decode(gif, {maxPixels: 4000 * 4000 * 10, onlyFirstFrame: true})).length === 1, 'the first frame should fit the limit');

        // damaged data
        error = null;
        try { await Image.decode(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0xff, 0, 0, 0])); } catch (err) { error = err; }
        assert(error && !(error instanceof RangeError), `damaged data should throw an Error, not a RangeError (${error && error.message})`);
    }

    // blur with a huge radius takes about as long as with a small one, infinite ones throw
    {
        const image = new Image(200, 100).fill(x => x < 100 ? 0xff0000ff : 0x0000ffff);
        const start = Date.now();
        image.blur(1e9);
        assert(Date.now() - start < 1000, `blur(1e9) took ${Date.now() - start} ms`);
        let threw = false;
        try { image.blur(Infinity); } catch { threw = true; }
        assert(threw, 'blur(Infinity) should throw');
    }

    // SVGs against denial of service: <use> references multiplying each other ("billion laughs") throw quickly,
    // dash patterns too fine to dash stroke solid, deeply nested elements render
    {
        const NS = 'xmlns="http://www.w3.org/2000/svg"';
        let defs = '<g id="l0"><rect width="1" height="1"/></g>';
        for (let i = 1; i <= 9; i++) defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
        let start = Date.now(), error = null;
        try { await Image.renderSVG(`<svg ${NS} width="100" height="100"><defs>${defs}</defs><use href="#l9"/></svg>`, {size: 100, mode: SVGScaleModes.WIDTH}); } catch (err) { error = err; }
        assert(error && /<use> references/.test(error.message) && Date.now() - start < 3000, `billion laughs should throw quickly (${error && error.message}, ${Date.now() - start} ms)`);

        start = Date.now();
        const dashed = await Image.renderSVG(`<svg ${NS} width="100" height="100"><path d="M0 50 L100000000 50" stroke="black" stroke-width="4" stroke-dasharray="0.0001"/></svg>`, {size: 100, mode: SVGScaleModes.WIDTH});
        assert(Date.now() - start < 3000 && dashed.getRGBAAt(50, 50)[3] === 255, 'a dash pattern too fine to dash should stroke solid, quickly');

        const nested = await Image.renderSVG(`<svg ${NS} width="100" height="100">${'<g>'.repeat(100000)}<rect width="10" height="10"/>${'</g>'.repeat(100000)}</svg>`, {size: 100, mode: SVGScaleModes.WIDTH});
        assert(nested.width === 100, 'deeply nested elements should render');
    }
    {
        // NaN and the infinities throw instead of drawing black, transparent or nothing; numeric strings still work
        const {Frame, Animation, TextLayout} = require('..');
        const image = () => new Image(8, 8).fill(0xff0000ff);
        const calls = {
            rgbaToColor: v => Colors.fromRGBA(v, 0, 0, 255), hslaToColor: v => Colors.fromHSLA(v, 0.5, 0.5, 1), colorToRGBA: v => Colors.toRGBA(v),
            getPixelAt: v => image().getPixelAt(v, 1), setPixelAt: v => image().setPixelAt(1, 1, v), fill: v => image().fill(v), contain: v => image().contain(v, 4),
            crop: v => image().crop(v, 0, 2, 2), trim: v => image().trim({color: v}), drawBox: v => image().drawBox(0, 0, v, 2, 0), drawCircle: v => image().drawCircle(2, 2, v, 0),
            cropCircle: v => image().cropCircle({ feathering: v }), opacity: v => image().opacity(v), red: v => image().red(v), lightness: v => image().lightness(v),
            composite: v => image().composite(image(), {x: v, y: 0}), hueShift: v => image().hueShift(v), brightness: v => image().brightness(v), gamma: v => image().gamma(v),
            colorToAlpha: v => image().colorToAlpha({color: v}), rotate: v => image().rotate(v, {resize: false}), gradient: v => Colors.gradient({0: v, 1: 0}),
            roundCorners: v => image().roundCorners({radius: v}), fisheye: v => image().fisheye({strength: v}), encodePNG: v => image().encodePNG({compression: v}), encodeJPEG: v => image().encodeJPEG({quality: v}),
            frame: v => new Frame(4, 4, {duration: v}), animation: v => new Animation([new Frame(4, 4)], {loopCount: v}),
        };
        for (const [name, call] of Object.entries(calls))
            for (const value of [NaN, Infinity, -Infinity]) {
                // (Infinity is a loop count for ever)
                if (name === 'animation' && value === Infinity) continue;
                let error = null;
                try {
                    await call(value);
                } catch (e) {
                    error = e;
                }
                if (!(error instanceof RangeError)) panic(`${name}(${value}) should throw a RangeError, got ${error}`);
            }
        const font = require('fs').readFileSync('./tests/fonts/opensans bold.ttf');
        for (const [name, call] of Object.entries({size: v => Image.renderText('a', { font, size: v }), color: v => Image.renderText('a', { font, size: 12, color: v }),
            maxWidth: v => new TextLayout({maxWidth: v})}))
            if (!await Promise.resolve().then(() => call(NaN)).then(() => false, e => e instanceof RangeError)) panic(`renderText: a NaN ${name} should throw a RangeError`);
        // (no limit is a valid layout)
        new TextLayout({maxWidth: Infinity, maxHeight: Infinity});

        const strings = image().crop('1', '1', '4', '4').rotate('45').opacity('0.5').composite(image(), {x: '1', y: '2'});
        if (strings.width !== 6) panic('numeric strings should keep working');
    }
    {
        // SVG parsing doesn't backtrack: long malformed styles, references, lengths and colors parse in linear time
        const big = 200000;
        const svgs = {
            'style without braces': `<style>${'a'.repeat(big)}</style>`,
            'style of at-signs': `<style>${'@'.repeat(big)}</style>`,
            'unterminated comments': `<style>${'/*'.repeat(big / 2)}</style>`,
            'url reference': `<rect width="2" height="2" fill="url(#a${' '.repeat(big)}"/>`,
            'url spaces': `<rect width="2" height="2" fill="url(${' '.repeat(big)}x"/>`,
            'url repeated': `<rect width="2" height="2" fill="${'url('.repeat(big / 4)}"/>`,
            'length digits': `<rect width="${'1'.repeat(big)}x" height="2"/>`,
            'length spaces': `<rect width="1${' '.repeat(big)}x" height="2"/>`,
            'color function': `<rect width="2" height="2" fill="rgb(${' '.repeat(big)}"/>`,
        };
        for (const [name, content] of Object.entries(svgs)) {
            const start = Date.now();
            await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${content}</svg>`, {size: 1}).catch(() => {});
            if (Date.now() - start > 1000) panic(`SVG ${name}: took ${Date.now() - start} ms`);
        }
    }
})();
