const fs = require('fs').promises;
const {Image, Colors} = require('..');
const samePixels = require('./util/pixels');

(async () => {
    const photo = await Image.decode(await fs.readFile('./tests/targets/external.jpg'));
    const tile = () => photo.clone().resize(128, 128);
    const gradient = new Image(128, 128).fill((x, y) => Colors.fromRGB(x * 2, 255 - y * 2, 140));
    const font = await fs.readFile('./tests/fonts/opensans bold.ttf');

    const tiles = [
        tile().blur(3), tile().sharpen({amount: 2, radius: 2}), tile().greyscale(), tile().sepia(),
        tile().brightness(1.3), tile().contrast(1.6), tile().gamma(2),
        tile().composite(gradient, {opacity: 0.4}),
        ...['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'add']
            .map(mode => tile().composite(gradient, {mode}))
    ];

    const image = new Image(5 * 128, 4 * 128 + 80).fill(0x404040ff);
    tiles.forEach((t, i) => image.composite(t, {x: (i % 5) * 128, y: (i / 5 | 0) * 128}));
    image.composite(await Image.renderText('Outlined', { font, size: 56, color: 0xffffffff, strokeWidth: 5 }), {x: 8, y: 4 * 128 + 4});

    const encoded = await image.encodePNG(1, {creationTime: 0, software: ''});

    if (process.env.OVERWRITE_TEST)
        await fs.writeFile('./tests/targets/effects.png', encoded);

    const target = await fs.readFile('./tests/targets/effects.png');
    if (!await samePixels(target, encoded)) process.exit(1);
})();
