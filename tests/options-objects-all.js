const {Image, Frame, Animation, GainMap} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// the options of every method that takes them must be an object (or left out): a stray number, string or boolean is a
// call in a form that doesn't exist (the 3.x positional forms, or a typo), so it throws instead of being ignored
(async () => {
	const photo = new Image(16, 10).fill((x, y) => 0x336699ff + x * 0x01000000 + y * 0x00010000 >>> 0);
	const frame = Frame.from(photo);
	const gainMap = new GainMap(new Image(4, 3).fill(0x808080ff), {max: 2});
	const calls = {
		'quantize': bad => photo.clone().quantize(bad),
		'transform': bad => photo.clone().transform([1, 0, 0, 1, 0, 0], bad),
		'dropShadow': bad => photo.clone().dropShadow(bad),
		'outline': bad => photo.clone().outline(bad),
		'Image.linearGradient': bad => Image.linearGradient(8, 8, bad),
		'Image.radialGradient': bad => Image.radialGradient(8, 8, bad),
		'Image.decode': async bad => Image.decode(await photo.encodePNG(), bad),
		'encodeWebP': bad => photo.encodeWebP(bad),
		'encodeAVIF': bad => photo.encodeAVIF(bad),
		'encodeJXL': bad => photo.encodeJXL(bad),
		'encodeTGA': bad => photo.encodeTGA(bad),
		'Animation.encodeWebP': bad => new Animation([frame]).encodeWebP(bad),
		'Animation.webpEncoder': bad => Animation.webpEncoder(8, 8, bad),
		'Animation.gifEncoder': bad => Animation.gifEncoder(8, 8, bad),
		'Animation.apngEncoder': bad => Animation.apngEncoder(8, 8, bad),
		'AnimationEncoder.add': async bad => { const encoder = Animation.gifEncoder(16, 10); await encoder.add(photo, bad); },
		'new GainMap': bad => new GainMap(new Image(2, 2), bad),
		'renderText layout': bad => Image.renderText('a', {font: new Uint8Array(0), size: 12, layout: bad})
	};
	for (const [name, call] of Object.entries(calls)) {
		for (const [label, bad] of Object.entries({'a number': 80, 'a string': 'fast', 'true': true, 'null': null})) {
			let error = null;
			try { await call(bad); } catch (e) { error = e; }
			if (!(error instanceof TypeError)) panic(`${name}(${label}): should throw a TypeError, got ${error}`);
			if (!/takes an options object/.test(error.message)) panic(`${name}(${label}): the message should name the options form, got ${error.message}`);
		}
	}

	// in place: nothing changes when the call is refused
	const image = photo.clone();
	for (const call of [() => image.quantize(16), () => image.dropShadow(8), () => image.outline(2), () => image.transform([1, 0, 0, 1, 0, 0], 'bicubic')]) {
		try { call(); } catch { /* refused */ }
	}
	if (image.width !== 16 || image.height !== 10 || !Buffer.from(image.bitmap).equals(Buffer.from(photo.bitmap))) panic('a refused call should leave the image as it was');

	// the options forms (and no options at all) still work
	photo.clone().quantize().quantize({colors: 4});
	photo.clone().dropShadow().outline({width: 1});
	if ((await photo.encodeWebP({quality: 50})).length < 10 || (await photo.encodeWebP()).length < 10) panic('encodeWebP with and without options');
	if (gainMap.width !== 4) panic('GainMap options');
})().catch(error => panic(error.stack || String(error)));
