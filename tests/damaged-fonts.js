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

// the offset of a table of the font in its file
const tableOffset = (data, tag) => {
    for (let i = 0, count = data.readUInt16BE(4); i < count; i++) if (data.toString('latin1', 12 + i * 16, 16 + i * 16) === tag) return data.readUInt32BE(20 + i * 16);
    panic(`no ${tag} table`);
};
// a count (a 32-bit number) at `offset` of a table, changed to `value`
const withCount = (name, tag, offset, value) => {
    const data = Buffer.from(fs.readFileSync(fonts + name));
    data.writeUInt32BE(value, tableOffset(data, tag) + offset);
    return data;
};
// the first cmap subtable of format 14 (variation sequences), as an offset in the cmap table
const cmap14 = name => {
    const data = fs.readFileSync(fonts + name), cmap = tableOffset(data, 'cmap');
    for (let i = 0, count = data.readUInt16BE(cmap + 2); i < count; i++) {
        const subtable = data.readUInt32BE(cmap + 4 + i * 8 + 4);
        if (data.readUInt16BE(cmap + subtable) === 14) return subtable;
    }
    panic(`${name} has no cmap format 14`);
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
    // the counts of the COLRv1 base glyph list (at the offset the table's header gives, 14) and clip list (22) and of the
    // cmap format 14 records are 32-bit numbers: the searches over them ended in an endless loop, or ran past the font
    'colr base glyph list with a huge count': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'noto colrv1 subset.ttf')), colr = tableOffset(data, 'COLR');
        data.writeUInt32BE(0xffffffff, colr + data.readUInt32BE(colr + 14));
        return data;
    })(),
    'colr clip list with a huge count': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'noto colrv1 subset.ttf')), colr = tableOffset(data, 'COLR');
        data.writeUInt32BE(0x80000001, colr + data.readUInt32BE(colr + 22) + 1);
        return data;
    })(),
    // the clip list holds one clip box, which covers every glyph and lies outside of the font: drawing a color glyph read past its end (an SVG
    // doesn't show a glyph it can't draw, like text it can't lay out)
    'colr clip box outside of the font': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'noto colrv1 subset.ttf')), colr = tableOffset(data, 'COLR');
        const clips = colr + data.readUInt32BE(colr + 22);
        data.writeUInt32BE(1, clips + 1);
        data.writeUInt16BE(0, clips + 5);
        data.writeUInt16BE(0xffff, clips + 7);
        data.writeUIntBE(0xffffff, clips + 9, 3);
        return data;
    })(),
    // units per em of 0 made the size of the text NaN by Infinity pixels (a LimitError)
    'head with 0 units per em': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'carbon phyber.ttf'));
        data.writeUInt16BE(0, tableOffset(data, 'head') + 18);
        return data;
    })(),
    // a name record and a cmap format 4 subtable whose offsets lie outside of the font: an SVG doesn't use such a font,
    // like one that doesn't load (it threw a RangeError)
    'name record outside of the font': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'carbon phyber.ttf'));
        data.writeUInt32BE(0x7fffffff, 141352);
        return data;
    })(),
    'cmap format 4 outside of the font': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'resvg/NotoMono-Regular.ttf'));
        data.writeUInt32BE(0x7fffffff, 952);
        return data;
    })(),
    // a CBLC strike of 0 pixels per em: the text's bitmaps were scaled by Infinity (a LimitError)
    'cblc strike of 0 ppem': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'noto color emoji subset.ttf')), cblc = tableOffset(data, 'CBLC');
        data[cblc + 8 + 45] = 0;
        return data;
    })(),
    // an sbix strike of 0 pixels per em (like the CBLC one)
    'sbix strike of 0 ppem': (() => {
        const data = Buffer.from(fs.readFileSync(fonts + 'sbix.ttf')), sbix = tableOffset(data, 'sbix');
        data.writeUInt16BE(0, sbix + data.readUInt32BE(sbix + 8));
        return data;
    })(),
    // fonts cut off inside their header or table directory: loading them reads past the end
    'font cut to 12 bytes': fs.readFileSync(fonts + 'carbon phyber.ttf').subarray(0, 12),
    'font cut to 100 bytes': fs.readFileSync(fonts + 'carbon phyber.ttf').subarray(0, 100),
    'cmap format 14 with a huge record count': withCount('font features.ttf', 'cmap', cmap14('font features.ttf') + 6, 0xffffffff),
    'cblc with a huge strike count': patched('noto color emoji subset.ttf', [[0x27, 44, 12]])
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'damaged-fonts-'));
try {
    // the runtime running this script: node, deno or bun
    const [command, ...flags] = typeof Deno !== 'undefined' ? [process.execPath, 'run', '-A'] : [process.execPath];
    for (const [name, font] of Object.entries(cases)) {
        const file = path.join(directory, 'font');
        fs.writeFileSync(file, font);
        for (const via of ['text', 'svg', 'option', 'mixed']) {
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
