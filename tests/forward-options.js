const fs = require('fs').promises;
const {Image, GainMap} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};
const alpha = image => {
    let sum = 0;
    for (let i = 3; i < image.bitmap.length; i += 4) sum += image.bitmap[i];
    return sum;
};
const same = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.bitmap).equals(Buffer.from(b.bitmap));

// the 4.0 names of options that 4.0 would ignore under their 3.x names: following the deprecation hints of 3.x leads to
// them, and they give what the 3.x names give
(async () => {
    // cropCircle({ fit }), the 4.0 name of size
    for (const fit of ['contain', 'cover']) {
        const byFit = new Image(20, 10).fill(0xff0000ff).cropCircle({fit});
        const bySize = new Image(20, 10).fill(0xff0000ff).cropCircle({size: fit});
        if (alpha(byFit) !== alpha(bySize)) panic(`cropCircle({ fit: '${fit}' }) differs from { size: '${fit}' }`);
    }
    if (alpha(new Image(20, 10).fill(0xff0000ff).cropCircle({fit: 'cover'})) === alpha(new Image(20, 10).fill(0xff0000ff).cropCircle())) panic('cropCircle({ fit: \'cover\' }) should cover');
    let error = null;
    try { new Image(4, 4).cropCircle({fit: 'fill'}); } catch (err) { error = err; }
    if (!(error instanceof TypeError)) panic(`cropCircle({ fit: 'fill' }) should throw a TypeError, got ${error}`);

    // renderSVG({ width }), { height }, { scale } and { font }, the 4.0 forms of { size, mode } and { fonts }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/><text x="2" y="16" font-size="14">Hi</text></svg>';
    const font = await fs.readFile('./tests/fonts/carbon phyber.ttf');
    for (const [now, before] of [
        [{width: 80}, {size: 80, mode: 'width'}],
        [{height: 60}, {size: 60, mode: 'height'}],
        [{scale: 2}, {size: 2, mode: 'scale'}],
        [{scale: 0.5}, {size: 0.5}],
        [{font}, {fonts: [font]}],
        [{font: [font]}, {fonts: [font]}],
        [{width: 80, font}, {size: 80, mode: 'width', fonts: [font]}]
    ]) {
        const a = await Image.renderSVG(svg, now), b = await Image.renderSVG(svg, before);
        if (!same(a, b)) panic(`renderSVG(${JSON.stringify(Object.keys(now))}) differs from its 3.x form`);
    }
    for (const [options, type] of [[{width: 0}, RangeError], [{scale: -1}, RangeError], [{width: 10, height: 10}, TypeError], [{width: 10, scale: 2}, TypeError], [{width: 10, size: 10}, TypeError]]) {
        error = null;
        try { await Image.renderSVG(svg, options); } catch (err) { error = err; }
        if (!(error instanceof type)) panic(`renderSVG(${JSON.stringify(options)}) should throw a ${type.name}, got ${error}`);
    }

    // new GainMap(image, { min, max }) and map.min, map.max, the 4.0 names of gainMapMin and gainMapMax
    const pixels = new Image(4, 4).fill(0x808080ff);
    const byName = new GainMap(pixels, {min: -1, max: [1, 2, 3]}), old = new GainMap(pixels, {gainMapMin: -1, gainMapMax: [1, 2, 3]});
    if (JSON.stringify(byName.min) !== JSON.stringify(old.gainMapMin) || JSON.stringify(byName.max) !== JSON.stringify(old.gainMapMax)) panic('new GainMap({ min, max }) differs from { gainMapMin, gainMapMax }');
    if (byName.hdrCapacityMax !== old.hdrCapacityMax) panic('new GainMap({ max }) should default hdrCapacityMax like gainMapMax');
    byName.min = [0, 0, 0];
    if (JSON.stringify(byName.gainMapMin) !== '[0,0,0]') panic('map.min should set gainMapMin');
    byName.gainMapMax = [4, 4, 4];
    if (JSON.stringify(byName.max) !== '[4,4,4]') panic('map.max should read gainMapMax');
    error = null;
    try { new GainMap(pixels, {min: 0, gainMapMin: 0}); } catch (err) { error = err; }
    if (!(error instanceof TypeError)) panic(`new GainMap({ min, gainMapMin }) should throw a TypeError, got ${error}`);
})();
