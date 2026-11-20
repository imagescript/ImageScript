const {Image} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// resize({ fit: 'inside' }) checks the box like the other fits: a side below 1 pixel throws instead of making 1x1
for (const box of [{width: 0, height: 10}, {width: -5, height: 10}, {width: 0.5, height: 10}, {width: 10, height: 0}, {width: NaN, height: 10}]) {
	let error = null;
	try { new Image(8, 4).resize({...box, fit: 'inside'}); } catch (err) { error = err; }
	if (!(error instanceof RangeError)) panic(`resize(${JSON.stringify(box)}, inside): ${error ? error.constructor.name : 'no error'}`);
	const image = new Image(8, 4);
	try { image.resize({...box, fit: 'inside'}); } catch {}
	if (image.width !== 8 || image.height !== 4) panic('a resize that throws should leave the image as it was');
}
const inside = new Image(8, 4).resize({width: 4, height: 4, fit: 'inside'});
if (inside.width !== 4 || inside.height !== 2) panic(`inside 4x4: ${inside.width}x${inside.height}`);

// pixels() goes over the pixels the image has when it is called, also if it is resized before the first value is taken
const image = new Image(2, 2).fill(0xff0000ff);
const pixels = image.pixels();
image.resize(4, 4);
const all = [...pixels];
if (all.length !== 4) panic(`pixels() called on 2x2 and resized to 4x4 before iterating gave ${all.length} pixels`);
