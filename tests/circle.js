const fs = require('fs').promises;
const {Image} = require('..');
const samePixels = require('./util/pixels');

const panic = message => {
    console.error(message);
    process.exit(1);
};

(async () => {
    {
        const image = new Image(256, 512);
        image.fill(0x000000ff);
        image.cropCircle();

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/circle3.png', encoded);

        const target = await fs.readFile('./tests/targets/circle3.png');
        if (!await samePixels(target, encoded)) panic('cropCircle failed');
    }

    {
        const image = new Image(256, 512);
        image.fill(0x000000ff);
        image.cropCircle({ size: 'cover', feathering: .5 });

        const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

        if (process.env.OVERWRITE_TEST)
            await fs.writeFile('./tests/targets/circle4.png', encoded);

        const target = await fs.readFile('./tests/targets/circle4.png');
        if (!await samePixels(target, encoded)) panic('cropCircle max feathering failed');
    }
})();
