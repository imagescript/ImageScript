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
})();
