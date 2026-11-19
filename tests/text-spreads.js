const {Image, LimitError} = require('..');
const fs = require('fs');

// (Bun's JavaScriptCore runs the layout several times slower than V8)
const slack = process.versions.bun ? 4 : 1;

const panic = message => {
	console.error(message);
	process.exit(1);
};

// text with 200,000 combining marks or lines is laid out like any other: the arrays of its parts are not spread into a
// call (past the stack's limit), and a failure doesn't blame the font
(async () => {
	const font = fs.readFileSync(__dirname + '/fonts/resvg/NotoSans-Regular.ttf');
	// a bitmap emoji that says it is 16383x16383 isn't decoded (it was allocated, 1 GB)
	const emoji = fs.readFileSync(__dirname + '/fonts/emoji-4096.ttf'), at = emoji.indexOf('IHDR');
	emoji.writeUInt32BE(16383, at + 4);
	emoji.writeUInt32BE(16383, at + 8);
	let crc = ~0;
	for (const byte of emoji.subarray(at, at + 17)) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
	}
	emoji.writeUInt32BE(~crc >>> 0, at + 17);
	const before = process.memoryUsage().rss;
	await Image.renderText('\u{1F600}', {font: emoji, size: 8});
	if (process.memoryUsage().rss - before > 512 * 2 ** 20) panic(`a huge emoji: took ${(process.memoryUsage().rss - before) >> 20} MB`);
	for (const [name, text, options] of [
		['combining marks', 'a' + '\u0301'.repeat(200000), {}],
		['lines', 'a '.repeat(200000), {width: 1}],
		['marks between letters', 'a\u0301'.repeat(200000), {}],
	]) {
		// (and in linear time: 400,000 lines took minutes)
		const begin = Date.now();
		const result = await Image.renderText(text, {font, size: 1, maxPixels: 1e8, ...options}).then(() => 'ok', err => err);
		if (result !== 'ok' && !(result instanceof LimitError)) panic(`${name}: ${result}`);
		if (Date.now() - begin > 15000 * slack) panic(`${name}: took ${Date.now() - begin} ms`);
	}
})();
