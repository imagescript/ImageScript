const {Image} = require('..');
const fs = require('fs');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// text with 200,000 combining marks or lines is laid out like any other: the arrays of its parts are not spread into a
// call (past the stack's limit), and a failure doesn't blame the font
(async () => {
	const font = fs.readFileSync(__dirname + '/fonts/resvg/NotoSans-Regular.ttf');
	for (const [name, text, options] of [
		['combining marks', 'a' + '\u0301'.repeat(200000), {}],
		['lines', 'a '.repeat(200000), {width: 1}],
	]) {
		const result = await Image.renderText(text, {font, size: 1, maxPixels: 1e8, ...options}).then(() => 'ok', err => err);
		if (result !== 'ok' && !(result instanceof RangeError && !/damaged/.test(result.message))) panic(`${name}: ${result}`);
		if (/damaged/.test(String(result.message))) panic(`${name}: blames the font: ${result.message}`);
	}
})();
