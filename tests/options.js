const fs = require('fs').promises;
const {Image, Frame, Animation, decode} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const same = (name, a, b) => {
    const x = a.bitmap ?? a, y = b.bitmap ?? b;
    if (x.length !== y.length || x.some((v, i) => v !== y[i])) panic(`${name}: the results differ`);
};

// the defaults: leaving out the options and passing an empty object give the same result
(async () => {
    const photo = await Image.decode(await fs.readFile('./tests/targets/external.jpg'));
    const tile = () => photo.clone().resize(64, 48);
    const logo = new Image(16, 16).fill(0xff000080);

    // the default mode
    same('resize default', tile().resize(30, 40), tile().resize(30, 40, {}));

    same('composite default', tile().composite(logo), tile().composite(logo, {}));
    same('roundCorners default', tile().roundCorners(), tile().roundCorners({}));
    same('fisheye default', tile().fisheye(), tile().fisheye({}));

    // the metadata goes in { metadata }
    const author = 'options test';
    for (const data of [await tile().encodePNG({metadata: {author}}), await tile().encodePNG({compression: 1, metadata: {author}})])
        if (!Buffer.from(data).includes(author)) panic('encode: metadata missing');
    if (!Buffer.from(await tile().encodeJPEG({metadata: {author}})).includes(author)) panic('encodeJPEG: metadata missing');
    for (const method of ['encodeWebP', 'encodeTGA'])
        if (!Buffer.from(await tile()[method]({metadata: {author}})).includes(author)) panic(`${method}: metadata missing`);

    const svg = await fs.readFile('./tests/svgs/crown.svg');

    // frames and animations
    const b = new Frame(8, 6, {duration: 40, xOffset: 2, yOffset: 3, disposalMode: 'background'});
    const c = Frame.from(logo, {duration: 40, xOffset: 2, yOffset: 3, disposalMode: 'background'});
    for (const frame of [b, c])
        if (frame.duration !== 40 || frame.xOffset !== 2 || frame.yOffset !== 3 || frame.disposalMode !== 'background') panic('Frame: options not applied');
    if (new Frame(1, 1, {}).duration !== 100 || new Frame(1, 1, {}).disposalMode !== 'keep') panic('Frame: wrong defaults');

    const frames = () => [Frame.from(tile(), {duration: 50}), Frame.from(tile().invert(), {duration: 50})];
    if (new Animation(frames(), {loopCount: 2}).loopCount !== 2) panic('Animation: loopCount not applied');
    const animation = new Animation(frames());
    // (GIFs only store comments)
    for (const method of ['encodeGIF', 'encodeAPNG', 'encodeWebP'])
        if (!Buffer.from(await animation[method]({metadata: {author, comment: author}})).includes(author)) panic(`${method}: metadata missing`);

    const gif = await animation.encodeGIF();
    if ((await Animation.decode(gif, {onlyFirstFrame: true})).length !== 1) panic('decode: onlyFirstFrame not applied');
    if (!(await decode(gif, {onlyFirstFrame: true}) instanceof Image)) panic('decode: onlyFirstFrame should return an Image');
    if ((await decode(gif, {})).length !== 2) panic('decode: wrong default');

    // decode() passes applyOrientation on to Image.decode()
    const rotated = await fs.readFile('./tests/targets/external.jpg');
    same('decode', await decode(rotated, {applyOrientation: false}), await Image.decode(rotated, {applyOrientation: false}));
})();
