const {Image, Animation, Frame} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// an image beyond what a format can store throws a RangeError of one shape, naming the format, the limit and the
// size: `<format>: images can be at most N pixels wide and high, not WxH`
const sizes = (async () => {
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

// the size is checked before any work on the pixels: a pass over a too large image (a gray check, compositing onto
// the background, the conversion for lossless WebP) only to throw took seconds and a copy of the image
sizes.then(async () => {
	const work = () => { throw new Error('the encoder worked on the pixels before checking the size'); };
	// (__bytes__ is only a view of the pixels, not a pass over them)
	for (const name of ['__is_gray__', '__flatRows__', '__flattened__']) {
		const original = Image.prototype[name];
		Image.prototype[name] = work;
		try {
			for (const [encode, size] of [[image => image.encodeJPEG(), [65536, 1]], [image => image.encodeWebP(), [16385, 1]], [image => image.encodeWebP({quality: 80}), [16384, 1]], [image => image.encodeAVIF({threads: 1}), [65537, 1]], [image => image.encodeTGA(), [65536, 1]], [image => image.encodeGIF(), [65536, 1]]]) {
				const image = new Image(...size).fill(0x80808080);
				let error = null;
				try { await encode(image); } catch (err) { error = err; }
				if (!(error instanceof RangeError) || !/images can be at most/.test(error.message)) panic(`${name}, ${size[0]}x${size[1]}: ${error?.message}`);
			}
		} finally {
			Image.prototype[name] = original;
		}
	}
});
