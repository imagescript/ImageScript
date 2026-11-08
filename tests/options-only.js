const {Image, Frame, Animation, GainMap, ResizeModes, decode} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// the 3.x positional forms of 4.0 methods throw a TypeError (and leave the image as it was)
const rejects = async (call, label) => {
	let error = null;
	try { await call(); } catch (e) { error = e; }
	if (!(error instanceof TypeError)) panic(`${label}: should throw a TypeError, got ${error}`);
	return error;
};

const sameImage = (image, reference, label) => {
	if (image.width !== reference.width || image.height !== reference.height || !Buffer.from(image.bitmap).equals(Buffer.from(reference.bitmap)))
		panic(`${label}: the image should be unchanged`);
};

(async () => {
	const photo = new Image(20, 12).fill((x, y) => 0x336699ff + x * 0x01000000 + y * 0x00010000 >>> 0);

	// resize, scale, contain, fit and cover take the resizing mode in the options only
	const modes = {'a mode name': ResizeModes.AREA, 'a string': 'bilinear', 'an unknown mode': 'Area', 'null': null};
	for (const [label, mode] of Object.entries(modes)) {
		for (const method of ['resize', 'contain', 'fit', 'cover']) {
			const image = photo.clone();
			const error = await rejects(() => image[method](10, 6, mode), `${method}(10, 6, ${label})`);
			if (!/takes an options object/.test(error.message)) panic(`${method}(10, 6, ${label}): the message should name the options form, got ${error.message}`);
			sameImage(image, photo, `${method}(10, 6, ${label})`);
		}
		const scaled = photo.clone();
		await rejects(() => scaled.scale(0.5, mode), `scale(0.5, ${label})`);
		sameImage(scaled, photo, `scale(0.5, ${label})`);
		const frame = new Frame(20, 12, {duration: 50});
		await rejects(() => frame.resize(10, 6, mode), `Frame.resize(10, 6, ${label})`);
		if (frame.width !== 20 || frame.height !== 12) panic(`Frame.resize(10, 6, ${label}): the frame should keep its size`);
		const animation = new Animation([new Frame(20, 12)]);
		await rejects(() => animation.resize(10, 6, mode), `Animation.resize(10, 6, ${label})`);
		if (animation.frames[0].width !== 20 || animation.frames[0].height !== 12) panic(`Animation.resize(10, 6, ${label}): the frames should keep their size`);
	}

	// the image operations take their values in the options object only
	const patch = new Image(2, 2).fill(0xff0000ff);
	const oldCalls = {
		'composite(patch, 3, 4)': image => image.composite(patch, 3, 4),
		'composite(patch, 3)': image => image.composite(patch, 3),
		'composite(patch, 3, 4, { opacity: 0.5 })': image => image.composite(patch, 3, 4, {opacity: 0.5}),
		'trim(0xffffffff)': image => image.trim(0xffffffff),
		'trim(0xffffffff, { tolerance: 0.1 })': image => image.trim(0xffffffff, {tolerance: 0.1}),
		'colorToAlpha(0xffffffff)': image => image.colorToAlpha(0xffffffff),
		'colorToAlpha(0xffffffff, { opacityThreshold: 0.5 })': image => image.colorToAlpha(0xffffffff, {opacityThreshold: 0.5}),
		'sharpen(2, 3)': image => image.sharpen(2, 3),
		'sharpen(2)': image => image.sharpen(2),
		'dominantColor(true)': image => image.dominantColor(true),
		'dominantColor(true, false, 4)': image => image.dominantColor(true, false, 4),
		'rotate(45, false)': image => image.rotate(45, false),
		'rotate(45, true)': image => image.rotate(45, true),
		'roundCorners(3)': image => image.roundCorners(3),
		'fisheye(3)': image => image.fisheye(3)
	};
	for (const [label, call] of Object.entries(oldCalls)) {
		const image = photo.clone();
		const error = await rejects(() => call(image), label);
		if (!/takes an options object/.test(error.message)) panic(`${label}: the message should name the options form, got ${error.message}`);
		sameImage(image, photo, label);
	}
	{
		const frame = new Frame(20, 12, {xOffset: 4, yOffset: 5});
		await rejects(() => frame.trim(0xffffffff), 'Frame.trim(0xffffffff)');
		if (frame.xOffset !== 4 || frame.yOffset !== 5 || frame.width !== 20) panic('Frame.trim(0xffffffff): the frame should be unchanged');
	}
	const solid = new Image(6, 6).fill(0xffffffff).drawBox(2, 2, 2, 2, 0x000000ff);
	if (solid.clone().trim({color: 0xffffffff}).width !== 2) panic('trim({ color }) should trim the color');
	if (solid.clone().composite(patch, {x: 1, y: 1}).getPixelAt(1, 1) !== 0xff0000ff) panic('composite(patch, { x, y }) should place the patch');
	if (solid.clone().sharpen({amount: 0}).getPixelAt(2, 2) !== 0x000000ff) panic('sharpen({ amount: 0 }) should not change the pixels');
	if (solid.clone().roundCorners({radius: 0}).getPixelAt(0, 0) !== 0xffffffff) panic('roundCorners({ radius: 0 }) should not change the pixels');
	if (solid.clone().rotate(90, {resize: false}).width !== 6) panic('rotate(90, { resize: false })');

	// the encoders take their values in the options object only; the metadata goes in { metadata }
	const makeAnimation = () => new Animation([new Frame(4, 4)]);
	const gainMap = new GainMap(new Image(4, 4).fill(0x808080ff), {gainMapMin: 0, gainMapMax: 2});
	for (const [label, call] of Object.entries({
		'encodePNG(1)': () => photo.encodePNG(1),
		'encodePNG(1, { author })': () => photo.encodePNG(1, {author: 'me'}),
		'encodePNG({ author }) (3.x metadata)': () => photo.encodePNG({author: 'me'}),
		'encodeJPEG(80)': () => photo.encodeJPEG(80),
		'encodeGIF(10)': () => makeAnimation().encodeGIF(10),
		'encodeAPNG(9)': () => makeAnimation().encodeAPNG(9),
		'GainMap.encode(70)': () => gainMap.encode(70)
	})) {
		const error = await rejects(call, label);
		if (!/takes/.test(error.message)) panic(`${label}: the message should name the form, got ${error.message}`);
	}
	if (!Buffer.from(await photo.encodePNG({compression: 1, metadata: {author: 'me'}})).includes('me')) panic('encodePNG({ metadata }): the metadata is missing');
	if (!(await photo.encodeJPEG({quality: 80})).length || !(await makeAnimation().encodeGIF({quality: 10})).length) panic('encoders with options');
	if (!(await gainMap.encode({quality: 70})).length || !(await gainMap.encode()).length) panic('GainMap.encode with options');

	// renderSVG takes its size and mode in the options object only
	const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
	for (const [label, call] of Object.entries({
		'renderSVG(svg, 2)': () => Image.renderSVG(svgSource, 2),
		'renderSVG(svg, 2, width)': () => Image.renderSVG(svgSource, 2, 'width'),
		'renderSVG(svg, width)': () => Image.renderSVG(svgSource, 'width')
	})) {
		const error = await rejects(call, label);
		if (!/renderSVG\(svg, \{/.test(error.message)) panic(`${label}: the message should show the options form, got ${error.message}`);
	}
	if ((await Image.renderSVG(svgSource, {size: 2})).width !== 20) panic('renderSVG(svg, { size }) should scale');
	const byWidth = await Image.renderSVG(svgSource, {size: 30, mode: 'width'});
	if (byWidth.width !== 30 || byWidth.height !== 30) panic(`renderSVG(svg, { size, mode: 'width' }): ${byWidth.width}x${byWidth.height}`);

	// frames and animations take their duration, offsets, disposal mode and loop count in the options object only
	const frame = new Frame(4, 4, {duration: 40, xOffset: 2, yOffset: 3, disposalMode: 'background'});
	if (frame.duration !== 40 || frame.xOffset !== 2 || frame.yOffset !== 3 || frame.disposalMode !== 'background') panic('new Frame(width, height, options)');
	if (Frame.from(photo, {duration: 40, xOffset: 2}).xOffset !== 2 || Frame.from(photo).duration !== 100) panic('Frame.from(image, options)');
	if (new Animation([new Frame(4, 4)], {loopCount: 2}).loopCount !== 2 || new Animation([new Frame(4, 4)]).loopCount !== Infinity) panic('new Animation(frames, options)');
	const encodedGIF = await new Animation([new Frame(4, 4)]).encodeGIF();
	if (!((await Image.decode(encodedGIF)) instanceof Image)) panic('Image.decode(data) should return the first frame as an Image');
	const oldFrames = {
		'new Frame(4, 4, 100)': () => new Frame(4, 4, 100),
		'new Frame(4, 4, 100, 1, 1, "keep")': () => new Frame(4, 4, 100, 1, 1, 'keep'),
		'Frame.from(photo, 100)': () => Frame.from(photo, 100),
		'Frame.from(photo, 100, 1, 1, "keep")': () => Frame.from(photo, 100, 1, 1, 'keep'),
		'new Animation([frame], 2)': () => new Animation([frame], 2),
		'new Animation([frame], Infinity)': () => new Animation([frame], Infinity),
		'Animation.decode(gif, true)': () => Animation.decode(encodedGIF, true),
		'decode(gif, true)': () => decode(encodedGIF, true)
	};
	for (const [label, call] of Object.entries(oldFrames)) {
		const error = await rejects(call, label);
		if (!/takes an options object/.test(error.message)) panic(`${label}: the message should name the options form, got ${error.message}`);
	}

	// the channel methods take a factor only: a second argument (3.x's absolute) throws before the image is touched
	for (const method of ['opacity', 'red', 'green', 'blue', 'lightness', 'saturation']) {
		for (const second of [true, {absolute: true}]) {
			const image = photo.clone();
			const before = Buffer.from(image.bitmap);
			const error = await rejects(() => image[method](0.5, second), `${method}(0.5, ${JSON.stringify(second)})`);
			if (!/channel methods reject the removed absolute argument/.test(error.message)) panic(`${method}: the message should name the replacement, got ${error.message}`);
			if (!Buffer.from(image.bitmap).equals(before)) panic(`${method}(0.5, ${JSON.stringify(second)}) changed the image before throwing`);
		}
	}
	if (new Image(1, 1).fill(0xc80000ff).red(0.5).getPixelAt(0, 0) !== 0x640000ff) panic('red(0.5) should scale the red channel');

	// the positional resize needs a height (3.x refused resize(100)): the message names the options form
	for (const [label, call] of Object.entries({
		'image.resize(100)': () => photo.clone().resize(100),
		'image.resize(100, undefined)': () => photo.clone().resize(100, undefined),
		'frame.resize(100)': () => new Frame(8, 4).resize(100),
		'animation.resize(100)': () => new Animation([new Frame(8, 4)]).resize(100)
	})) {
		const error = await rejects(call, label);
		if (!/resize\(\) needs a height or the options form, like resize\(\{ width: 100 \}\)/.test(error.message)) panic(`${label}: the message should name resize({ width: 100 }), got ${error.message}`);
	}
	let nanError = null;
	try { photo.clone().resize(NaN, 6); } catch (e) { nanError = e; }
	if (!(nanError instanceof RangeError)) panic(`resize(NaN, 6) should throw a RangeError, got ${nanError}`);

	// the options form still resizes; undefined stays fine
	if (photo.clone().resize(10, 6, {mode: ResizeModes.AREA}).width !== 10) panic('resize(10, 6, { mode })');
	if (photo.clone().resize(10, 6).height !== 6) panic('resize(10, 6)');
	if (photo.clone().resize(10, 6, undefined).height !== 6) panic('resize(10, 6, undefined)');
	if (photo.clone().scale(0.5, {mode: ResizeModes.AREA}).width !== 10) panic('scale(0.5, { mode })');
	if (photo.clone().contain(10, 10, {mode: ResizeModes.AREA}).width !== 10) panic('contain(10, 10, { mode })');
	if (photo.clone().fit(10, 10, {mode: ResizeModes.AREA}).height !== 10) panic('fit(10, 10, { mode })');
	if (photo.clone().cover(10, 10, {mode: ResizeModes.AREA}).width !== 10) panic('cover(10, 10, { mode })');
	if (new Frame(20, 12).resize(10, 6, {mode: ResizeModes.AREA}).width !== 10) panic('Frame.resize(10, 6, { mode })');
	if (new Animation([new Frame(20, 12)]).resize(10, 6, {mode: ResizeModes.AREA}).frames[0].width !== 10) panic('Animation.resize(10, 6, { mode })');
})().catch(error => panic(error.stack || String(error)));
