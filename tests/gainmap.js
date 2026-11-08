const fs = require('fs').promises;
const {Image, GainMap, Colors} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
const close = (a, b, epsilon = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
const same = (a, b) => Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));
// the map's value for a gain (log2), channel 0
const stored = (map, gain) => 255 * Math.min(1, Math.max(0, (gain - map.gainMapMin[0]) / (map.gainMapMax[0] - map.gainMapMin[0]))) ** map.gamma[0];
// the mean of the map's red channel over an area of the image
const meanValue = (image, left, top, right, bottom) => {
	const map = image.gainMap.image, sx = map.width / image.width, sy = map.height / image.height;
	let sum = 0, n = 0;
	for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
		const ix = (x + 0.5) / sx, iy = (y + 0.5) / sy;
		if (ix < left || ix >= right || iy < top || iy >= bottom) continue;
		sum += map.bitmap[4 * (y * map.width + x)];
		n++;
	}
	return sum / n;
};

(async () => {
	const files = {};
	for (const name of ['single-channel', 'multi-channel', 'stripped', 'malformed']) files[name] = await fs.readFile(`./tests/gainmap/${name}.jpg`);

	// reading: the parameters (libultrahdr's), the base the same as without the gain map
	const single = await Image.decode(files['single-channel']), multi = await Image.decode(files['multi-channel']);
	for (const [name, image, channels] of [['single-channel', single, 1], ['multi-channel', multi, 3]]) {
		const map = image.gainMap;
		if (!(map instanceof GainMap)) panic(`${name}: no gain map`);
		if (map.channels !== channels || map.width !== 512 || map.height !== 384) panic(`${name}: ${map.channels} channels, ${map.width}x${map.height}`);
		if (Math.abs(map.gainMapMax[0] - 2.1814) > 1e-3 || Math.abs(map.hdrCapacityMax - 2.3) > 1e-3 || map.hdrCapacityMin !== 0 || map.gamma[0] !== 1 || map.useBaseColorSpace)
			panic(`${name}: parameters ${map.gainMapMax} ${map.hdrCapacityMax} ${map.gamma} ${map.useBaseColorSpace}`);
		if (!same(image, await Image.decode(files[name], {gainMap: false}))) panic(`${name}: the base differs with the gain map`);
	}
	if (single.gainMap.gainMapMin[0] > -0.47 || single.gainMap.gainMapMin[0] < -0.49) panic(`single-channel: gainMapMin ${single.gainMap.gainMapMin[0]}`);
	if ((await Image.decode(files['single-channel'], {gainMap: false})).gainMap !== null) panic('gainMap: false still read the map');

	// a cut off map (the MPF index pointing past the end) and a broken ISO block: no map, the base decodes
	for (const name of ['stripped', 'malformed']) {
		const image = await Image.decode(files[name]);
		if (image.gainMap !== null || image.width !== 512) panic(`${name}: ${image.gainMap ? 'a gain map' : image.width}`);
	}

	// writing: decode -> encode keeps the map (close: encoded anew), the base as without one; gainMap: false leaves it
	// out
	for (const name of ['single-channel', 'multi-channel']) {
		const image = await Image.decode(files[name]);
		const encoded = await image.encodeJPEG(90);
		const plain = await image.encodeJPEG({quality: 90, gainMap: false});
		const back = await Image.decode(encoded);
		if (!back.gainMap || !close(back.gainMap.gainMapMax, image.gainMap.gainMapMax) || !close(back.gainMap.gainMapMin, image.gainMap.gainMapMin) || back.gainMap.hdrCapacityMax !== image.gainMap.hdrCapacityMax)
			panic(`${name}: the written map's parameters differ`);
		{
			let sum = 0;
			const a = back.gainMap.image.bitmap, b = image.gainMap.image.bitmap;
			for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
			if (sum / a.length > 0.5) panic(`${name}: the written map is off by ${sum / a.length}`);
		}
		if (!same(back, await Image.decode(plain))) panic(`${name}: the base differs with the map written`);
		if ((await Image.decode(plain)).gainMap !== null) panic(`${name}: gainMap: false wrote the map`);

		// re-encoded (its pixels used): close; a quarter of the size
		const used = await Image.decode(files[name]);
		void used.gainMap.image;
		const reencoded = await Image.decode(await used.encodeJPEG({quality: 90, gainMap: {quality: 90}}));
		let sum = 0;
		const a = reencoded.gainMap.image.bitmap, b = used.gainMap.image.bitmap;
		for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
		if (sum / a.length > 1 || reencoded.gainMap.channels !== used.gainMap.channels) panic(`${name}: re-encoded map off by ${sum / a.length}`);
		const quarter = await Image.decode(await used.encodeJPEG({gainMap: {scale: 0.25}}));
		if (quarter.gainMap.width !== 128 || quarter.gainMap.height !== 96) panic(`${name}: scaled map ${quarter.gainMap.width}x${quarter.gainMap.height}`);
	}

	// a map alone, without ISO 21496-1 (only hdrgm XMP): read from the XMP
	{
		const alone = Buffer.from(await single.gainMap.encode());
		const iso = alone.indexOf('urn:iso:std:iso:ts:21496:-1');
		const start = iso - 4, length = alone.readUInt16BE(iso - 2);
		const xmpOnly = Buffer.concat([alone.subarray(0, start), alone.subarray(start + 2 + length)]);
		if (xmpOnly.includes('urn:iso:std:iso:ts:21496:-1') || !xmpOnly.includes('hdrgm:GainMapMax')) panic('XMP only map: test file wrong');
		const map = await GainMap.decode(xmpOnly);
		if (!close(map.gainMapMax, single.gainMap.gainMapMax) || !close(map.gainMapMin, single.gainMap.gainMapMin) || Math.abs(map.hdrCapacityMax - single.gainMap.hdrCapacityMax) > 1e-5)
			panic(`XMP only map: ${map.gainMapMin} ${map.gainMapMax} ${map.hdrCapacityMax} vs ${single.gainMap.gainMapMin} ${single.gainMap.gainMapMax}`);
	}

	// made by hand: parameters checked, written and read back; per channel values
	{
		const image = new Image(64, 48).fill(0x808080ff);
		image.gainMap = new GainMap(new Image(16, 12).fill((x, y) => Colors.fromRGBA(x * 16, y * 20, 255 - x * 16, 255)), {gainMapMax: [2, 3, 4], gainMapMin: -1, gamma: 2});
		const back = await Image.decode(await image.encodeJPEG(95));
		const map = back.gainMap;
		if (!map || map.channels !== 3 || !close(map.gainMapMax, [2, 3, 4]) || !close(map.gainMapMin, [-1, -1, -1]) || !close(map.gamma, [2, 2, 2]) || map.hdrCapacityMax !== 4 || map.width !== 16)
			panic(`hand made map: ${map ? [map.channels, map.gainMapMin, map.gainMapMax, map.gamma, map.hdrCapacityMax, map.width] : 'none'}`);
		for (const [options, error] of [[{gamma: 0}, RangeError], [{gainMapMax: -2}, RangeError], [{gainMapMax: [1, 2]}, RangeError], [{gainMapMax: NaN}, RangeError], [{hdrCapacityMin: 3, hdrCapacityMax: 2}, RangeError]])
			try {
				new GainMap(new Image(4, 4), options);
				panic(`GainMap ${JSON.stringify(options)} didn't throw`);
			} catch (e) {
				if (!(e instanceof error)) panic(`GainMap ${JSON.stringify(options)}: ${e}`);
			}
		for (const gainMap of [{scale: 0}, {scale: 2}, {scale: NaN}, {quality: 101}, {quality: -1}])
			if (!await image.encodeJPEG({gainMap}).then(() => false, e => e instanceof RangeError)) panic(`encodeJPEG gainMap ${JSON.stringify(gainMap)} should throw a RangeError`);
		try {
			image.gainMap = {};
			panic('gainMap = {} didn\'t throw');
		} catch (e) {
			if (!(e instanceof TypeError)) panic(`gainMap = {}: ${e}`);
		}
	}

	// geometry moves the map like the image (a full resolution map: exactly)
	{
		const check = (name, op) => {
			const image = multi.clone(), full = multi.gainMap.image.clone();
			op(image);
			op(full);
			if (!same(image.gainMap.image, full)) panic(`${name}: the map didn't follow`);
		};
		check('rotate 90', i => i.rotate(90));
		check('rotate 180', i => i.rotate(180));
		check('flip', i => i.flip('horizontal').flip('vertical'));
		check('crop', i => i.crop(31, 17, 200, 100));
		const quarter = await Image.decode(await multi.encodeJPEG({gainMap: {scale: 0.25}}));
		quarter.crop(100, 40, 200, 160).resize(100, 80);
		if (quarter.gainMap.width !== 25 || quarter.gainMap.height !== 20) panic(`crop + resize: map ${quarter.gainMap.width}x${quarter.gainMap.height}`);
		const region = multi.region(10, 20, 100, 50);
		if (region.gainMap.width !== 100 || multi.gainMap.width !== 512) panic('region: the map');
	}

	// orientation (Exif): the map is turned with the image
	{
		const exif = await fs.readFile('./tests/jpegs/exif-orientation-6.jpg');
		const app1 = exif.indexOf(Buffer.from([0xff, 0xe1]));
		const segment = exif.subarray(app1, app1 + 2 + exif.readUInt16BE(app1 + 2));
		const app0End = 4 + files['multi-channel'].readUInt16BE(4);
		const oriented = Buffer.concat([files['multi-channel'].subarray(0, app0End), segment, files['multi-channel'].subarray(app0End)]);
		const image = await Image.decode(oriented);
		if (image.width !== 384 || !image.gainMap || image.gainMap.width !== 384) panic(`orientation: ${image.width}, map ${image.gainMap?.width}`);
		// (orientation 6: turned clockwise, rotate(270))
		if (!same(image, multi.clone().rotate(270))) panic('orientation: test file wrong');
		if (!same(image.gainMap.image, multi.gainMap.image.clone().rotate(270))) panic('orientation: the map wasn\'t turned like the image');
	}

	// drawing over it: no boost where something without one went, the rest as it was
	{
		const image = single.clone();
		image.composite(new Image(100, 100).fill(0x336699ff), 200, 100);
		const neutral = stored(image.gainMap, 0);
		if (Math.abs(meanValue(image, 204, 104, 296, 196) - neutral) > 1.5) panic(`composite: ${meanValue(image, 204, 104, 296, 196)} under the box, no boost is ${neutral}`);
		// (the range can grow: compared as gains)
		const gainAt = (img, value) => img.gainMap.gainMapMin[0] + (img.gainMap.gainMapMax[0] - img.gainMap.gainMapMin[0]) * (value / 255) ** (1 / img.gainMap.gamma[0]);
		const outside = gainAt(image, meanValue(image, 0, 0, 512, 90)), before = gainAt(single, meanValue(single, 0, 0, 512, 90));
		if (Math.abs(outside - before) > 0.02) panic(`composite: changed outside the box (${outside} vs ${before})`);
		const boxed = single.clone().drawBox(0, 0, 64, 64, 0xffffffff);
		if (Math.abs(meanValue(boxed, 0, 0, 60, 60) - stored(boxed.gainMap, 0)) > 1.5) panic('drawBox: boost left under the box');
		// (an image with a map composited onto one without: the canvas gets one, its own part as the source's)
		const canvas = new Image(600, 500).fill(0x000000ff).composite(single, 40, 60);
		if (!canvas.gainMap || Math.abs(meanValue(canvas, 50, 70, 540, 150) - meanValue(single, 10, 10, 500, 90)) > 6) panic('composite onto a canvas: the map');
	}

	// color changes: none leaves the map as it is
	{
		const image = single.clone().brightness(1).contrast(1);
		if (!same(image.gainMap.image, single.gainMap.image)) panic('brightness(1): the map changed');
		const grey = single.clone().greyscale();
		if (!same(grey.gainMap.image, single.gainMap.image)) panic('greyscale: a single channel map changed');
	}

	// Apple's gain maps (iPhone JPEGs): an MPF image with Apple's XMP, the headroom in that XMP or the primary's Exif
	// maker note; values v boost by 1 + (headroom - 1) * v^1.961, read as the parameters' log2 scale
	{
		const segment = (marker, body) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
		const afterSOI = (jpeg, ...parts) => Buffer.concat([jpeg.subarray(0, 2), ...parts, jpeg.subarray(2)]);
		const appleFile = (headroomXMP, exif) => {
			const ramp = new Image(64, 32).fill(x => ((x * 4) * 0x1010100) | 255);
			const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""'
				+ ' xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/" xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/">'
				+ '<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>'
				+ (headroomXMP ? `<HDRGainMap:HDRGainMapHeadroom>${headroomXMP}</HDRGainMap:HDRGainMapHeadroom>` : '')
				+ '<apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType></rdf:Description></rdf:RDF></x:xmpmeta>';
			return Promise.all([new Image(128, 64).fill(0x808080ff).encodeJPEG(90), ramp.encodeJPEG(100)]).then(([base, map]) => {
				map = afterSOI(Buffer.from(map), segment(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xmp)])));
				// the primary's MPF index (big endian), offsets from its TIFF header
				const mpf = Buffer.alloc(4 + 82);
				mpf.write('MPF\0');
				const t = mpf.subarray(4);
				t.writeUInt32BE(0x4d4d002a, 0); t.writeUInt32BE(8, 4); t.writeUInt16BE(3, 8);
				t.writeUInt16BE(0xb000, 10); t.writeUInt16BE(7, 12); t.writeUInt32BE(4, 14); t.writeUInt32BE(0x30313030, 18);
				t.writeUInt16BE(0xb001, 22); t.writeUInt16BE(4, 24); t.writeUInt32BE(1, 26); t.writeUInt32BE(2, 30);
				t.writeUInt16BE(0xb002, 34); t.writeUInt16BE(7, 36); t.writeUInt32BE(32, 38); t.writeUInt32BE(50, 42);
				const parts = [segment(0xe2, mpf)];
				if (exif) parts.unshift(segment(0xe1, exif));
				const primary = afterSOI(Buffer.from(base), ...parts);
				const tiff = 2 + (exif ? 4 + exif.length : 0) + 4 + 4;
				t.writeUInt32BE(0x030000, 50); t.writeUInt32BE(primary.length, 54);
				t.writeUInt32BE(map.length, 70); t.writeUInt32BE(primary.length - tiff, 74);
				primary.set(t, tiff);
				return Buffer.concat([primary, map]);
			});
		};
		// Exif (big endian): IFD0 -> Exif IFD -> a maker note with tag 33 = 0.5 (2^1.8 headroom, like iOS 15)
		const exif = Buffer.alloc(6 + 8 + 18 + 18 + 14 + 18 + 8);
		exif.write('Exif\0\0');
		const e = exif.subarray(6);
		e.writeUInt32BE(0x4d4d002a, 0); e.writeUInt32BE(8, 4);
		e.writeUInt16BE(1, 8); e.writeUInt16BE(0x8769, 10); e.writeUInt16BE(4, 12); e.writeUInt32BE(1, 14); e.writeUInt32BE(26, 18);
		e.writeUInt16BE(1, 26); e.writeUInt16BE(0x927c, 28); e.writeUInt16BE(7, 30); e.writeUInt32BE(40, 32); e.writeUInt32BE(44, 36);
		const note = e.subarray(44);
		note.write('Apple iOS\0\0\x01MM', 'latin1');
		note.writeUInt16BE(1, 14); note.writeUInt16BE(33, 16); note.writeUInt16BE(10, 18); note.writeUInt32BE(1, 20); note.writeUInt32BE(32, 24);
		note.writeInt32BE(1, 32); note.writeUInt32BE(2, 36);

		for (const [name, file, headroom] of [['XMP headroom', await appleFile('4', null), 4], ['maker note headroom', await appleFile(null, exif), 2 ** 1.8]]) {
			const image = await Image.decode(file);
			const map = image.gainMap;
			if (!map || Math.abs(map.gainMapMax[0] - Math.log2(headroom)) > 1e-4 || map.gainMapMin[0] !== 0 || map.hdrCapacityMax !== map.gainMapMax[0]) panic(`Apple, ${name}: ${map ? map.gainMapMax : 'no map'}`);
			// the ramp's values as Apple applies them
			const px = map.image.bitmap;
			for (let x = 0; x < 64; x += 9) {
				const stored = Math.min(255, x * 4) / 255;
				const want = Math.log2(1 + (headroom - 1) * stored ** 1.961);
				const got = map.gainMapMax[0] * px[4 * x] / 255;
				if (Math.abs(want - got) > 0.03) panic(`Apple, ${name}: value ${x * 4} gives ${got} stops, not ${want}`);
			}
			// written as an Ultra HDR JPEG (ISO 21496-1 and hdrgm), the same boosts
			const back = (await Image.decode(await image.encodeJPEG(90))).gainMap;
			if (!back || !close(back.gainMapMax, map.gainMapMax)) panic(`Apple, ${name}: not written back`);
		}
	}

	// AVIF: the gain map as a tone mapped item (and back), the image without one the same as with gainMap: false
	for (const [name, image] of [['single-channel', single], ['multi-channel', multi]]) {
		const avif = await image.encodeAVIF({quality: 80});
		const back = await Image.decode(avif);
		const map = back.gainMap;
		if (!map || map.channels !== image.gainMap.channels || map.width !== image.gainMap.width || !close(map.gainMapMax, image.gainMap.gainMapMax) || !close(map.gainMapMin, image.gainMap.gainMapMin) || Math.abs(map.hdrCapacityMax - image.gainMap.hdrCapacityMax) > 1e-6)
			panic(`AVIF ${name}: ${map ? `${map.channels} channels, ${map.width}, ${map.gainMapMax}` : 'no gain map'}`);
		let sum = 0;
		const a = map.image.bitmap, b = image.gainMap.image.bitmap;
		for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
		if (sum / (a.length / 4) > 1.5) panic(`AVIF ${name}: map off by ${sum / (a.length / 4)}`);
		const plain = await image.encodeAVIF({quality: 80, gainMap: false});
		if ((await Image.decode(plain)).gainMap !== null || !same(back, await Image.decode(plain))) panic(`AVIF ${name}: the base differs with the map, or gainMap: false wrote it`);
		if ((await Image.decode(avif, {gainMap: false})).gainMap !== null) panic(`AVIF ${name}: gainMap: false still read the map`);
		const scaled = await Image.decode(await image.encodeAVIF({quality: 80, gainMap: {scale: 0.25, quality: 60}}));
		if (scaled.gainMap.width !== 128 || scaled.gainMap.height !== 96) panic(`AVIF ${name}: scaled map ${scaled.gainMap.width}x${scaled.gainMap.height}`);
	}

	// JPEG XL: the gain map in a jhgm box (lossy and lossless), the image as without one
	for (const [name, image] of [['single-channel', single], ['multi-channel', multi]]) {
		for (const options of [{quality: 80}, {}]) {
			const jxl = await image.encodeJXL(options);
			const back = await Image.decode(jxl);
			const map = back.gainMap;
			if (!map || map.channels !== image.gainMap.channels || map.width !== image.gainMap.width || !close(map.gainMapMax, image.gainMap.gainMapMax) || !close(map.gainMapMin, image.gainMap.gainMapMin) || Math.abs(map.hdrCapacityMax - image.gainMap.hdrCapacityMax) > 1e-6)
				panic(`JXL ${name} ${JSON.stringify(options)}: ${map ? `${map.channels} channels, ${map.width}, ${map.gainMapMax}` : 'no gain map'}`);
			let sum = 0;
			const a = map.image.bitmap, b = image.gainMap.image.bitmap;
			for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
			if (sum / (a.length / 4) > 1) panic(`JXL ${name}: map off by ${sum / (a.length / 4)}`);
			const plain = await image.encodeJXL({...options, gainMap: false});
			if ((await Image.decode(plain)).gainMap !== null || !same(back, await Image.decode(plain))) panic(`JXL ${name}: the base differs with the map, or gainMap: false wrote it`);
			if ((await Image.decode(jxl, {gainMap: false})).gainMap !== null) panic(`JXL ${name}: gainMap: false still read the map`);
		}
		const lossless = await Image.decode(await image.encodeJXL({gainMap: {quality: 100}}));
		if (!same(lossless.gainMap.image, image.gainMap.image)) panic(`JXL ${name}: a lossless map changed`);
	}

	// invalid arguments throw before the image or its map changes
	for (const [name, call] of [['blur', i => i.blur('5')], ['fill', i => i.fill('red')], ['cover', i => i.cover(-1, 10)]]) {
		const image = single.clone();
		let threw = false;
		try { call(image); } catch { threw = true; }
		if (!threw) panic(`${name}: no error`);
		if (image.width !== single.width || !same(image, single) || !same(image.gainMap.image, single.gainMap.image)) panic(`${name}: changed before throwing`);
	}

	// color changes on values with SDR white as 1: where the map doesn't darken, the HDR rendition stays at least as
	// bright as the SDR image (no gains below 0 appear), the highlights stretch along; the inverts leave no boost
	{
		const gainsOf = map => {
			const px = map.image.bitmap, out = [];
			for (let i = 0; i < px.length; i += 4) out.push(map.gainMapMin[0] + (map.gainMapMax[0] - map.gainMapMin[0]) * (px[i] / 255) ** (1 / map.gamma[0]));
			return out;
		};
		const bright = new Image(64, 64).fill((x, y) => ((y * 4) * 0x1010100 | 255) >>> 0);
		bright.gainMap = new GainMap(new Image(64, 64).fill(x => ((x * 4) * 0x1010100 | 255) >>> 0), {gainMapMin: 0, gainMapMax: 2, offsetSDR: 0, offsetHDR: 0});
		for (const [name, edit] of [['contrast 1.4', i => i.contrast(1.4)], ['contrast 0.6', i => i.contrast(0.6)], ['brightness 1.3', i => i.brightness(1.3)], ['gamma 1.5', i => i.gamma(1.5)], ['lightness 1.2', i => i.lightness(1.2)]]) {
			const out = edit(bright.clone());
			const lowest = Math.min(...gainsOf(out.gainMap));
			if (lowest < -0.05) panic(`${name}: the HDR rendition got darker than SDR (gain ${lowest})`);
		}
		if (!(Math.max(...bright.clone().contrast(1.4).gainMap.gainMapMax) > 2)) panic('contrast 1.4: the highlights didn\'t stretch');
		const inverted = bright.clone().invert().gainMap;
		if (gainsOf(inverted).some(g => Math.abs(g) > 0.02)) panic('invert: the map still boosts');
	}

	// other formats don't carry it, removing works
	const removed = single.clone();
	removed.gainMap = null;
	if ((await Image.decode(await removed.encodeJPEG())).gainMap !== null) panic('removed map still written');
	if ((await Image.decode(await single.encodePNG())).gainMap !== null) panic('PNG with a gain map');
})();
