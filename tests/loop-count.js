const {Image, Frame, Animation} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const throwsA = (fn, type, label) => {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
};

const frames = () => [Frame.from(new Image(4, 4).fill(0xff0000ff), {duration: 40}), Frame.from(new Image(4, 4).fill(0x00ff00ff), {duration: 60})];
// each format: its encode method, its encoder factory, and the count the file stores when it loops forever or plays
// (the GIF's NETSCAPE block counts repetitions, APNG and WebP count plays)
const formats = {GIF: ['encodeGIF', 'gifEncoder'], APNG: ['encodeAPNG', 'apngEncoder'], WebP: ['encodeWebP', 'webpEncoder']};

// the NETSCAPE2.0 loop count of a GIF (0 = forever), or null if it has none (it plays once)
const netscape = bytes => {
    const at = Buffer.from(bytes).indexOf('NETSCAPE2.0');
    return at < 0 ? null : Buffer.from(bytes).readUInt16LE(at + 13);
};

(async () => {
    // the default is forever, everywhere
    if (new Animation(frames()).loopCount !== Infinity || new Animation([]).loopCount !== Infinity) panic('the default loop count should be Infinity');
    for (const [format, [encode, factory]] of Object.entries(formats)) {
        const animation = new Animation(frames());
        const bytes = await animation[encode]();
        const encoder = Animation[factory](4, 4);
        for (const frame of frames()) await encoder.add(frame);
        if (!Buffer.from(await encoder.finish()).equals(Buffer.from(bytes))) panic(`${format}: the encoder's default isn't the animation's`);
        if (encode === 'encodeGIF' && netscape(bytes) !== 0) panic(`${format}: forever should be stored as NETSCAPE count 0, not ${netscape(bytes)}`);

        // decoded: a file that loops forever is Infinity
        const back = await Animation.decode(bytes);
        if (back.loopCount !== Infinity) panic(`${format}: a file that loops forever decodes as ${back.loopCount}`);
    }

    // Infinity is forever, explicitly, in every entry point
    for (const [format, [encode, factory]] of Object.entries(formats)) {
        const forever = await new Animation(frames(), {loopCount: Infinity})[encode]();
        if (!Buffer.from(forever).equals(Buffer.from(await new Animation(frames())[encode]()))) panic(`${format}: Infinity isn't the default`);
        const encoder = Animation[factory](4, 4, {loopCount: Infinity});
        for (const frame of frames()) await encoder.add(frame);
        if (!Buffer.from(await encoder.finish()).equals(Buffer.from(forever))) panic(`${format}: the encoder with Infinity`);
        const setter = new Animation(frames(), {loopCount: 2});
        setter.loopCount = Infinity;
        if (setter.loopCount !== Infinity) panic(`${format}: the loopCount setter`);
    }

    // finite counts: 0 plays once, n repeats n times, through the constructor, the setter and each encoder
    for (const count of [0, 1, 5]) {
        for (const [format, [encode, factory]] of Object.entries(formats)) {
            const bytes = await new Animation(frames(), {loopCount: count})[encode]();
            if (format === 'GIF' && netscape(bytes) !== (count === 0 ? null : count)) panic(`GIF: loop count ${count} stored as ${netscape(bytes)}`);
            const back = await Animation.decode(bytes);
            if (back.loopCount !== count) panic(`${format}: loop count ${count} decodes as ${back.loopCount}`);

            const encoder = Animation[factory](4, 4, {loopCount: count});
            for (const frame of frames()) await encoder.add(frame);
            if (!Buffer.from(await encoder.finish()).equals(Buffer.from(bytes))) panic(`${format}: encoder with loop count ${count} differs`);

            const set = new Animation(frames());
            set.loopCount = count;
            if (set.loopCount !== count || !Buffer.from(await set[encode]()).equals(Buffer.from(bytes))) panic(`${format}: setter with loop count ${count}`);
        }
    }

    // a single frame has no loop count of its own: it's the default, forever
    if ((await Animation.decode(await new Animation([frames()[0]]).encodeAPNG())).loopCount !== Infinity) panic('a still APNG should decode as Infinity');

    // the largest count each format stores round-trips (GIF's 16 bits, WebP's 16 bits of plays, APNG's 31 bits of plays);
    // one more would wrap around (65536 as a GIF is forever), so every entry point throws a RangeError instead
    const limits = {GIF: 65535, WebP: 65534, APNG: 2 ** 31 - 2};
    for (const [format, max] of Object.entries(limits)) {
        const [encode, factory] = formats[format];
        const bytes = await new Animation(frames(), {loopCount: max})[encode]();
        if (format === 'GIF' && netscape(bytes) !== max) panic(`GIF: the largest count ${max} is stored as ${netscape(bytes)}`);
        const back = await Animation.decode(bytes);
        if (back.loopCount !== max) panic(`${format}: the largest count ${max} decodes as ${back.loopCount}`);
        const encoder = Animation[factory](4, 4, {loopCount: max});
        for (const frame of frames()) await encoder.add(frame);
        if (!Buffer.from(await encoder.finish()).equals(Buffer.from(bytes))) panic(`${format}: the encoder with the largest count ${max} differs`);

        const over = max + 1;
        let error = null;
        try { await new Animation(frames(), {loopCount: over})[encode](); } catch (e) { error = e; }
        if (!(error instanceof RangeError) || !error.message.includes(`${format} loop counts go up to ${max}, not ${over}`)) panic(`${format}: ${over} should throw a RangeError naming ${max}, got ${error}`);
        throwsA(() => Animation[factory](4, 4, {loopCount: over}), RangeError, `${format} encoder with ${over}`);
    }

    // what isn't a loop count is refused by every entry point, with a RangeError for numbers and a TypeError for the rest,
    // and a refused value changes nothing
    const numbers = [-1, -5, NaN, 1.5];
    const others = ['2', null, true];
    for (const value of [...numbers, ...others]) {
        const expected = numbers.includes(value) ? RangeError : TypeError;
        const label = `loop count ${typeof value === 'string' ? JSON.stringify(value) : value}`;

        throwsA(() => new Animation(frames(), {loopCount: value}), expected, `new Animation(frames, { loopCount: ${label} })`);
        const list = frames();
        throwsA(() => new Animation(list, {loopCount: value}), expected, `new Animation with ${label}`);
        if (list.length !== 2) panic(`${label}: the frames given were changed`);

        const animation = new Animation(frames(), {loopCount: 3});
        throwsA(() => { animation.loopCount = value; }, expected, `loopCount = ${label}`);
        if (animation.loopCount !== 3) panic(`${label}: a refused loopCount changed the animation to ${animation.loopCount}`);

        throwsA(() => Animation.gifEncoder(4, 4, {loopCount: value}), expected, `gifEncoder with ${label}`);
        throwsA(() => Animation.apngEncoder(4, 4, {loopCount: value}), expected, `apngEncoder with ${label}`);
        throwsA(() => Animation.webpEncoder(4, 4, {loopCount: value}), expected, `webpEncoder with ${label}`);
    }

    // negative counts are refused, the message names the valid values
    throwsA(() => new Animation(frames(), {loopCount: -1}), RangeError, 'loopCount -1');
    try { new Animation(frames(), {loopCount: -1}); } catch (error) {
        if (!/Infinity/.test(error.message)) panic(`-1: the message should name Infinity, got ${error.message}`);
    }
})().catch(error => panic(error.stack || String(error)));
