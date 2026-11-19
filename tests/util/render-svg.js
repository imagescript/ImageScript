// Renders the SVG given as the first argument (a file) and prints `ok`, the class and message of the error it ended
// with, and the peak memory in MB. Run by tests/svg-arcs.js in a process of its own: a fatal out-of-memory can't be
// caught inside the process that has to report it
const fs = require('fs');

(async () => {
    const {Image} = await import('../../dist/index.js');
    const svg = fs.readFileSync(process.argv[2], 'utf8');
    let result = 'ok';
    try {
        await Image.renderSVG(svg, {...(/width="10"/.test(svg) ? {maxPixels: 100} : {width: 50}), font: fs.readFileSync(svg.includes('font-family="carbon"') ? './tests/fonts/carbon phyber.ttf' : './tests/fonts/resvg/NotoSans-Regular.ttf')});
    } catch (error) {
        result = `${error.name}: ${error.message}`;
    }
    console.log(JSON.stringify({result, mb: Math.round(process.memoryUsage().rss / 2 ** 20)}));
})();
