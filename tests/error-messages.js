const fs = require('fs');
const {Image, Frame, Animation, Colors, GainMap, LimitError} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// A value outside of what an argument takes throws a RangeError that says which argument, what it takes, and which
// value it got: `<name> must be <what it takes>, not <value>` (or `<name> must have <count>, not <count>`, or `<name>
// takes <what>, not <value>`). Only that shape is checked here, the wording of each message is free
const shape = /^[\w() ]+ (must be|must have|takes) .+, not .+$/;

(async () => {
    const font = fs.readFileSync('./tests/fonts/carbon phyber.ttf');
    const image = () => new Image(8, 8).fill(0x336699ff);
    const gradient = options => () => Image.radialGradient(8, 8, {stops: [0xff0000ff, 0x0000ffff], ...options});

    const cases = {
        'frame.duration': () => { new Frame(image()).duration = -1; },
        'frame.duration NaN': () => { new Frame(image()).duration = NaN; },
        'animation.scale(0)': () => new Animation([new Frame(image())]).scale(0),
        'animation canvas size': () => new Animation([], {width: 0.5, height: 2}),
        'opacity': () => image().opacity(-1),
        'red': () => image().red(-1),
        'green': () => image().green(-1),
        'blue': () => image().blue(-1),
        'lightness': () => image().lightness(-1),
        'saturation': () => image().saturation(-1),
        'brightness': () => image().brightness(-1),
        'contrast': () => image().contrast(-1),
        'gamma': () => image().gamma(0),
        'blur': () => image().dropShadow({blur: -1}),
        'spread': () => image().dropShadow({spread: -1}),
        'outline': () => image().outline({width: -1}),
        'trim': () => image().trim({tolerance: 2}),
        'colorToAlpha': () => image().colorToAlpha({transparencyThreshold: 1, opacityThreshold: 0.5}),
        'radialGradient radius': gradient({radius: 0}),
        'radialGradient x NaN': gradient({x: NaN}),
        'gradient without colors': () => Colors.gradient([]),
        'gradient position NaN': () => Colors.gradient([0xff0000ff, 0x0000ffff])(NaN),
        'creationTime': () => image().encodePNG({metadata: {creationTime: 'no date'}}),
        'SVG scale': () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {scale: 0}),
        'SVG width': () => Image.renderSVG('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', {width: 0}),
        'stroke width': () => Image.renderText('A', {font, size: 20, strokeWidth: -1}),
        'feature tag': () => Image.renderText('A', {font, size: 20, features: {ab: true}}),
        'new Image width': () => new Image(0, 1),
        'new Image height': () => new Image(1, 0.5),
        'new Image too large': () => new Image(2 ** 31, 1),
        'resize width': () => image().resize(0, 1),
        'resize contain': () => image().resize({width: 0, height: 4, fit: 'contain'}),
        'resize cover': () => image().resize({width: 4, height: 0, fit: 'cover'}),
        'scale 0': () => image().scale(0),
        'crop outside': () => image().crop(20, 20, 4, 4),
        'getPixelAt x': () => image().getPixelAt(8, 0),
        'getPixelAt y': () => image().getPixelAt(0, -1),
        'setPixelAt': () => image().setPixelAt(0, 8, 0xff),
        'color': () => image().setPixelAt(0, 0, 1.5),
        'fill color': () => image().fill(2 ** 32),
        'animation width': () => new Animation([], {width: 0, height: 1}),
        'animation resize': () => new Animation([new Frame(image())]).resize({width: 0}),
        'animation crop': () => new Animation([new Frame(image())]).crop(20, 20, 4, 4),
        'palette size': () => image().quantize({palette: []}),
        'color matrix size': () => image().colorMatrix([1]),
        'transform size': () => image().transform([1]),
        'dominantColor threshold': () => image().dominantColor({threshold: 300}),
        'feature value': () => Image.renderText('A', {font, size: 20, features: {abcd: 300}}),
        'hdrCapacityMin': () => new GainMap(new Image(2, 2), {hdrCapacityMin: -1}),
        'bitmap length': () => { image().bitmap = new Uint8Array(4); },
        'text width': () => Image.renderText('A', {font, size: 20, width: 0.5})
    };
    // a value of the wrong type throws a TypeError that names the argument and shows the value
    const typeCases = {
        'new GainMap(5)': () => new GainMap(5),
        'gainMap.image': () => { new GainMap(new Image(2, 2)).image = 5; },
        'frame.image': () => { new Frame(image()).image = 5; },
        'animation frames': () => new Animation([5]),
        'encoder.add': () => Animation.gifEncoder(4, 4).add(5),
        'bitmap type': () => { image().bitmap = [1, 2, 3, 4]; },
        'renderText without a font': () => Image.renderText('A', {font: [], size: 20})
    };
    const typeShape = /^[\w()[\]. ]+ must be .+, not .+$/;

    const failures = [];
    for (const [name, fn] of Object.entries(cases)) {
        try {
            await fn();
            failures.push(`${name}: accepted`);
        } catch (error) {
            if (!(error instanceof RangeError)) failures.push(`${name}: ${error?.constructor?.name}: ${error?.message}, not a RangeError`);
            else if (!shape.test(error.message)) failures.push(`${name}: the message doesn't say which argument, what it takes and what it got: ${error.message}`);
        }
    }
    for (const [name, fn] of Object.entries(typeCases)) {
        try {
            await fn();
            failures.push(`${name}: accepted`);
        } catch (error) {
            if (!(error instanceof TypeError)) failures.push(`${name}: ${error?.constructor?.name}: ${error?.message}, not a TypeError`);
            else if (!typeShape.test(error.message)) failures.push(`${name}: the message doesn't say which argument, what it takes and what it got: ${error.message}`);
        }
    }
    // the message names the argument that is wrong: the scale factor, not the width it would give; the stops of a
    // gradient before an image of its size is allocated
    for (const [name, fn, start] of [
        ['image.scale(2 ** 31)', () => image().scale(2 ** 31), 'scale factor'],
        ['animation.scale(2 ** 31)', () => new Animation([new Frame(image())]).scale(2 ** 31), 'scale factor'],
        ['radialGradient without stops', () => Image.radialGradient(1e6, 1e6, {stops: []}), 'gradient()']
    ]) {
        try {
            fn();
            failures.push(`${name}: accepted`);
        } catch (error) {
            if (!(error instanceof RangeError) || !error.message.startsWith(start)) failures.push(`${name}: ${error.message}, expected a RangeError about the ${start}`);
        }
    }
    // a gain map's JPEG takes the qualities of Image.encodeJPEG() (0 is 1)
    for (const encode of [() => new GainMap(new Image(4, 4)).encodeJPEG({quality: 0}), () => { const i = image(); i.gainMap = new GainMap(new Image(4, 4)); return i.encodeJPEG({gainMap: {quality: 0}}); }]) {
        try {
            await encode();
        } catch (error) {
            failures.push(`gain map quality 0: ${error.message}, Image.encodeJPEG() takes 0`);
        }
    }
    // limits of what an image can become are LimitErrors, like the ones of dropShadow() and outline()
    try {
        image().transform([1e5, 0, 0, 1e5, 0, 0]);
    } catch (error) {
        if (!(error instanceof LimitError)) failures.push(`transform past the limit: ${error.constructor.name}, not a LimitError`);
    }
    if (failures.length) panic(failures.join('\n'));
})();
