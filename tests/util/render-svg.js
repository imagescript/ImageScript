// renders the SVG in the file given and prints the result and the peak memory as JSON (run by tests/svg-arcs.js)
const fs = require('fs');
const {Image} = require('../..');

(async () => {
    const svg = fs.readFileSync(process.argv[2], 'utf8');
    let result = 'ok';
    try {
        await Image.renderSVG(svg, {width: 50});
    } catch (err) {
        result = `${err.constructor.name}: ${err.message}`;
    }
    console.log(JSON.stringify({result, mb: Math.round(process.memoryUsage().rss / 2 ** 20)}));
})();
