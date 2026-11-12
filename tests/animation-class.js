const {Image, Frame, Animation} = require('..');
const lib = require('..');

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

// an animation holds its frames: it is not an array
const animation = new Animation([a, b]);
if (Array.isArray(animation)) panic('Array.isArray(animation) should be false');
if (animation instanceof Array) panic('an animation should not be an Array');
if (Object.prototype.toString.call(animation) !== '[object Object]') panic(`animation tag: ${Object.prototype.toString.call(animation)}`);

// the removed Array members are gone: the animation and its prototype
for (const name of ['push', 'pop', 'map', 'filter', 'slice', 'forEach', 'reduce', 'some', 'every', 'find', 'splice', 'concat', 'join'])
    if (animation[name] !== undefined || Animation.prototype[name] !== undefined) panic(`Animation.${name} should be gone`);
if (animation[0] !== undefined) panic('animation[0] should be gone: use animation.frames[0]');
if (Animation[Symbol.species] !== undefined) panic('Animation[Symbol.species] should be gone');
if (lib.GIF !== undefined) panic('the GIF export should be gone');

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
throwsA(() => new Animation([a], {loopCount: 2.5}), RangeError, 'a fractional loop count');
if (new Animation([a], {loopCount: 2}).loopCount !== 2) panic('loopCount option not applied');

// the size, duration and text of the animation come from its frames
const sized = new Animation([a, b]);
if (sized.width !== 4 || sized.height !== 4 || sized.duration !== 30) panic(`size ${sized.width}x${sized.height}, ${sized.duration} ms`);
if (sized.toString() !== 'Animation<4x4x30ms>') panic(`toString: ${sized.toString()}`);
const first = new Image(2, 2);
if (new Animation([new Frame(first.clone(), {duration: 5})]).frames[0].duration !== 5) panic('Frame from an image');

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
