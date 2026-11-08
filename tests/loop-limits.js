const {Animation, Frame} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// loop counts are stored in fixed-size fields: a count that doesn't fit used to wrap around (65536 repeats became 0, which
// plays forever), now it's refused; the largest count of each format round trips
(async () => {
	const frames = () => [0xff0000ff, 0x00ff00ff].map(color => Frame.from(new Animation([new Frame(4, 4)])[0].fill(color), {duration: 50}));
	const limits = {GIF: 65535, WebP: 65534, APNG: 2 ** 31 - 2};
	const encode = {GIF: a => a.encodeGIF(), WebP: a => a.encodeWebP(), APNG: a => a.encodeAPNG()};
	const factory = {GIF: Animation.gifEncoder, WebP: Animation.webpEncoder, APNG: Animation.apngEncoder};

	for (const [format, max] of Object.entries(limits)) {
		const decoded = await Animation.decode(await encode[format](new Animation(frames(), {loopCount: max})));
		if (decoded.loopCount !== max) panic(`${format}: loop count ${max} read back as ${decoded.loopCount}`);
		for (const forever of [-1, Infinity]) {
			const again = await Animation.decode(await encode[format](new Animation(frames(), {loopCount: forever})));
			if (again.loopCount !== -1 && again.loopCount !== Infinity) panic(`${format}: loop count ${forever} read back as ${again.loopCount}`);
		}

		for (const count of [max + 1, max + 1000, 2 ** 40]) {
			let error = null;
			try { await encode[format](new Animation(frames(), {loopCount: count})); } catch (e) { error = e; }
			if (!(error instanceof RangeError) || !error.message.includes(String(max))) panic(`${format}: loop count ${count} should be refused with the largest count, got ${error}`);

			error = null;
			try { factory[format].call(Animation, 4, 4, {loopCount: count}); } catch (e) { error = e; }
			if (!(error instanceof RangeError)) panic(`${format} encoder: loop count ${count} should be refused, got ${error}`);
		}

		// the streaming encoder writes the same count
		const encoder = factory[format].call(Animation, 4, 4, {loopCount: max});
		for (const frame of frames()) await encoder.add(frame);
		const streamed = await Animation.decode(await encoder.finish());
		if (streamed.loopCount !== max) panic(`${format} encoder: loop count ${max} read back as ${streamed.loopCount}`);
	}
})().catch(error => panic(error.stack || String(error)));
