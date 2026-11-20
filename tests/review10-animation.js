const {Animation, Frame, Image, Colors} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const noise = (width, height) => new Image(width, height).fill(() => ((random() * 2 ** 24) << 8 | 255) >>> 0);

(async () => {
	// the streaming WebP encoder makes the same file as encodeWebP, also without optimizing and with frames WebP can't
	// store as they are (disposed to the previous frame, or disposed with odd offsets)
	const cases = {
		previous: [new Frame(noise(10, 10), {duration: 20}), new Frame(noise(4, 4), {xOffset: 3, yOffset: 3, disposalMode: 'previous', duration: 20}), new Frame(noise(4, 4), {xOffset: 2, yOffset: 2, duration: 20})],
		'odd background': [new Frame(noise(4, 4), {xOffset: 1, yOffset: 3, disposalMode: 'background'}), new Frame(noise(3, 3), {xOffset: 5, yOffset: 1})]
	};
	for (const [name, frames] of Object.entries(cases)) for (const quality of [undefined, 80]) {
		const options = {optimize: false, ...(quality ? {quality} : {})};
		const whole = await new Animation(frames, {width: 10, height: 10}).encodeWebP(options);
		const encoder = Animation.webpEncoder(10, 10, options);
		for (const frame of frames) await encoder.add(frame);
		const streamed = await encoder.finish();
		if (!Buffer.from(whole).equals(Buffer.from(streamed))) panic(`${name}, quality ${quality}: encodeWebP made ${whole.length} bytes, webpEncoder ${streamed.length}`);
	}

	// trim's default color is the top left pixel of the canvas as the first frame shows it
	const offset = new Animation([new Frame(new Image(4, 4).fill(0xff0000ff), {xOffset: 2, yOffset: 2})], {width: 8, height: 8});
	offset.trim();
	if (offset.width !== 4 || offset.height !== 4) panic(`trim: ${offset.width}x${offset.height}`);

	// a gradient of 3 or more stops has the colors of its first and last stop before and after them, like one of 2
	const red = 0xff0000ff, clear = 0xff000000, blue = 0x0000ffff;
	const ends = Colors.gradient({0.2: red, 0.5: blue, 0.8: clear});
	if (ends(0) !== red || ends(1) !== clear || ends(0.8) !== clear) panic(`gradient ends: ${ends(0).toString(16)} ${ends(1).toString(16)}`);
	const doubled = Colors.gradient({0.2: red, 0.2001: red, 0.5: blue, 0.8: blue, 0.8001: clear});
	if (doubled(1) !== clear || doubled(0) !== red) panic('gradient ends with close stops');
	// at a hard edge, the later stop's color (like CSS)
	const edge = Colors.gradient({0.2: red, 0.5: blue, 0.5000001: 0x00ff00ff, 1: 0x00ff00ff});
	if (edge(0.5000001) !== 0x00ff00ff) panic('gradient after a hard edge');

	// at a hard edge (two stops at one position) the later stop's color, like CSS: inside, at the ends, with 2 stops
	// and with every stop at one position; at any stop's position its exact color
	const green = 0x00ff00ff;
	const inner = Colors.gradient({0: red, 0.5: blue, '0.5000': green, 1: green});
	if (inner(0.5) !== green) panic(`gradient at an inner hard edge: ${inner(0.5).toString(16)}`);
	const two = Colors.gradient({0.5: red, '0.50': blue});
	if (two(0.5) !== blue || two(0.4) !== red || two(0.6) !== blue) panic(`gradient of 2 stops at one position: ${two(0.5).toString(16)}`);
	const same = Colors.gradient({0.5: red, '0.50': blue, '0.500': green});
	if (same(0.5) !== green || same(0.4) !== red) panic(`gradient of stops at one position: ${same(0.5).toString(16)}`);
	const exact = Colors.gradient({0: red, 0.3: 0x12345678, 1: blue});
	if (exact(0.3) !== 0x12345678) panic(`gradient at a stop: ${exact(0.3).toString(16)}`);

	// many stops don't overflow the call stack
	const stops = {};
	for (let i = 0; i < 200000; i++) stops[i / 200000] = i & 1 ? red : blue;
	const many = Colors.gradient(stops);
	if (many(0) !== blue) panic('a gradient of 200000 stops');
})();
