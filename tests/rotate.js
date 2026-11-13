const fs = require('fs').promises;
const {Image, Colors} = require('..');
const samePixels = require('./util/pixels');
const panic = msg => {
    console.error(msg);
    process.exit(1);
};

(async () => {
    {
        const binary = await fs.readFile('./tests/targets/image.png');
        const image = await Image.decode(binary);
        image.rotate(-45);

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/rotate-45.png', encoded);
        const target = await fs.readFile('./tests/targets/rotate-45.png');
        if (!await samePixels(target, encoded)) panic('rotate 45 failed');
    }

    {
        const binary = await fs.readFile('./tests/targets/image.png');
        const image = await Image.decode(binary);
        image.rotate(-45, {expand: false});

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/rotate-45-noresize.png', encoded);

        const target = await fs.readFile('./tests/targets/rotate-45-noresize.png');
        if (!await samePixels(target, encoded)) panic('rotate 45 noresize failed');
    }

    {
        const binary = await fs.readFile('./tests/targets/image.png');
        const image = await Image.decode(binary);
        image.rotate(-90);

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/rotate-90.png', encoded);
        const target = await fs.readFile('./tests/targets/rotate-90.png');
        if (!await samePixels(target, encoded)) panic('rotate 90 failed');
    }

    {
        const binary = await fs.readFile('./tests/targets/image.png');
        const image = await Image.decode(binary);
        image.rotate(180);

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/rotate-180.png', encoded);
        const target = await fs.readFile('./tests/targets/rotate-180.png');
        if (!await samePixels(target, encoded)) panic('rotate 180 failed');
    }

    {
        const binary = await fs.readFile('./tests/targets/image.png');
        const image = await Image.decode(binary);
        image.rotate(-270);

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/rotate-270.png', encoded);
        const target = await fs.readFile('./tests/targets/rotate-270.png');
        if (!await samePixels(target, encoded)) panic('rotate 270 failed');
    }

    {
        const image = new Image(512, 512);
        image.fill((x) => Colors.fromHSL(x / image.width * 360, 1, .5));
        if (!Buffer.from(image.bitmap).equals(Buffer.from(image.rotate(360).bitmap)))
            panic('rotate 360 failed');
    }

    // rotate() turns clockwise; the modes sample like transform()'s, nearest-neighbor only keeps source colors
    {
        const source = new Image(8, 6).fill((x, y) => Colors.fromRGBA(x * 30, y * 40, 100, 255));
        const cw = source.clone().rotate(90);
        if (cw.getPixelAt(cw.width - 1, 0) !== source.getPixelAt(0, 0)) panic('rotate(90) should turn clockwise: the top left corner goes to the top right');
        const colors = new Set(source.bitmap.length ? [...source.pixels()].map(([, , c]) => c) : []);
        const nearest = source.clone().rotate(30, {mode: 'nearest-neighbor'});
        for (const [x, y, c] of nearest.pixels()) if ((c & 0xff) && !colors.has(c)) panic(`rotate nearest-neighbor: new color at ${x},${y}`);
        const bicubic = source.clone().rotate(30, {mode: 'bicubic'}), bilinear = source.clone().rotate(30);
        if (bicubic.width !== bilinear.width || Buffer.from(bicubic.bitmap).equals(Buffer.from(bilinear.bitmap))) panic('rotate bicubic should differ from bilinear');
        const angle = 30 * Math.PI / 180;
        const viaTransform = source.clone().transform([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0], {expand: false, mode: 'bicubic'});
        const viaRotate = source.clone().rotate(30, {expand: false, mode: 'bicubic'});
        if (!Buffer.from(viaTransform.bitmap).equals(Buffer.from(viaRotate.bitmap))) panic('rotate should sample like transform');
        let error = null;
        try { source.clone().rotate(30, {mode: 'area'}); } catch (e) { error = e; }
        if (!(error instanceof TypeError)) panic(`rotate mode 'area' should throw a TypeError, got ${error}`);
    }

    // the bilinear rotation samples 8-bit pixels (about twice as fast as the precise sampling transform() does): it
    // stays within a step of it for opaque pixels, translucent ones within 2.5 steps where they show (premultiplied,
    // alpha within 2)
    {
        const photo = (await Image.decode(await fs.readFile('./bench/inputs/photo.jpg'))).crop(700, 300, 400, 300);
        const transparent = photo.clone();
        for (let i = 0; i < transparent.bitmap.length; i += 4) transparent.bitmap[i + 3] = (i >> 2) % transparent.width * 255 / (transparent.width - 1);
        for (const source of [photo, transparent])
            for (const [angle, expand] of [[30, false], [-17.5, false], [123, false], [0.3, false]]) {
                // (transform's turn is clockwise as well: the same matrix as the rotation's)
                const rad = angle * Math.PI / 180;
                const a = source.clone().transform([Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0], {expand}).bitmap, b = source.clone().rotate(angle, {expand}).bitmap;
                let opaque = 0, shown = 0;
                for (let i = 0; i < a.length; i++) {
                    if (a[i] === b[i]) continue;
                    const al = a[i | 3], bl = b[i | 3];
                    if ((i & 3) === 3) shown = Math.max(shown, Math.abs(a[i] - b[i]));
                    else if (al === 255 && bl === 255) opaque = Math.max(opaque, Math.abs(a[i] - b[i]));
                    else shown = Math.max(shown, Math.abs(a[i] * al - b[i] * bl) / 255);
                }
                if (opaque > 1 || shown > 2.5) panic(`bilinear rotate ${angle}: ${opaque} (opaque), ${shown} (shown)`);
            }
    }

    // right angles with `expand: false` keep the size like every other angle (they used to swap width and height):
    // the turned image is centered, what doesn't fit is cut off
    {
        for (const [width, height] of [[4, 2], [5, 2], [2, 5], [3, 3], [6, 4]]) {
            const source = new Image(width, height).fill((x, y) => Colors.fromRGBA(x * 10 + 1, y * 10 + 1, 7, 255));
            for (const angle of [90, 180, 270, -90, 450]) {
                const kept = source.clone().rotate(angle, {expand: false});
                if (kept.width !== width || kept.height !== height) panic(`${width}x${height}.rotate(${angle}, { expand: false }) is ${kept.width}x${kept.height}`);
                const turned = source.clone().rotate(angle);
                const left = Math.floor((width - turned.width) / 2), top = Math.floor((height - turned.height) / 2);
                for (let y = 0; y < height; y++)
                    for (let x = 0; x < width; x++) {
                        const tx = x - left, ty = y - top;
                        const inside = tx >= 0 && ty >= 0 && tx < turned.width && ty < turned.height;
                        const expected = inside ? turned.getPixelAt(tx, ty) : 0;
                        if (kept.getPixelAt(x, y) !== expected) panic(`${width}x${height}.rotate(${angle}, { expand: false }): pixel ${x},${y} is ${kept.getPixelAt(x, y).toString(16)} instead of ${expected.toString(16)}`);
                    }
                if (angle !== 90 && angle !== 270 && angle !== -90 && angle !== 450 || width === height)
                    if (Buffer.compare(Buffer.from(kept.bitmap), Buffer.from(turned.bitmap))) panic(`${width}x${height}.rotate(${angle}, { expand: false }) should equal the expanded one`);
            }
        }
    }
})();
