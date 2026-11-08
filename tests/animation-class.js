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

const a = new Frame(4, 4, {duration: 10}).fill(0xff0000ff);
const b = new Frame(2, 2, {duration: 20, xOffset: 1, yOffset: 1}).fill(0x00ff00ff);
const c = new Frame(3, 3, {duration: 30}).fill(0x0000ffff);

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

// frames: the array the animation uses, live and assignable
if (animation.frames[0] !== a || animation.frames[1] !== b) panic('frames should be the frames');
animation.frames.push(c);
if (animation.length !== 3 || animation.duration !== 60) panic('pushing to frames should add a frame');
animation.frames.splice(1, 1);
if (animation.length !== 2 || animation.frames[1] !== c) panic('splicing frames should remove a frame');
animation.frames[0] = b;
if (animation.frames[0] !== b) panic('setting an index of frames should replace the frame');
animation.frames = [a, c];
if (animation.length !== 2 || animation.frames[0] !== a || animation.frames[1] !== c) panic('assigning frames should replace them');

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
if (new Animation([Frame.from(first, {duration: 5})]).frames[0].duration !== 5) panic('Frame.from frames');
