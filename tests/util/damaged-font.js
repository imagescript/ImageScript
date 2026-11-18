// Renders text with the font in the file given as the first argument, directly (`text`) or through an SVG's @font-face
// (`svg`, which is how an untrusted font reaches the parser), and prints `ok` when that rendered or ended with a plain
// Error, or what it ended with otherwise (a LimitError is no answer to a damaged font: its size isn't damaged data). Run by tests/damaged-fonts.js in a process of its own, because
// a hang or a V8 abort can't be caught inside the process that has to report it
const fs = require('fs');

(async () => {
    const {Image} = await import('../../dist/index.js');
    const [file, via] = process.argv.slice(2);
    const font = fs.readFileSync(file);
    const text = 'Hello ffi مرحبا 🙂 \u{1F600}\uFE0F 葛\u{E0100}';
    try {
        if (via === 'svg') {
            await Image.renderSVG(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><style>@font-face{font-family:X;src:url(data:font/ttf;base64,${Buffer.from(font).toString('base64')})}</style><text x="0" y="40" font-family="X" font-size="30">${text}</text></svg>`);
        } else {
            await Image.renderText(text, {font, size: 40});
        }
        console.log('ok');
    } catch (error) {
        console.log(error.constructor === Error ? 'ok' : `${error.name}: ${error.message}`);
    }
})();
