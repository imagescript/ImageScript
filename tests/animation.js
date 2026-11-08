const {Image, Frame, Animation, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// what the animation looks like, frame by frame: frames are drawn over the canvas, then disposed
function expected(animation) {
    const width = animation.width, height = animation.height;
    let canvas = new Image(width, height);
    return Array.from(animation, frame => {
        const previous = canvas.clone();
        canvas.composite(frame, {x: frame.xOffset, y: frame.yOffset});
        const shown = canvas.clone();
        if (frame.disposalMode === 'background')
            for (let y = Math.max(0, frame.yOffset); y < Math.min(height, frame.yOffset + frame.height); y++)
                for (let x = Math.max(0, frame.xOffset); x < Math.min(width, frame.xOffset + frame.width); x++) canvas.setPixelAt(x, y, 0);
        else if (frame.disposalMode === 'previous') canvas = previous;
        return shown;
    });
}

const square = (color, w, h) => new Image(w, h).fill((x, y) => (x + y) % 5 === 0 ? 0 : color);

(async () => {
    for (const variant of [0, 1]) {
        const animation = new Animation([
            Frame.from(new Image(40, 30).fill((x, y) => Colors.fromRGBA(x * 6, y * 8, 128, 255)), {duration: 100}),
            Frame.from(square(0xff2040ff, 10, 8), {duration: 50, xOffset: variant ? 3 : 4, yOffset: variant ? 5 : 6, disposalMode: 'background'}),
            Frame.from(square(0x20ff40ff, 12, 10), {duration: 70, xOffset: 10, yOffset: 10, disposalMode: variant ? 'previous' : 'keep'}),
            Frame.from(square(0xc8374fff, 8, 8), {duration: 30, xOffset: 20, yOffset: 2, disposalMode: 'keep'})
        ], {loopCount: 2});
        const reference = expected(animation);

        for (const format of ['APNG', 'WebP']) {
            const bytes = await animation[`encode${format}`]();
            const back = await Animation.decode(bytes);
            if (back.length !== 4 || back.loopCount !== 2) panic(`${format}: wrong frame or loop count`);
            if (back.frames.map(f => f.duration).join() !== '100,50,70,30') panic(`${format}: wrong durations`);
            back.frames.forEach((frame, i) => {
                if (!Buffer.from(frame.bitmap).equals(Buffer.from(reference[i].bitmap))) panic(`${format} variant ${variant}: frame ${i} differs`);
            });
        }
    }

    // a plain PNG's default image is what Image.decode returns for an APNG
    const animation = new Animation([Frame.from(new Image(8, 8).fill(0xff0000ff), {duration: 100}), Frame.from(new Image(8, 8).fill(0x00ff00ff), {duration: 100})]);
    const apng = await animation.encodeAPNG();
    const still = await Image.decode(apng);
    if (still.getPixelAt(0, 0) !== 0xff0000ff) panic('APNG: the default image should be the first frame');

    // still images decode to a single frame; GIFs stay GIFs
    const single = await Animation.decode(await still.encodePNG());
    if (single.length !== 1 || single.width !== 8) panic('Animation.decode should accept still images');
    const gif = await Animation.decode(await new Animation([Frame.from(still)]).encodeGIF());
    if (!(gif instanceof Animation) || gif.length !== 1) panic('Animation.decode should decode GIFs');
    if (!(new Animation(gif.frames.slice(0, 1), {loopCount: gif.loopCount}) instanceof Animation)) panic('a new animation of some frames');

    // frames: the animation's frames, changing them changes the animation
    {
        const animation = new Animation([Frame.from(still)]);
        if (animation.frames.length !== 1) panic('frames should hold the frames');
        animation.frames.push(Frame.from(still, {duration: 50}));
        if (animation.length !== 2 || animation.duration !== 150) panic('frames.push should add a frame');
        if (!Array.isArray(animation.frames.map(f => f.duration))) panic('frames.map should return an array');
        animation.frames = animation.frames.filter(f => f.duration === 50);
        if (animation.length !== 1 || animation.frames[0].duration !== 50) panic('setting frames should replace them');
        let threw = false;
        try { animation.frames = [still]; } catch { threw = true; }
        if (!threw || animation.length !== 1) panic('frames should only take frames');
    }

    // loop counts: Infinity forever, 0 once, n repeats
    for (const loopCount of [Infinity, 0, 1, 5]) {
        // (different frames: identical ones are merged, and a single frame has no loop count)
        const two = new Animation([Frame.from(still), Frame.from(still.clone().invert())], {loopCount});
        for (const format of ['APNG', 'WebP', 'GIF'])
            if ((await Animation.decode(await two[`encode${format}`]())).loopCount !== loopCount) panic(`${format}: loop count ${loopCount} not kept`);
    }
})();
