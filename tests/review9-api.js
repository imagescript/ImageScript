const fs = require('fs');
const {Image, Animation, Frame} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

(async () => {
	// renderText checks strokeColor like color, with or without a stroke: a wrong one doesn't pass until the width is set
	const font = fs.readFileSync('./tests/fonts/carbon phyber.ttf');
	for (const strokeWidth of [0, 2]) {
		const error = await Image.renderText('Hi', {font, size: 32, strokeWidth, strokeColor: 'bad'}).then(() => null, err => err);
		if (!(error instanceof TypeError) || !/not 'bad'$/.test(error.message)) panic(`strokeColor 'bad' with strokeWidth ${strokeWidth}: ${error?.constructor?.name}: ${error?.message}`);
	}
	await Image.renderText('Hi', {font, size: 32, strokeColor: 0xff0000ff});

	// an encoder that has no frame at finish() isn't used up by the error: frames can be added and it finishes
	const encoder = Animation.gifEncoder(4, 4);
	const error = await encoder.finish().then(() => null, err => err);
	if (!(error instanceof RangeError)) panic(`finish() without frames: ${error?.constructor?.name}`);
	await encoder.add(new Frame(new Image(4, 4).fill(0xff0000ff)));
	const file = await encoder.finish();
	if (file.length < 20) panic('the encoder should finish after the frame was added');
	const again = await encoder.finish().then(() => null, err => err);
	if (!(again instanceof Error) || /frame/.test(again.message)) panic(`finish() twice: ${again?.message}`);
})();
