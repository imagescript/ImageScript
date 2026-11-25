const fs = require('fs');
const {Image} = require('..');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// Progressive scans whose header asks for coefficients past the 63rd (Se of 64 to 255, damage): the refinement reads a
// correction bit for each of those positions, so the bits that follow, and with them how the decoding ends, are the
// same as in ImageScript 4.0.0 (these results are its)

function patch(data, which, se) {
    const d = Buffer.from(data);
    for (let i = 2; i + 4 < d.length;) {
        if (d[i] !== 0xff) { i++; continue; }
        const marker = d[i + 1];
        if (marker === 0xda) {
            const end = i + 2 + (d[i + 2] << 8 | d[i + 3]);
            // Ss, Se, Ah/Al end the scan header
            if (d[end - 3] > 0 && (which === 'all' || d[end - 1] >> 4 > 0)) d[end - 2] = se;
            i = end;
            continue;
        }
        if (marker >= 0xc0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && marker !== 0xff) { i += 2 + (d[i + 2] << 8 | d[i + 3]); continue; }
        i++;
    }
    return d;
}

const huffman = 'JPEG: invalid huffman code', truncated = 'JPEG: the scan data is truncated';
const expected = {
    'tiny-17x9-prog': { refine: [huffman, truncated, truncated], all: [truncated, truncated, truncated] },
    'gray-prog': { refine: [truncated, huffman, truncated], all: [truncated, truncated, truncated] },
    'orig-422-prog': { refine: [huffman, truncated, truncated], all: [truncated, truncated, truncated] },
};

(async () => {
    for (const [name, results] of Object.entries(expected)) {
        const data = fs.readFileSync(`./tests/jpegs/${name}.jpg`);
        for (const which of ['refine', 'all'])
            for (const [i, se] of [64, 80, 255].entries()) {
                const message = await Image.decode(patch(data, which, se)).then(() => 'decoded', error => error.message);
                if (message !== results[which][i]) panic(`${name}, Se ${se} in ${which === 'all' ? 'all AC scans' : 'the refinement scans'}: ${message}, expected ${results[which][i]}`);
            }
    }
})();
