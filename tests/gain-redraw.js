const fs = require('fs').promises;
const {Image} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};
// the map's log2 gain at a map pixel (red channel)
const gain = (map, x, y) => map.gainMapMin[0] + (map.gainMapMax[0] - map.gainMapMin[0]) * (map.image.bitmap[4 * (y * map.width + x)] / 255) ** (1 / map.gamma[0]);
const mapBytes = image => Buffer.from(image.gainMap.image.bitmap);

(async () => {
	const file = await fs.readFile('./tests/gainmap/single-channel.jpg');

	// drawing in a small area only changes the map where it was drawn: the rest of the map keeps its stored values,
	// and the range stays
	{
		const image = await Image.decode(file), before = mapBytes(image), range = [image.gainMap.gainMapMin.slice(), image.gainMap.gainMapMax.slice()];
		const map = image.gainMap, sx = map.width / image.width, sy = map.height / image.height;
		const box = {x: 100, y: 80, width: 60, height: 40};
		image.drawBox(box.x, box.y, box.width, box.height, 0x000000ff);
		if (JSON.stringify([map.gainMapMin, map.gainMapMax]) !== JSON.stringify(range)) panic('drawBox: the range of the map changed');
		const after = mapBytes(image);
		let changed = 0;
		for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
			const i = 4 * (y * map.width + x), inside = x >= Math.floor(box.x * sx) && x < Math.ceil((box.x + box.width) * sx) && y >= Math.floor(box.y * sy) && y < Math.ceil((box.y + box.height) * sy);
			const differs = before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2];
			if (differs && !inside) panic(`drawBox: the map changed outside the box at ${x},${y}`);
			if (differs) changed++;
		}
		if (changed === 0) panic('drawBox: black over highlights should change the map');
		// black has no highlight: no boost where it covers the map pixel completely
		const cx = Math.floor((box.x + box.width / 2) * sx), cy = Math.floor((box.y + box.height / 2) * sy);
		if (Math.abs(gain(map, cx, cy)) > 0.02) panic(`drawBox: the gain under black is ${gain(map, cx, cy)}`);
	}

	// many thin boxes: the same map as drawing them one by one on a copy without a shortcut (the order doesn't matter)
	{
		const a = await Image.decode(file), b = await Image.decode(file);
		for (let y = 0; y < a.height; y += 8) a.drawBox(0, y, a.width, 1, 0x00000055);
		for (let y = a.height - (a.height % 8 || 8); y >= 0; y -= 8) b.drawBox(0, y, b.width, 1, 0x00000055);
		let worst = 0;
		for (let y = 0; y < a.gainMap.height; y += 7) for (let x = 0; x < a.gainMap.width; x += 7) worst = Math.max(worst, Math.abs(gain(a.gainMap, x, y) - gain(b.gainMap, x, y)));
		if (worst > 0.05) panic(`drawBox: scanlines in a different order give different maps (${worst})`);
		if (mapBytes(a).equals(mapBytes(await Image.decode(file)))) panic('drawBox: scanlines should change the map');
	}

	// a drawing brighter than the map's range grows it, and the pixels the drawing didn't touch keep their gain
	{
		const image = await Image.decode(file), map = image.gainMap;
		const before = Array.from({length: 20}, (_, i) => gain(map, i * 7 % map.width, i * 11 % map.height));
		const max = map.gainMapMax[0];
		// an HDR source with a stronger map, composited over a part of the image
		const source = new Image(80, 80).fill(0xffffffff);
		source.gainMap = (await Image.decode(file)).gainMap.clone();
		source.gainMap.gainMapMax = [max + 2, max + 2, max + 2];
		source.gainMap.image.fill(0xffffffff);
		image.composite(source, 10, 10);
		if (!(map.gainMapMax[0] > max)) panic(`composite: the range should have grown beyond ${max}, it is ${map.gainMapMax[0]}`);
		for (let i = 0; i < 20; i++) {
			const x = i * 7 % map.width, y = i * 11 % map.height;
			// (not where the source went: the map pixels of the image's 10 to 90)
			if (x <= Math.ceil(90 * map.width / image.width) && y <= Math.ceil(90 * map.height / image.height)) continue;
			const now = gain(map, x, y);
			if (Math.abs(now - before[i]) > 0.03) panic(`composite: the gain at ${x},${y} changed from ${before[i]} to ${now} with the range`);
		}
	}
})().catch(error => panic(error.stack || String(error)));
