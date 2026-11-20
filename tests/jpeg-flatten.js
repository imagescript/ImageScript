const {Image} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
let seed = 11;
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;

// encodeJPEG composites transparent pixels onto the background row by row, without a copy of the image: the file is the
// one of the image composited the plain way (composite() onto a filled image), for every kind of alpha
(async () => {
	const alphas = {
		'random alpha': () => random() * 256 | 0,
		'mostly opaque': () => random() < 0.9 ? 255 : random() * 256 | 0,
		'mostly clear': () => random() < 0.9 ? 0 : random() * 256 | 0,
		'two levels': () => random() < 0.5 ? 0 : 128
	};
	for (const [name, alpha] of Object.entries(alphas)) for (const [width, height] of [[17, 9], [1, 1], [64, 33]]) for (const gray of [false, true]) {
		const image = new Image(width, height).fill(() => {
			const v = random() * 256 | 0;
			return gray ? (v << 24 | v << 16 | v << 8 | alpha()) >>> 0 : ((random() * 2 ** 24) << 8 | alpha()) >>> 0;
		});
		for (const background of [0x000000ff, 0xff8800ff, 0x808080ff]) for (const quality of [50, 90, 95]) {
			const flat = new Image(width, height).fill(background).composite(image);
			const expected = await flat.encodeJPEG({quality, subsampling: quality > 90 ? '4:4:4' : '4:2:0'});
			const got = await image.encodeJPEG({quality, background, subsampling: quality > 90 ? '4:4:4' : '4:2:0'});
			if (!Buffer.from(expected).equals(Buffer.from(got))) panic(`${name} ${width}x${height} ${gray ? 'gray' : 'color'} background ${background.toString(16)} q${quality}: ${got.length} bytes, expected ${expected.length}`);
		}
	}
	// the image isn't changed
	const image = new Image(4, 4).fill(0xff000080), before = Buffer.from(image.bitmap);
	await image.encodeJPEG();
	if (!Buffer.from(image.bitmap).equals(before)) panic('encodeJPEG changed the image');
})();
