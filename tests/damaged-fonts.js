const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// Damaged fonts end with a plain Error (or render), never an internal TypeError or RangeError, a hang or a process abort,
// both through Image.renderText() and through an SVG's @font-face (an untrusted SVG brings its own font)

const fonts = './tests/fonts/';
// a copy of a font with some bytes changed
const patched = (name, changes) => {
    const data = Buffer.from(fs.readFileSync(fonts + name));
    for (const [offset, from, to] of changes) {
        if (data[offset] !== from) panic(`${name}: byte ${offset} isn't ${from}, the fixture changed`);
        data[offset] = to;
    }
    return data;
};

const cases = {
    // the CFF table's Top DICT INDEX is empty (the offset of the table after the head is moved)
    'cff without a top dict': patched('sourcesans3 regular.otf', [[0x27, 216, 88]]),
    // a CID-keyed CFF font with an FDArray but no FDSelect (its Top DICT entry is changed to the FDArray operator)
    'cff fdarray without fdselect': patched('source han sans cid subset.otf', [[0x4f4, 37, 214]]),
    // the CBLC table (its offset is moved) holds a strike count of 0x0c000000 and more: a list of that many strikes
    // ran the process out of memory (a count too big for the sbix table's reads is caught when they leave the font)
    // a 1.5 KB font with a cmap format 12 subtable that claims 0xffffffff groups: the binary search over them, with a
    // middle that went negative, ended in an endless loop
    'cmap format 12 with a huge group count': fs.readFileSync(fonts + 'damaged cmap format 12.ttf'),
    'cblc with a huge strike count': patched('noto color emoji subset.ttf', [[0x27, 44, 12]])
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'damaged-fonts-'));
try {
    // the runtime running this script: node, deno or bun
    const [command, ...flags] = typeof Deno !== 'undefined' ? [process.execPath, 'run', '-A'] : [process.execPath];
    for (const [name, font] of Object.entries(cases)) {
        const file = path.join(directory, 'font');
        fs.writeFileSync(file, font);
        for (const via of ['text', 'svg']) {
            let result;
            try {
                result = child_process.execFileSync(command, [...flags, './tests/util/damaged-font.js', file, via], {timeout: 20000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
            } catch (error) {
                result = error.signal === 'SIGTERM' ? 'hung for 20 s' : `crashed (${error.signal || `exit ${error.status}`})`;
            }
            if (result !== 'ok') panic(`${name}, rendered as ${via}: ${result}`);
        }
    }
} finally {
    fs.rmSync(directory, {recursive: true, force: true});
}
