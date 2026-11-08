const fs = require('fs').promises;
const {Image, Colors} = require('..');
const samePixels = require('./util/pixels');

module.exports = (async () => {
    const image = new Image(128, 128);
    image.fill(x => Colors.fromHSL(x / image.width, 1, 0.5));

    const encoded = await image.encodePNG({compression: 1, metadata: {creationTime: 0, software: ''}});

    if (process.env.OVERWRITE_TEST)
        await fs.writeFile('./tests/targets/image.png', encoded);

    const desired = await fs.readFile('./tests/targets/image.png');
    if (process.argv[1].slice(-8) === 'image.js') process.exit(await samePixels(desired, encoded) ? 0 : 1);

    return image;
})();
