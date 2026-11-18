const {Animation, Image} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// an animation without frames can be made (its canvas can be set, frames assigned later), but encoding it is a mistake
// of the caller, a RangeError (a count of 0), like the other methods that need something to work with
(async () => {
	const empty = () => new Animation([], {width: 4, height: 4});
	for (const [name, encode] of [
		['encodeGIF', () => empty().encodeGIF()],
		['encodeAPNG', () => empty().encodeAPNG()],
		['encodeWebP', () => empty().encodeWebP()],
		['gifEncoder', () => Animation.gifEncoder(4, 4).finish()],
		['apngEncoder', () => Animation.apngEncoder(4, 4).finish()],
		['webpEncoder', () => Animation.webpEncoder(4, 4).finish()]
	]) {
		let error = null;
		try { await encode(); } catch (err) { error = err; }
		if (!(error instanceof RangeError) || !/at least one frame, not 0$/.test(error.message)) panic(`${name}: ${error?.constructor?.name}: ${error?.message}, expected a RangeError about at least one frame`);
	}
	// frames assigned later encode
	const later = empty();
	later.frames = [new (require('..').Frame)(new Image(4, 4).fill(0xff0000ff))];
	await later.encodeGIF();
})();
