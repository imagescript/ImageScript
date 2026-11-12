const {Image, Frame, Animation, Colors} = require('..');
const panic = msg => {
    console.error(msg);
    process.exit(1);
}

try {
    new Image(0, 1);
    panic('width 0 failed');
} catch {
}

try {
    new Image(1, 0);
    panic('height 0 failed');
} catch {
}

if (new Image(1, 1).toString() !== 'Image<1x1>')
    panic('toString failed');

for (const [x, y] of new Image(1, 1).pixels())
    if (x !== 0 || y !== 0) panic('pixels failed');

for (const [x, y, color] of new Image(1, 1).fill(0xff8000ff).pixels())
    if (x !== 0 || y !== 0 || color !== 0xff8000ff) panic('pixels failed');

if (Colors.fromRGB(0xff, 0x80, 0x00) !== 0xff8000ff)
    panic('rgbToColor failed');

if (Colors.fromHSLA(0, 0, 1, 0xff) !== 0xffffffff)
    panic('hslaToColor for s=0 failed');

{
    for (const rgba of [0xff0000ff, 0x00ff00ff, 0x0000ffff, 0x000000ff, 0xffffffff].map(x => Colors.toRGBA(x))) {
        const hsla = Colors.toHSLA(Colors.fromRGBA(...rgba));
        const rgbaBacktransform = Colors.toRGBA(Colors.fromHSLA(...hsla));
        for (let i = 0; i < 4; i++)
            if (rgba[i] !== rgbaBacktransform[i])
                panic('Colors.toHSLA failed');
    }
}

{
    const rgb = Colors.toRGB(0xff8000ff);
    const target = [0xff, 0x80, 0x00];
    for (let i = 0; i < 3; i++)
        if (rgb[i] !== target[i])
            panic('colorToRGB failed');
}

{
    const image = new Image(1, 1);
    image.setPixelAt(0, 0, 0xff8000ff);

    const pixel = image.getPixelAt(0, 0);
    if (pixel !== 0xff8000ff) panic('getPixelAt fails');

    const rgba = Colors.toRGBA(image.getPixelAt(0, 0));
    const target = [0xff, 0x80, 0x00, 0xff];
    for (let i = 0; i < 4; i++)
        if (rgba[i] !== target[i])
            panic('Colors.toRGBA failed');
}

{
    const image = new Image(1, 1);
    try {
        image.__check_boundaries__('a', 1);
        panic('check boundaries for x as NaN failed');
    } catch {
    }
    try {
        image.__check_boundaries__(1, 'a');
        panic('check boundaries for y as NaN failed');
    } catch {
    }
    try {
        image.__check_boundaries__(0, 1);
        panic('check boundaries for x as 0 failed');
    } catch {
    }
    try {
        image.__check_boundaries__(1, 0);
        panic('check boundaries for y as 0 failed');
    } catch {
    }
    try {
        image.__check_boundaries__(2, 1);
        panic('check boundaries for x as 2 failed');
    } catch {
    }
    try {
        image.__check_boundaries__(1, 2);
        panic('check boundaries for y as 2 failed');
    } catch {
    }
}

{
    const image = new Image(1, 1);
    image.fill(0xff8000ff);

    const clone = image.clone();

    if (!Buffer.from(clone.bitmap).equals(Buffer.from(image.bitmap)))
        panic('clone failed');
}

{
    const image = new Image(2, 2);
    image.scale(.5);
    if (image.width !== 1 || image.height !== 1)
        panic('resize failed');

    image.scale(1);
    if (image.width !== 1 || image.height !== 1)
        panic('resize failed');

    try {
        image.resize(0, 1);
        panic('resize for x = 0 failed');
    } catch {
    }
    try {
        image.resize(1, 0);
        panic('resize for y = 0 failed');
    } catch {
    }
    try {
        image.resize(1, 1, {mode: 'garbage'});
        panic('resize with invalid mode failed');
    } catch {
    }
}


{
    const image = new Image(1, 1);
    const toFail = ['a', -1];
    const funcs = [image.red, image.green, image.blue, image.opacity, image.lightness, image.saturation];
    for (const func of funcs)
        for (const value of toFail)
            try {
                func.call(image, toFail);
                panic(`${func.name} failed with value ${JSON.stringify(value)}`);
            } catch {
            }
}

{
    const image = new Image(512, 256);
    const overlay = new Image(1024, 512);
    image.composite(overlay, {x: -512, y: -256});
    overlay.fill(0x80);
    image.composite(overlay, {x: -512, y: -256});
    overlay.fill(0xff);
    image.composite(overlay, {x: -512, y: -256});
}

try {
    new Frame(new Image(1, 1), {duration: -1});
    panic('frame duration failed');
} catch {
}

if (new Frame(new Image(1, 2), {duration: 3}).toString() !== 'Frame<1x2x3ms>') panic('frame toString failed');

{
    const image = new Image(512, 512);
    new Frame(image.clone(), {duration: 10});
    try {
        new Frame({}, {duration: 10});
        panic('frame instanceof image failed');
    } catch {
    }
}

try {
    new Animation([{}]);
    panic('animation frame instanceof failed');
} catch {
}

{
    const frame = new Frame(new Image(512, 128), {duration: 123});
    const animation = new Animation([frame]);
    if (animation.toString() !== 'Animation<512x128x123ms>') panic('animation tostring failed');
    if (animation.duration !== 123) panic('animation duration failed');
}
