const {Image, GainMap} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
const map = new Image(4, 4).fill(0x808080ff);
const LIMIT = 2 ** 31 - 1;

// the parameters are limited to what the ISO 21496-1 fractions of JPEG, AVIF and JPEG XL hold: beyond them they were
// written wrapped (an offset of 1e12 came back as -727379968), or as 0, and decoders dropped the map
(async () => {
	for (const options of [{min: -LIMIT - 1}, {max: LIMIT + 1, hdrCapacityMax: 2}, {max: 1e12, hdrCapacityMax: 2}, {offsetSDR: 1e12}, {offsetHDR: -LIMIT - 1}, {hdrCapacityMax: LIMIT + 1}, {hdrCapacityMin: LIMIT + 1, hdrCapacityMax: LIMIT + 2}, {gamma: 1e-10}, {gamma: LIMIT + 1}]) {
		let error = null;
		try { new GainMap(map, options); } catch (err) { error = err; }
		if (!(error instanceof RangeError) || !/must be/.test(error.message)) panic(`new GainMap(${JSON.stringify(options)}) should throw a RangeError, got ${error}`);
		const gainMap = new GainMap(map);
		const [name] = Object.keys(options);
		const before = JSON.stringify(gainMap[name]);
		try { gainMap[name] = options[name]; } catch {}
		if (JSON.stringify(gainMap[name]) !== before) panic(`gainMap.${name} = ${options[name]} should keep the old value`);
	}
	// the edges are written and read back exactly
	const base = new Image(8, 8).fill(0x808080ff);
	for (const options of [{min: -LIMIT, max: LIMIT, hdrCapacityMax: 2}, {offsetSDR: LIMIT, offsetHDR: -LIMIT}, {hdrCapacityMax: LIMIT}, {gamma: 2 ** -31}, {gamma: LIMIT}]) {
		for (const format of ['encodeJPEG', 'encodeAVIF', 'encodeJXL']) {
			const image = base.clone();
			image.gainMap = new GainMap(map, options);
			const back = (await Image.decode(await image[format]({threads: 1}))).gainMap;
			if (!back) panic(`${format} with ${JSON.stringify(options)} lost the gain map`);
			for (const [name, value] of Object.entries(options)) {
				const got = typeof back[name] === 'number' ? back[name] : back[name][0];
				if (got !== value) panic(`${format} with ${JSON.stringify(options)} read ${name} back as ${got}`);
			}
		}
	}
})();
