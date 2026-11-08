const {Image, Frame} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

const size = image => `${image.width}x${image.height}`;

(async () => {
    // transparent borders (like around rendered text), whatever the transparent pixels' RGB values
    {
        const image = new Image(10, 8);
        image.setPixelAt(1, 1, 0xffffff00); // transparent white
        image.composite(new Image(4, 2).fill(0xff0000ff), {x: 3, y: 4});
        image.setPixelAt(9, 2, 0x00ff00ff);
        image.trim();
        if (size(image) !== '7x4') panic(`trim: ${size(image)} instead of 7x4`);
        if (image.getPixelAt(0, 2) !== 0xff0000ff || image.getPixelAt(6, 0) !== 0x00ff00ff) panic('trim: pixels moved wrongly');
    }

    // the top left pixel's color by default, or a given one
    {
        const make = () => new Image(6, 6).fill(0xffffffff).composite(new Image(2, 3).fill(0x000000ff), {x: 3, y: 2});
        if (size(make().trim()) !== '2x3') panic('trim: solid background not trimmed');
        if (size(make().trim({color: 0x000000ff})) !== '6x6') panic('trim: explicit color should only trim that color');
        const marked = make().setPixelAt(1, 1, 0xff0000ff);
        if (size(marked.trim({color: 0xffffffff})) !== '4x4') panic(`trim: explicit color: ${size(marked)}`);
    }

    // tolerance, e.g. for JPEG artifacts
    {
        const make = () => new Image(5, 5).fill(0xffffffff).setPixelAt(1, 0, 0xf8f8f8ff).setPixelAt(3, 3, 0x000000ff);
        if (size(make().trim()) !== '3x4') panic('trim: without tolerance, near colors stay');
        if (size(make().trim({tolerance: 0.05})) !== '1x1') panic('trim: tolerance has no effect');
        for (const tolerance of [-0.1, 1.5, NaN])
            if (!(() => { try { make().trim({tolerance}); } catch { return true; } })()) panic(`trim: tolerance ${tolerance} accepted`);
    }

    // an image of only the color stays unchanged
    if (size(new Image(4, 3).fill(0x123456ff).trim()) !== '4x3') panic('trim: uniform image changed');

    // frames keep their position
    {
        const frame = new Frame(new Image(10, 10), {duration: 100, xOffset: 5, yOffset: 7});
        frame.image.composite(new Image(4, 4).fill(0xffffffff), {x: 2, y: 3});
        frame.trim();
        if (size(frame) !== '4x4' || frame.xOffset !== 7 || frame.yOffset !== 10) panic(`trim: frame ${size(frame)} at ${frame.xOffset},${frame.yOffset}`);
    }
})();
