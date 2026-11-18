// Renders text with the font in the file given as the first argument, directly (`text`), through an SVG's @font-face
// (`svg`, which is how an untrusted font reaches the parser) or through renderSVG's `font` option (`option`), and prints
// `ok` when that rendered or ended with a plain Error, or what it ended with otherwise. A font that renderText refuses
// has to be refused in the `font` option too: a font given there isn't left out without a word, like one of an SVG (a LimitError is no answer to a damaged font: its size isn't damaged data). Run by tests/damaged-fonts.js in a process of its own, because
// a hang or a V8 abort can't be caught inside the process that has to report it
const fs = require('fs');

(async () => {
    const {Image} = await import('../../dist/index.js');
    const [file, via] = process.argv.slice(2);
    const font = fs.readFileSync(file);
    // (U+E000 is the bitmap glyph of tests/fonts/sbix.ttf)
    const text = 'Hello ffi مرحبا 🙂 \u{1F600}\uFE0F 葛\u{E0100} \uE000';
    try {
        if (via === 'option') {
            let refused = false;
            try {
                await Image.renderText(text, {font, size: 40});
            } catch {
                refused = true;
            }
            await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text x="0" y="40" font-size="30">${text}</text></svg>`, {font});
            if (refused) return console.log('renderSVG used a font in its font option that renderText refuses');
        } else if (via === 'svg') {
            await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><style>@font-face{font-family:X;src:url(data:font/ttf;base64,${Buffer.from(font).toString('base64')})}</style><text x="0" y="40" font-family="X" font-size="30">${text}</text></svg>`);
        } else {
            await Image.renderText(text, {font, size: 40});
        }
        console.log('ok');
    } catch (error) {
        console.log(error.constructor === Error ? 'ok' : `${error.name}: ${error.message}`);
    }
})();
