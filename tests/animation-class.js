const {Image, Frame, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const throwsA = (fn, type, label) => {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
    return error;
};

const a = new Frame(new Image(4, 4).fill(0xff0000ff), {duration: 10});
const b = new Frame(new Image(2, 2).fill(0x00ff00ff), {duration: 20, xOffset: 1, yOffset: 1});
const c = new Frame(new Image(3, 3).fill(0x0000ffff), {duration: 30});

const animation = new Animation([a, b]);

// frames: a frozen snapshot; the Frame objects remain mutable and replacing the list is assignable
if (animation.frames[0] !== a || animation.frames[1] !== b) panic('frames should be the frames');
const originalFrames = animation.frames;
if (!Object.isFrozen(originalFrames)) panic('frames should be frozen');
if (Reflect.set(originalFrames, 0, c) || animation.frames[0] !== a) panic('setting a frame index should not change the animation');
throwsA(() => originalFrames.push(c), TypeError, 'pushing to frozen frames');
animation.frames[0].duration = 15;
if (animation.frames[0].duration !== 15) panic('frames themselves should remain mutable');
animation.frames[0].duration = 10;
animation.frames = [...animation.frames, c];
if (animation.length !== 3 || animation.duration !== 60) panic('assigning an added frame should add a frame');
animation.frames = [animation.frames[0], animation.frames[2]];
if (animation.length !== 2 || animation.frames[1] !== c) panic('assigning a new frame list should remove a frame');
animation.frames = [a, c];
if (animation.length !== 2 || animation.frames[0] !== a || animation.frames[1] !== c) panic('assigning frames should replace them');
if (originalFrames === animation.frames || originalFrames.length !== 2) panic('replacing frames should return a new snapshot');

// assigning copies: the array given isn't the one the animation uses, and a bad frame changes nothing
const list = [b, c];
animation.frames = list;
if (animation.frames === list) panic('assigned frames should be copied into the animation');
list.push(a);
if (animation.length !== 2) panic('changing the array given to frames should not change the animation');
throwsA(() => { animation.frames = [a, {}]; }, TypeError, 'assigning a non-frame');
if (animation.length !== 2 || animation.frames[0] !== b) panic('a rejected assignment should leave the frames untouched');

// length is read-only and counts the frames
if (Reflect.set(animation, 'length', 5) !== false || animation.length !== 2) panic('length should be read-only');
if (new Animation([]).length !== 0) panic('an empty animation has no frames');

// iteration
const seen = [];
for (const frame of animation) seen.push(frame);
if (seen.length !== 2 || seen[0] !== b || seen[1] !== c) panic('for...of should iterate the frames');
if ([...animation].length !== 2 || Array.from(animation)[1] !== c) panic('spread and Array.from should iterate the frames');
const iterator = animation[Symbol.iterator]();
if (iterator.next().value !== b || iterator.next().value !== c || !iterator.next().done) panic('the iterator should end after the frames');

// the constructor takes a copy of the frames, validates them and the options
const list2 = [a];
const copy = new Animation(list2);
list2.push(b);
if (copy.length !== 1) panic('the constructor should copy the frames');
throwsA(() => new Animation([a, 'frame']), TypeError, 'a string as a frame');
throwsA(() => new Animation([{width: 4, height: 4}]), TypeError, 'an image-like object as a frame');
throwsA(() => new Animation(5), TypeError, 'a number as the frames');
throwsA(() => new Animation(null), TypeError, 'null as the frames');
throwsA(() => new Animation([a], 2), TypeError, 'a loop count instead of options');
if (new Animation([a], {loopCount: 2}).loopCount !== 2) panic('loopCount option not applied');

// the size, duration and text of the animation come from its frames
const sized = new Animation([a, b]);
if (sized.width !== 4 || sized.height !== 4 || sized.duration !== 30) panic(`size ${sized.width}x${sized.height}, ${sized.duration} ms`);
const first = new Image(2, 2);
if (new Animation([new Frame(first.clone(), {duration: 5})]).frames[0].duration !== 5) panic('Frame from an image');

// crop() clips the region to the canvas like Image.crop() does: the canvas is the part of the region that overlaps it
{
    const picture = () => new Image(20, 20).fill((x, y) => 0xff | x << 24 | y << 16);
    for (const [x, y, width, height] of [[-5, -5, 10, 10], [15, 15, 10, 10], [-5, 4, 30, 6], [2, 3, 4, 5]]) {
        const cropped = new Animation([new Frame(picture())]).crop(x, y, width, height);
        const expected = picture().crop(x, y, width, height);
        if (cropped.width !== expected.width || cropped.height !== expected.height) panic(`crop(${x}, ${y}, ${width}, ${height}): canvas ${cropped.width}x${cropped.height}, Image.crop gives ${expected.width}x${expected.height}`);
        const frame = cropped.frames[0];
        if (Buffer.compare(Buffer.from(frame.image.bitmap), Buffer.from(expected.bitmap)) || frame.xOffset !== 0 || frame.yOffset !== 0) panic(`crop(${x}, ${y}, ${width}, ${height}): the frame isn't what Image.crop keeps`);
    }
    throwsA(() => new Animation([new Frame(picture())]).crop(-20, 0, 10, 10), RangeError, 'a region outside the canvas');
}

// frames of one image at different offsets resize to the sizes their edges give, each its own
{
    const shared = new Image(9, 4).fill(0xff0000ff);
    const animation = new Animation([new Frame(shared), new Frame(shared, {xOffset: 3})], {width: 12, height: 4}).resize(2, 4);
    const [first, second] = animation.frames;
    if (first.width !== 2 || second.width !== 1 || second.xOffset !== 1) panic(`shared image: widths ${first.width}, ${second.width}, second at ${second.xOffset}; canvas ${animation.width}`);
    if (first.image === second.image) panic('frames that need different sizes can\'t share the image');
    if (second.xOffset + second.width > animation.width) panic('a frame reaches past the canvas');
    throwsA(() => new Animation([new Frame(new Image(4, 4))]).resize(0, 0), RangeError, 'resize(0, 0)');
}

// a frame listed twice (to hold it, or in a ping-pong), or two frames of one image, change once
{
    const shape = frames => frames.map(frame => [frame.xOffset, frame.yOffset, frame.width, frame.height]).join(';');
    const same = (label, operate, build) => {
        const f = new Frame(build(), {duration: 10});
        const repeated = operate(new Animation([f, f, f]));
        const distinct = operate(new Animation([0, 1, 2].map(() => new Frame(build(), {duration: 10}))));
        if (repeated.width !== distinct.width || repeated.height !== distinct.height) panic(`${label}: canvas ${repeated.width}x${repeated.height} instead of ${distinct.width}x${distinct.height}`);
        if (shape(repeated.frames) !== shape(distinct.frames)) panic(`${label}: frames ${shape(repeated.frames)} instead of ${shape(distinct.frames)}`);
        for (let i = 0; i < 3; i++)
            if (Buffer.compare(Buffer.from(repeated.frames[i].image.bitmap), Buffer.from(distinct.frames[i].image.bitmap))) panic(`${label}: frame ${i} has other pixels`);
    };
    const gradient = (width, height) => () => new Image(width, height).fill((x, y) => 0xff | (x * 255 / width | 0) << 24 | (y * 255 / height | 0) << 16);
    same('resize', animation => animation.resize(50, 50), gradient(100, 100));
    same('scale', animation => animation.scale(2), gradient(100, 100));
    same('crop', animation => animation.crop(10, 10, 50, 50), gradient(100, 100));
    same('trim', animation => animation.trim(), () => new Image(40, 40).fill(0).composite(new Image(10, 10).fill(0xff0000ff), {x: 10, y: 10}));
    same('resize contain', animation => animation.resize({width: 100, height: 100, fit: 'contain'}), gradient(100, 50));
    same('resize cover', animation => animation.resize({width: 60, height: 60, fit: 'cover'}), gradient(100, 50));

    const image = new Image(100, 100).fill(0xff0000ff);
    const shared = new Animation([new Frame(image), new Frame(image, {xOffset: 0})]).resize(50, 50);
    if (shared.frames[0].width !== 50 || shared.frames[1].width !== 50 || image.width !== 50) panic(`two frames of one image: ${shared.frames[0].width}, ${shared.frames[1].width}`);
}

// flip mirrors every frame and its place on the canvas, which keeps its size
{
    const left = new Image(4, 2).fill((x) => x === 0 ? 0xff0000ff : 0x0000ffff);
    const flipped = new Animation([new Frame(left, {xOffset: 1, yOffset: 1}), new Frame(new Image(3, 3).fill(0x00ff00ff), {xOffset: 6, yOffset: 2})], {width: 10, height: 6});
    flipped.flip('horizontal');
    const [one, two] = flipped.frames;
    if (flipped.width !== 10 || flipped.height !== 6) panic(`flip: the canvas should stay 10x6, got ${flipped}`);
    if (one.xOffset !== 5 || one.yOffset !== 1 || two.xOffset !== 1 || two.yOffset !== 2) panic(`flip horizontal: offsets ${one.xOffset},${one.yOffset} ${two.xOffset},${two.yOffset}`);
    if (one.image.getPixelAt(3, 0) !== 0xff0000ff || one.image.getPixelAt(0, 0) !== 0x0000ffff) panic('flip horizontal: the frame should be mirrored');
    flipped.flip('vertical');
    if (one.yOffset !== 3 || two.yOffset !== 1 || one.xOffset !== 5) panic(`flip vertical: offsets ${one.xOffset},${one.yOffset} ${two.yOffset}`);
    // (an unknown direction is a TypeError, and changes nothing)
    throwsA(() => flipped.flip('diagonal'), TypeError, 'flip: an unknown direction');
    if (one.xOffset !== 5 || one.image.getPixelAt(3, 1) !== 0xff0000ff) panic('flip: an unknown direction should change nothing');
    // a canvas that follows the frames stays where it was
    const following = new Animation([new Frame(new Image(2, 2), {xOffset: 3})]);
    following.flip('horizontal');
    if (following.width !== 5 || following.frames[0].xOffset !== 0) panic(`flip: a canvas following the frames: ${following} at ${following.frames[0].xOffset}`);
    // a frame listed twice, or two frames of one image, are flipped once
    const image = new Image(2, 1).fill(x => x ? 0x0000ffff : 0xff0000ff);
    const held = new Frame(image, {xOffset: 1});
    const repeated = new Animation([held, held, new Frame(image, {xOffset: 4})], {width: 8, height: 1}).flip('horizontal');
    if (image.getPixelAt(0, 0) !== 0x0000ffff) panic('flip: an image of several frames should be flipped once');
    if (repeated.frames[0].xOffset !== 5 || repeated.frames[1].xOffset !== 5 || repeated.frames[2].xOffset !== 2) panic(`flip: repeated frames at ${repeated.frames.map(f => f.xOffset)}`);
}
