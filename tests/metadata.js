const {Image, Frame, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const has = (data, text) => Buffer.from(data).includes(Buffer.from(text));
const latin1 = (data, text) => Buffer.from(data).includes(Buffer.from(text, 'latin1'));

(async () => {
    // (without the version: it would tell which release made a file)
    const software = 'ImageScript';
    const image = new Image(8, 4).fill(0xff000080);
    const animation = new Animation([new Frame(image.clone(), {duration: 100}), new Frame(new Image(8, 4).fill(0x00ff00ff), {duration: 100})]);

    const encoders = {
        png: m => image.encodePNG({metadata: m}),
        jpeg: m => image.encodeJPEG({quality: 90, metadata: m}),
        webp: m => image.encodeWebP({metadata: m}),
        tga: m => image.encodeTGA({metadata: m}),
        avif: m => image.encodeAVIF({effort: 0, metadata: m}),
        jxl: m => image.encodeJXL({metadata: m}),
        gif: m => animation.encodeGIF({metadata: m}),
        apng: m => animation.encodeAPNG({metadata: m}),
        'animated webp': m => animation.encodeWebP({metadata: m})
    };

    // every format names the software by default, '' leaves it out, and the files still decode
    for (const [format, encode] of Object.entries(encoders)) {
        const tagged = await encode();
        if (!has(tagged, software)) panic(`${format}: software missing by default`);
        if (has(tagged, `${software} v`)) panic(`${format}: the default software names the version`);
        // no creation time unless one is given: the same image encodes to the same bytes, whenever it's encoded
        const now = Date.now;
        Date.now = () => 0;
        const early = await encode();
        Date.now = () => 4e12;
        const late = await encode();
        Date.now = now;
        if (!Buffer.from(early).equals(Buffer.from(late))) panic(`${format}: encoding depends on the time`);
        if (has(await encode({software: ''}), 'ImageScript')) panic(`${format}: software: '' should leave it out`);
        if (has(await encode({software: null}), 'ImageScript')) panic(`${format}: software: null should leave it out`);
        // (null is no time: not the epoch)
        if (!Buffer.from(await encode({creationTime: null})).equals(Buffer.from(await encode({})))) panic(`${format}: creationTime: null should be the default`);
        if (!has(await encode({software: 'custom tool'}), 'custom tool')) panic(`${format}: custom software missing`);

        const decoded = /gif|apng|animated/.test(format) ? (await Animation.decode(tagged)).frames[0] : await Image.decode(tagged);
        if (decoded.width !== 8 || decoded.height !== 4) panic(`${format}: doesn't decode with metadata`);
    }

    const metadata = {author: 'Jörg', description: 'a description', copyright: 'Ⓒ someone', comment: 'a comment', creationTime: Date.UTC(2026, 9, 15, 12, 34, 56)};

    // PNG: tEXt is Latin-1, other text goes into iTXt (UTF-8), before the image data
    {
        const png = Buffer.from(await image.encodePNG({metadata: metadata}));
        if (!latin1(png, 'Author\0Jörg')) panic('png: Latin-1 text should be a tEXt chunk');
        if (!has(png, 'iTXtCopyright\0\0\0\0\0Ⓒ someone')) panic('png: other text should be an iTXt chunk');
        if (png.indexOf('tEXt') > png.indexOf('IDAT')) panic('png: text chunks should come before the image data');
        if (!has(png, 'Thu, 15 Oct 2026 12:34:56 GMT')) panic('png: creation time missing');
        if (has(await image.encodePNG(), 'Creation Time')) panic('png: a creation time without one given');
    }

    // JPEG, WebP, AVIF and JPEG XL: Exif (IFD0 strings, UTC date; AVIF and JPEG XL: the TIFF header's offset first),
    // JPEG also a comment marker
    for (const format of ['jpeg', 'webp', 'avif', 'jxl']) {
        const file = await encoders[format](metadata);
        const header = {jpeg: 'Exif\0\0MM\0*', webp: 'EXIF', avif: '\0\0\0\0MM\0*', jxl: 'Exif\0\0\0\0MM\0*'}[format];
        for (const text of [header, 'MM\0*', 'Jörg', 'a description', 'Ⓒ someone', '2026:10:15 12:34:56\0', '+00:00'])
            if (!has(file, text)) panic(`${format}: ${JSON.stringify(text)} missing from the Exif data`);
        if (format === 'jpeg' && !has(file, Buffer.from([0xff, 0xfe, 0, 11, ...Buffer.from('a comment')]))) panic('jpeg: comment marker missing');
    }

    // AVIF: the Exif item (3, after the alpha image) describes the image (cdsc); JPEG XL: the container's boxes
    if (!has(await encoders.avif(metadata), Buffer.from([...Buffer.from('cdsc'), 0, 3, 0, 1, 0, 1]))) panic('avif: Exif item reference missing');
    if (Buffer.from(await encoders.jxl(metadata)).subarray(0, 48).toString('latin1').replace(/[^ -~]/g, '.') !== '....JXL ........ftypjxl ....jxl ....Exif....MM.*')
        panic('jxl: container boxes wrong');

    // GIF: comment extensions
    if (!has(await animation.encodeGIF({metadata}), Buffer.from([0x21, 0xfe, 9, ...Buffer.from('a comment'), 0]))) panic('gif: comment extension missing');

    // TGA: extension area, referenced by the footer
    {
        const tga = Buffer.from(await image.encodeTGA({metadata: {...metadata, comment: 'line 1\n' + 'x'.repeat(100)}}));
        const area = tga.readUInt32LE(tga.length - 26);
        if (tga.readUInt16LE(area) !== 495) panic('tga: extension area missing');
        const field = (offset, size) => tga.subarray(area + offset, area + offset + size).toString().split('\0')[0];
        if (field(2, 41) !== 'Jörg') panic('tga: author missing');
        // long lines wrap at 80 bytes
        if (field(43, 81) !== 'line 1' || field(124, 81) !== 'x'.repeat(80) || field(205, 81) !== 'x'.repeat(20)) panic('tga: comment lines wrong');
        if ([0, 1, 2, 3, 4, 5].map(i => tga.readUInt16LE(area + 367 + i * 2)).join() !== '10,15,2026,12,34,56') panic('tga: date wrong');
        if (field(426, 41) !== software) panic('tga: software missing');
        if (tga[area + 494] !== 3) panic('tga: attributes type should be "useful alpha"');
    }

    if (await image.encodePNG({metadata: {creationTime: 'not a date'}}).then(() => true, () => false)) panic('an invalid creation time should throw');
})();
