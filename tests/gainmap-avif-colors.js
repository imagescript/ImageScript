const {Image, GainMap} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
// the nclx colr boxes of an AVIF file: [offset of the primaries, primaries, transfer, matrix]
const nclx = data => {
	const found = [];
	for (let i = 0; i + 14 <= data.length; i++)
		if (data[i] === 0x63 && data[i + 1] === 0x6f && data[i + 2] === 0x6c && data[i + 3] === 0x72 && String.fromCharCode(...data.subarray(i + 4, i + 8)) === 'nclx')
			found.push([i + 8, data[i + 8] << 8 | data[i + 9], data[i + 10] << 8 | data[i + 11], data[i + 12] << 8 | data[i + 13]]);
	return found;
};

// the colors of the HDR rendition (the tone mapped item's colr) stay through a decode and an encode: libavif writes
// BT.2020 there for a BT.709 base with useBaseColorSpace false, and the gains apply in those colors
(async () => {
	const image = new Image(16, 16).fill(0x808080ff);
	image.gainMap = new GainMap(new Image(8, 8).fill(0x808080ff), {max: 2, useBaseColorSpace: false});
	const file = await image.encodeAVIF({threads: 1});
	// the base, the map and the tone mapped item, in that order
	const boxes = nclx(file);
	if (boxes.length !== 3) panic(`expected 3 nclx boxes, found ${boxes.length}`);
	const [offset] = boxes[2];
	file[offset] = 0;
	file[offset + 1] = 9;
	const decoded = await Image.decode(file);
	const again = nclx(await decoded.encodeAVIF({threads: 1}));
	if (again[2][1] !== 9 || again[2][2] !== boxes[2][2]) panic(`the HDR rendition's colors became primaries ${again[2][1]}, transfer ${again[2][2]} instead of 9, ${boxes[2][2]}`);
	if (again[0][1] !== boxes[0][1]) panic('the base\'s colors changed');
	// a clone of the map keeps them too
	const copy = decoded.clone();
	if (nclx(await copy.encodeAVIF({threads: 1}))[2][1] !== 9) panic('a clone lost the HDR rendition\'s colors');
	// a new map has the base's primaries with PQ, as before
	if (boxes[2][1] !== boxes[0][1] || boxes[2][2] !== 16) panic(`a new map's HDR colors: ${boxes[2]}`);
})();
