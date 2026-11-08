const fs = require('fs').promises;
const {Image} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
const throwsA = async (fn, type, label) => {
	let error = null;
	try { await fn(); } catch (e) { error = e; }
	if (!(error instanceof type)) panic(`${label}: should throw a ${type.name}, got ${error}`);
	return error;
};

(async () => {
	const font = await fs.readFile('./tests/fonts/opensans bold.ttf');
	const photo = new Image(20, 12).fill((x, y) => 0x336699ff + x * 0x01000000 + y * 0x00010000 >>> 0);

	// methods that only take options refuse anything else (the positional forms of 3.x are gone), instead of ignoring it
	for (const [label, bad] of Object.entries({'true': true, 'false': false, 'a number': 0.5, 'a string': 'cover', 'null': null, 'a typed array': new Uint8Array(2)})) {
		const image = photo.clone();
		const error = await throwsA(() => image.cropCircle(bad), TypeError, `cropCircle(${label})`);
		if (!/cropCircle\(\) takes an options object/.test(error.message)) panic(`cropCircle(${label}): the message should name the options form, got ${error.message}`);
		if (!Buffer.from(image.bitmap).equals(Buffer.from(photo.bitmap))) panic(`cropCircle(${label}): the image should be unchanged`);
	}
	for (const fine of [undefined, {}, {size: 'cover'}, {size: 'contain', feathering: 0.1}]) photo.clone().cropCircle(fine);
	await throwsA(() => photo.clone().cropCircle({size: 'huge'}), TypeError, 'cropCircle with an unknown size');

	// renderText(text, { font, size, ... }) is the only form: the 3.x forms with the font first fail clearly
	const ok = await Image.renderText('Hi', {font, size: 24});
	if (ok.width < 4 || ok.height < 4) panic(`renderText: ${ok.width}x${ok.height}`);
	for (const [label, call] of Object.entries({
		'the font first': () => Image.renderText(font, 32, 'Hi'),
		'no options': () => Image.renderText('Hi'),
		'null options': () => Image.renderText('Hi', null),
		'a size instead of options': () => Image.renderText('Hi', 32),
		'a number as the text': () => Image.renderText(5, {font, size: 10})
	})) {
		const error = await throwsA(call, TypeError, `renderText with ${label}`);
		if (!/renderText\(/.test(error.message)) panic(`renderText with ${label}: the message should show the form, got ${error.message}`);
	}
	const noFont = await throwsA(() => Image.renderText('Hi', {size: 10}), TypeError, 'renderText without a font');
	if (!/font/.test(noFont.message)) panic(`renderText without a font: ${noFont.message}`);
})().catch(error => panic(error.stack || String(error)));
