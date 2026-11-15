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
})();
