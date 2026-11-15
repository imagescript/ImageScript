const fs = require('fs').promises;
const {Image, Animation, Frame, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const rejects = async (name, fn, Type) => {
    try {
        await fn();
    } catch (error) {
        if (!(error instanceof Type)) panic(`${name}: wrong error ${error?.constructor?.name}: ${error?.message}`);
        return;
    }
    panic(`${name}: accepted`);
};

(async () => {
    const image = new Image(8, 8).fill((x, y) => Colors.fromRGB(x * 30, y * 30, 128));

    // PNG chunks with a bad checksum: metadata chunks are skipped (like libpng and browsers), the image's own are an error
    {
        const png = Buffer.from(await image.encodePNG({metadata: {title: 'Sunset'}}));
        const find = type => {
            for (let i = 8; i < png.length;) {
                const length = png.readUInt32BE(i);
                if (png.toString('latin1', i + 4, i + 8) === type) return i;
                i += 12 + length;
            }
            panic(`no ${type} chunk`);
        };
        const broken = type => {
            const copy = Buffer.from(png), i = find(type);
            copy[i + 8 + copy.readUInt32BE(i)] ^= 0xff;
            return copy;
        };
        const skipped = await Image.decode(broken('tEXt'));
        if (!Buffer.from(skipped.bitmap).equals(Buffer.from(image.bitmap))) panic('a bad checksum on a text chunk should be skipped');
        await rejects('bad checksum on IDAT', () => Image.decode(broken('IDAT')), Error);
        await rejects('bad checksum on IHDR', () => Image.decode(broken('IHDR')), Error);
    }

    // JPEG: corrupt entropy data in a scan with restart markers decodes on from the next marker (like libjpeg), without
    // markers nothing can resync, so it is an error
    {
        const restart = await fs.readFile('./tests/jpegs/restart.jpg');
        const clean = await Image.decode(restart);
        const markers = [];
        for (let i = 0; i < restart.length - 1; i++) if (restart[i] === 0xff && restart[i + 1] >= 0xd0 && restart[i + 1] <= 0xd7) markers.push(i);
        if (markers.length < 2) panic('restart.jpg should have restart markers');
        const damaged = Buffer.from(restart), from = markers[0] + 2 + (markers[1] - markers[0] >> 2), count = markers[1] - markers[0] >> 2;
        for (let i = 0; i < count; i++) damaged[from + i] = i & 1 ? 0 : 0xff;
        const decoded = await Image.decode(damaged);
        if (decoded.width !== clean.width || decoded.height !== clean.height) panic('a damaged restart interval changed the size');
        let same = 0;
        for (let i = 0; i < clean.bitmap.length; i += 4)
            if (clean.bitmap[i] === decoded.bitmap[i] && clean.bitmap[i + 1] === decoded.bitmap[i + 1] && clean.bitmap[i + 2] === decoded.bitmap[i + 2]) same++;
        if (same < clean.width * clean.height * 0.7) panic(`a damaged restart interval should leave the other intervals intact: ${same} of ${clean.width * clean.height} pixels unchanged`);
        // an interval whose data is cut short (the decoder reads into the next marker) is damage too, not a cut-off file
        const shortened = Buffer.concat([restart.subarray(0, markers[0] + 40), restart.subarray(markers[1] - 10)]);
        if ((await Image.decode(shortened)).width !== clean.width) panic('a shortened restart interval changed the size');
        const cut = Buffer.concat([restart.subarray(0, markers[1] + 40), Buffer.from([0xff, 0xd9])]);
        await rejects('a scan cut off after a restart marker', () => Image.decode(cut), Error);

        const plain = (await Promise.all((await fs.readdir('./tests/jpegs')).filter(name => name.endsWith('.jpg')).map(name => fs.readFile(`./tests/jpegs/${name}`))))
            .find(data => data.indexOf(Buffer.from([0xff, 0xdd])) < 0 && data.indexOf(Buffer.from([0xff, 0xda])) > 0 && data.length > data.indexOf(Buffer.from([0xff, 0xda])) + 400);
        if (!plain) panic('no JPEG fixture without restart markers');
        const scan = plain.indexOf(Buffer.from([0xff, 0xda])) + 2 + plain.readUInt16BE(plain.indexOf(Buffer.from([0xff, 0xda])) + 2);
        const damagedPlain = Buffer.from(plain);
        for (let i = 0; i < 60; i++) damagedPlain[scan + 150 + i] = i & 1 ? 0 : 0xff;
        await rejects('corrupt scan data without restart markers', () => Image.decode(damagedPlain), Error);
    }

    // a fully transparent image round-trips through BMP: the file declares its alpha mask, so its zeros are alpha
    {
        const back = await Image.decode(await new Image(3, 2).encodeBMP());
        if (back.bitmap[3] !== 0) panic('a fully transparent BMP decoded as opaque');
        const half = await Image.decode(await new Image(3, 2).fill(0xff000080).encodeBMP());
        if (half.bitmap[3] !== 0x80) panic('BMP alpha lost');
    }

    // a right-to-left line with a space at its wrap point (which sits at its visual left) is placed by its ink
    {
        const font = await fs.readFile('./tests/fonts/noto naskh arabic subset.ttf');
        const inkLeft = image => {
            let left = image.width;
            for (const [x, , color] of image.pixels()) if (color & 0xff) left = Math.min(left, x);
            return left;
        };
        const word = await Image.renderText('مرحبا', {font, size: 28, width: 120, horizontalAlign: 'left'});
        const spaced = await Image.renderText('مرحبا ', {font, size: 28, width: 120, horizontalAlign: 'left'});
        if (inkLeft(spaced) !== inkLeft(word)) panic(`a trailing space moved a left-aligned right-to-left line: ${inkLeft(spaced)} instead of ${inkLeft(word)}`);
        const wrapped = await Image.renderText('مرحبا بالعالم', {font, size: 28, width: 90, horizontalAlign: 'left'});
        if (inkLeft(wrapped.extract(0, 0, 90, 36)) > 3) panic('the first line of a wrapped right-to-left paragraph should be flush left');
        const centered = await Image.renderText('مرحبا ', {font, size: 28, width: 120, horizontalAlign: 'center'});
        const centeredWord = await Image.renderText('مرحبا', {font, size: 28, width: 120, horizontalAlign: 'center'});
        if (Math.abs(inkLeft(centered) - inkLeft(centeredWord)) > 1) panic('a trailing space moved a centered right-to-left line');
        const right = await Image.renderText('مرحبا ', {font, size: 28, width: 120});
        if (right.width !== 120 || inkLeft(right) < 40) panic('right alignment changed');
    }

    // renderSVG() refuses null sizes (a null width gave a 1x1 image, a null scale was ignored)
    {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" width="50"/>';
        await rejects('renderSVG width null', () => Image.renderSVG(svg, {width: null}), TypeError);
        await rejects('renderSVG height null', () => Image.renderSVG(svg, {height: null}), TypeError);
        await rejects('renderSVG scale null', () => Image.renderSVG(svg, {scale: null}), TypeError);
        if ((await Image.renderSVG(svg, {width: 100})).height !== 60) panic('renderSVG width');
    }

    // more values of the wrong type are TypeErrors, with a designed message
    {
        const font = await fs.readFile('./tests/fonts/sourcesans3 regular.otf');
        await rejects('renderText width string', () => Image.renderText('Hi', {font, size: 20, width: '300'}), TypeError);
        await rejects('renderText height null', () => Image.renderText('Hi', {font, size: 20, height: null}), TypeError);
        await rejects('transform string value', () => image.clone().transform([1, 0, 0, 1, 0, '0']), TypeError);
        await rejects('colorMatrix string value', () => image.clone().colorMatrix([1, 0, 0, 0, 1, 0, 0, 0, '1']), TypeError);
        await rejects('gifEncoder string width', () => Animation.gifEncoder('64', 64), TypeError);
        await rejects('apngEncoder string height', () => Animation.apngEncoder(64, '64'), TypeError);
        await rejects('Animation canvas string', () => new Animation([new Frame(image)], {width: '8', height: 8}), TypeError);
        await rejects('transform origin null', () => image.clone().transform([1, 0, 0, 1, 0, 0], {origin: null}), TypeError);
        await rejects('transform origin number', () => image.clone().transform([1, 0, 0, 1, 0, 0], {origin: 0}), TypeError);
        await rejects('Animation frames NaN', () => new Animation(NaN), TypeError);
        await rejects('Animation frames null', () => new Animation(null), TypeError);
        await rejects('decode null', () => Image.decode(null), TypeError);
        await rejects('linearGradient without stops', () => Image.linearGradient(4, 4, {}), TypeError);
        await rejects('radialGradient without stops', () => Image.radialGradient(4, 4, {}), TypeError);
        const messages = [];
        for (const fn of [() => Image.renderText('Hi', {font, size: 20, width: {}}), () => image.clone().resize(2, 2, {mode: {}}), () => new Animation(null), () => Image.decode(null), () => image.clone().transform([1, 0, 0, 1, 0, 0], {origin: null})]) {
            try {
                await fn();
                panic('a wrong type was accepted');
            } catch (error) {
                messages.push(error.message);
            }
        }
        for (const message of messages) if (/\[object|Cannot read|not of type|undefined/.test(message)) panic(`raw message: ${message}`);
    }

    // options can't be arrays, metadata can't be null or an array
    {
        await rejects('encodePNG array options', () => image.encodePNG([1]), TypeError);
        await rejects('decode array options', async () => Image.decode(await image.encodePNG(), [1]), TypeError);
        await rejects('resize array options', () => image.clone().resize(4, 4, []), TypeError);
        await rejects('metadata null', () => image.encodePNG({metadata: null}), TypeError);
        await rejects('metadata array', () => image.encodeJPEG({metadata: ['Sunset']}), TypeError);
        if ((await image.encodePNG({metadata: {}})).length < 50) panic('metadata {}');
    }
})();
