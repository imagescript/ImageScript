const {Image, Animation, Frame} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// an image beyond what a format can store throws a RangeError of one shape, naming the format, the limit and the
// size: `<format>: images can be at most N pixels wide and high, not WxH`
(async () => {
	const wide = (width, height = 1) => new Image(width, height).fill(0x336699ff);
	const cases = [
		['JPEG', 65535, image => image.encodeJPEG()],
		['WebP', 16383, image => image.encodeWebP({quality: 80})],
		['WebP', 16384, image => image.encodeWebP()],
		['AVIF', 65536, image => image.encodeAVIF({threads: 1})],
		['TGA', 65535, image => image.encodeTGA()],
		['GIF', 65535, image => image.encodeGIF()]
	];
	for (const [format, limit, encode] of cases) {
		for (const [width, height] of [[limit + 1, 1], [1, limit + 1]]) {
			let error = null;
			try { await encode(wide(width, height)); } catch (err) { error = err; }
			const expected = `${format}: images can be at most ${limit} pixels wide and high, not ${width}x${height}`;
			if (!(error instanceof RangeError) || error.message !== expected) panic(`${format} ${width}x${height}: ${error?.constructor?.name}: ${error?.message}, expected '${expected}'`);
		}
		// the limit itself is fine (a 1-pixel wide image: not worth the time of the big ones)
		if (limit <= 16384) await encode(wide(limit));
	}
	// the other limits stay where they were: the formats that take any size
	for (const format of ['encodePNG', 'encodeBMP']) await wide(70000)[format]();
})();
