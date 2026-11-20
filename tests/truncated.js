const {Image, Animation, Frame, Colors} = require('..');
const {inspect} = require('util');

const panic = message => {
    console.error(message);
    process.exit(1);
};

(async () => {
    // a cut-off JPEG or lossy WebP is a decoding error, not an image with gray or smeared parts (cuts that leave the
    // pixels whole, like a missing end marker or metadata after the data, still decode)
    const photo = new Image(120, 90).fill((x, y) => Colors.fromRGBA(x * 2 % 256, y * 3 % 256, (x * y) % 256, 255));
    const decodes = async bytes => { try { await Image.decode(bytes); return true; } catch { return false; } };

    for (const [name, bytes] of [
        ['JPEG', await photo.encodeJPEG({quality: 80})],
        ['WebP', await photo.encodeWebP({quality: 80})]
    ]) {
        const whole = await Image.decode(bytes);
        if (whole.width !== 120) panic(`${name}: the whole file doesn't decode`);
        let failed = 0;
        const cuts = 40;
        // (the last bytes of a JPEG are its end marker, and of a WebP its metadata: cuts only in the data before)
        for (let i = 1; i < cuts; i++) if (!await decodes(bytes.subarray(0, Math.floor(bytes.length * 0.9 * i / cuts)))) failed++;
        if (failed !== cuts - 1) panic(`${name}: ${cuts - 1 - failed} of ${cuts - 1} cut-off files decoded without an error`);
    }

    // a small lossy WebP cut anywhere inside of its image data, not only where the data is read to (every cut before the
    // bitstream's size is reached)
    {
        const small = await Image.linearGradient(67, 41, {stops: [0xff2040ff, 0x3040ffff], angle: 135}).encodeWebP({quality: 80});
        const view = new DataView(small.buffer, small.byteOffset);
        // (the VP8 chunk of the extended format, after the VP8X chunk of 18 bytes)
        let at = 12;
        while (String.fromCharCode(...small.subarray(at, at + 4)) !== 'VP8 ') at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) & 1);
        const end = at + 8 + view.getUint32(at + 4, true);
        for (let cut = at + 8; cut < end; cut++)
            if (await decodes(small.subarray(0, cut))) panic(`a lossy WebP cut ${end - cut} bytes before the end of its image data decoded`);
        if (!await decodes(small)) panic('the whole small WebP does not decode');
    }

    // a JPEG without its end marker has all its pixels
    const jpeg = await photo.encodeJPEG({quality: 80});
    if (!await decodes(jpeg.subarray(0, jpeg.length - 2))) panic('a JPEG without its end marker is rejected');

    // iterating while the image is resized yields the pixels the image had at the start
    {
        const image = new Image(2, 2);
        let count = 0;
        for (const _ of image.pixels()) {
            count++;
            image.resize(4, 4);
        }
        if (count !== 4) panic(`pixels() of an image resized meanwhile yielded ${count} pixels`);
    }

    // a still image is a frame of the default duration
    for (const bytes of [await photo.encodePNG(), await photo.encodeJXL(), await photo.encodeJPEG()]) {
        const animation = await Animation.decode(bytes);
        if (animation.frames[0].duration !== new Frame(photo).duration) panic(`a still image's frame lasts ${animation.frames[0].duration} ms (${bytes.slice(0, 4)})`);
    }

    // logging and serializing don't write the pixels
    const frame = new Frame(photo);
    const animation = new Animation([frame]);
    if (JSON.stringify(photo) !== '{"width":120,"height":90}') panic(`JSON.stringify(image): ${JSON.stringify(photo)}`);
    if (inspect(photo) !== 'Image<120x90>') panic(`inspect(image): ${inspect(photo)}`);
    if (inspect(animation) !== String(animation) || inspect(frame) !== String(frame)) panic('inspect(animation or frame)');
    if (JSON.stringify(frame).length > 80 || JSON.stringify(animation).length > 100) panic('JSON.stringify(frame or animation) is long');

    try {
        new Colors();
        panic('new Colors() works');
    } catch (error) {
        if (!(error instanceof TypeError)) panic(`new Colors(): ${error}`);
    }
})();
