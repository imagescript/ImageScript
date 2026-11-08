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
})();
