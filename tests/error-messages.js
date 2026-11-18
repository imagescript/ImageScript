const fs = require('fs');
const {Image, Frame, Animation, Colors} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// A value outside of what an argument takes throws a RangeError that says which argument, what it takes, and which
// value it got: `<name> must be <what it takes>, not <value>` (or `<name> takes <what>, not <value>`). Only that shape is
// checked here, the wording of each message is free
const shape = /^[\w() ]+ (must be|takes) .+, not .+$/;

(async () => {
    const font = fs.readFileSync('./tests/fonts/carbon phyber.ttf');
    const image = () => new Image(8, 8).fill(0x336699ff);
    const gradient = options => () => Image.radialGradient(8, 8, {stops: [0xff0000ff, 0x0000ffff], ...options});

    const cases = {
        'frame.duration': () => { new Frame(image()).duration = -1; },
        'frame.duration NaN': () => { new Frame(image()).duration = NaN; },
        'animation.scale(0)': () => new Animation([new Frame(image())]).scale(0),
        'animation canvas size': () => new Animation([], {width: 1.5, height: 2}),
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
        'feature value': () => Image.renderText('A', {font, size: 20, features: {abcd: 300}})
    };

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
    if (failures.length) panic(failures.join('\n'));
})();
