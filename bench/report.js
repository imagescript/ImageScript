// Turns results.json (run.js) and installs.json (installs.js) into charts/*.svg and README.md
import fs from 'node:fs';

const results = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
const installs = JSON.parse(fs.readFileSync(new URL('./installs.json', import.meta.url)));
const { libraries, TEXT, TEXT_SIZE, SVG_WIDTH, AVIF_QUALITY, JXL_QUALITY } = await import('./libs.js');
const quality = results.quality ?? {};
const LIBS = libraries.map(l => l.name);
const KIND = Object.fromEntries(libraries.map(l => [l.name, l.kind]));
const HIGHLIGHT = 'ImageScript 3';
fs.mkdirSync(new URL('./charts/', import.meta.url), { recursive: true });

// light and dark values of every color the charts use: one accent for ImageScript, neutral gray for the others
const STYLE = `
  .surface { fill: #fcfcfb } .text { fill: #0b0b0b } .muted { fill: #52514e } .grid { stroke: #e4e3df }
  .bar { fill: #8a8983 } .bar.highlight { fill: #2a78d6 }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19 } .text { fill: #f0efec } .muted { fill: #c3c2b7 } .grid { stroke: #383835 }
    .bar { fill: #6d6c66 } .bar.highlight { fill: #3987e5 }
  }
  .heat0 { fill: #1f9d55 } .heat1 { fill: #7cc46b } .heat2 { fill: #d9d36b } .heat3 { fill: #f0a35e } .heat4 { fill: #e2665a } .none { fill: #efeeea }
  .on-heat { fill: #0b0b0b } .ahead { fill: #2a78d6 } .behind { fill: #c4544a } .col-hl { fill: #2a78d6; fill-opacity: 0.08 }
  @media (prefers-color-scheme: dark) {
    .heat0 { fill: #23874c } .heat1 { fill: #5e9c52 } .heat2 { fill: #a49e4c } .heat3 { fill: #b77c45 } .heat4 { fill: #ad4d44 } .none { fill: #252524 }
    .on-heat { fill: #f7f6f2 } .ahead { fill: #3987e5 } .behind { fill: #d0675d } .col-hl { fill-opacity: 0.14 }
  }
  text { font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }
  .title { font-weight: 600; font-size: 14px } .bold { font-weight: 600 } .small { font-size: 11px }`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const number = v => v >= 100 ? Math.round(v).toLocaleString('en') : v >= 10 ? v.toFixed(1) : v.toFixed(2);
// the time of one operation, for the overview and slow results
const duration = ms => ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : ms >= 10 ? `${Math.round(ms)} ms` : ms >= 1 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(2)} ms`;
const speedLabel = v => v < 1 ? `${number(v)}  (${duration(1000 / v)} each)` : number(v);
const bytes = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`;

// a bar whose data end (right) is rounded by 4px and whose baseline end (left) is square
const bar = (x, y, w, h, cls) => w <= 0 ? '' : w <= 4
    ? `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`
    : `<path class="${cls}" d="M${x},${y}h${w - 4}a4,4 0 0 1 4,4v${h - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z"/>`;

/**
 * Groups of horizontal bars, one per measurement, each on its own scale (they range from a few to 100,000 per
 * second); libraries keep their row in every group, so they're easy to follow
 * @param groups [{ title, values: { library: number }, format }]
 */
function barChart(title, subtitle, groups, file) {
    const W = 760, labelW = 190, barW = 370, rowH = 22, barH = 14, groupGap = 18, pad = 20;
    let y = pad + 58, body = '';
    for (const group of groups) {
        const max = Math.max(...Object.values(group.values).filter(v => typeof v === 'number'));
        body += `<text class="text title" x="${pad}" y="${y}">${esc(group.title)}</text>`;
        if (group.note) body += `<text class="muted small" x="${W - pad}" y="${y}" text-anchor="end">${esc(group.note)}</text>`;
        y += 10;
        const libs = LIBS.filter(lib => group.values[lib] !== undefined);
        body += `<line class="grid" x1="${pad + labelW}" x2="${pad + labelW}" y1="${y}" y2="${y + libs.length * rowH}" stroke-width="1"/>`;
        for (const lib of libs) {
            const v = group.values[lib], hl = lib === HIGHLIGHT;
            const cy = y + rowH / 2;
            body += `<text class="${hl ? 'text bold' : 'muted'}" x="${pad + labelW - 10}" y="${cy + 4}" text-anchor="end">${esc(lib)}</text>`;
            if (typeof v !== 'number') body += `<text class="muted small" x="${pad + labelW + 8}" y="${cy + 4}">${esc(v)}</text>`;
            else {
                const w = Math.max(2, v / max * barW);
                body += bar(pad + labelW + 1, cy - barH / 2, w, barH, hl ? 'bar highlight' : 'bar');
                body += `<text class="${hl ? 'text bold' : 'text'}" x="${pad + labelW + w + 8}" y="${cy + 4}">${esc(group.format(v, lib))}</text>`;
            }
            y += rowH;
        }
        y += groupGap;
    }
    const H = y + pad - groupGap + 10;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title><style>${STYLE}</style>
<rect class="surface" width="${W}" height="${H}" rx="8"/>
<text class="text title" x="${pad}" y="${pad + 8}" style="font-size:16px">${esc(title)}</text>
<text class="muted" x="${pad}" y="${pad + 26}">${esc(subtitle)}</text>
${body}
</svg>
`;
    fs.writeFileSync(new URL(`./charts/${file}`, import.meta.url), svg);
}

const SPEED = [
    ['decode JPEG', 'decode JPEG'], ['decode PNG', 'decode PNG'], ['decode WebP', 'decode WebP (lossy)'],
    ['encode JPEG', 'encode JPEG (quality 80)'], ['encode PNG', 'encode PNG'], ['encode WebP', 'encode WebP (lossless)'],
    ['decode AVIF', 'decode AVIF'], ['decode JPEG XL', 'decode JPEG XL'],
    ['encode AVIF', `encode AVIF (quality ${AVIF_QUALITY})`], ['encode JPEG XL', `encode JPEG XL (quality ${JXL_QUALITY})`],
    ['resize', 'resize to half'], ['rotate', 'rotate by 30°'], ['blur', 'blur (radius 5)'],
    ['composite', 'composite an overlay'], ['crop', 'crop'], ['clone', 'clone'],
    ['text', 'render text'], ['svg', 'render SVG'],
    ['decode GIF', 'decode animated GIF'], ['encode GIF', 'encode animated GIF']
].filter(([key]) => results.speed[key]);
const ops = key => Object.fromEntries(Object.entries(results.speed[key]).map(([lib, r]) => [lib, r.error ? 'fails on this input' : r.opsPerSecond]));

const cpu = results.cpu.replace(/\((R|TM)\)|\bCPU\b|@.*$/g, '').replace(/\s+/g, ' ').trim();
const split = (keys, file, title, input = 'on a 1920×1080 photo') => barChart(title, `operations per second ${input}, more is faster · Node.js ${results.node.match(/\d+/)[0]}, ${cpu}`,
    SPEED.filter(([key]) => keys.includes(key)).map(([key, label]) => ({ title: label, values: ops(key), format: speedLabel })), file);
split(['decode JPEG', 'decode PNG', 'decode WebP', 'encode JPEG', 'encode PNG', 'encode WebP'], 'codecs.svg', 'Decoding and encoding');
split(['decode AVIF', 'decode JPEG XL', 'encode AVIF', 'encode JPEG XL'], 'modern.svg', 'AVIF and JPEG XL');
split(['resize', 'rotate', 'blur', 'composite', 'crop', 'clone'], 'operations.svg', 'Image operations');
split(['text', 'svg'], 'rendering.svg', 'Rendering', `(text at ${TEXT_SIZE}px, SVG ${SVG_WIDTH} wide)`);
split(['decode GIF', 'encode GIF'], 'animation.svg', 'Animations', 'on a 300×300 GIF with 101 frames');

barChart('Install size', 'node_modules after npm install in an empty project (all dependencies and native binaries), less is better',
    [{ title: 'install size', values: Object.fromEntries(LIBS.map(l => [l, installs[l].bytes])), format: bytes }], 'install.svg');
// (AVIF and JPEG XL with their PSNR: the libraries' quality scales differ)
const sizeLabel = key => key.replace(/ JPEG$/, ' JPEG (q 80)').replace('WebP', 'WebP (lossless)').replace(' AVIF', ` AVIF (q ${AVIF_QUALITY})`).replace('JPEG XL', `JPEG XL (q ${JXL_QUALITY})`).replace('animation GIF', 'animated GIF');
const sizeText = (key, lib) => bytes(results.sizes[key][lib]) + (quality[key]?.[lib] === 'lossless' ? ', identical pixels' : quality[key]?.[lib] ? `, ${quality[key][lib]} dB` : '');

/**
 * Rows of results by libraries, each cell a value colored by a level (0 best .. 4 worst), `null` for a grey cell
 * (shown, but not ranked); libraries without a value get a dash
 * @param rows [{ label, cells: { library: { text, level } } }]
 * @param legend [[text, level]]: level -1 is the dash, null a grey cell
 */
function grid(file, libs, title, subtitle, rows, legend, note) {
    const pad = 20, labelW = 190, headH = 62, rowH = 26, gap = 3, cellW = 118;
    const W = pad * 2 + labelW + libs.length * cellW;
    let body = '';
    const hl = libs.indexOf(HIGHLIGHT);
    // (the subtitle's parts on their own lines when the grid is narrow)
    const lines = W < 1000 ? subtitle.split(' · ') : [subtitle];
    const top = pad + 34 + lines.length * 18;
    body += `<rect class="col-hl" x="${pad + labelW + hl * cellW}" y="${top}" width="${cellW}" height="${headH + rows.length * rowH}" rx="6"/>`;
    libs.forEach((lib, i) => {
        const cx = pad + labelW + i * cellW + cellW / 2;
        body += `<text class="${lib === HIGHLIGHT ? 'text bold' : 'text'}" x="${cx}" y="${top + 24}" text-anchor="middle">${esc(lib)}</text>`;
        body += `<text class="muted small" x="${cx}" y="${top + 42}" text-anchor="middle">${esc(KIND[lib])}</text>`;
    });
    rows.forEach(({ label, cells }, row) => {
        const y = top + headH + row * rowH;
        body += `<text class="text" x="${pad + labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(label)}</text>`;
        libs.forEach((lib, i) => {
            const cell = cells[lib], x = pad + labelW + i * cellW + gap, w = cellW - gap * 2, h = rowH - gap;
            const cx = x + w / 2, cy = y + gap / 2 + h / 2 + 4;
            if (!cell) { body += `<text class="muted small" x="${cx}" y="${cy}" text-anchor="middle">–</text>`; return; }
            const ranked = cell.level !== null && cell.level !== undefined;
            body += `<rect class="${ranked ? `heat${cell.level}` : 'none'}" x="${x}" y="${y + gap / 2}" width="${w}" height="${h}" rx="4"/>`;
            const cls = ranked ? 'on-heat' : 'muted';
            body += `<text class="${cls}${lib === HIGHLIGHT ? ' bold' : ''}${cell.text.length > 14 ? ' small' : ''}" x="${cx}" y="${cy}" text-anchor="middle">${esc(cell.text)}</text>`;
        });
    });
    // legend, on two lines when the grid is too narrow for one
    let lx = pad + labelW + gap, legendY = top + headH + rows.length * rowH + 22;
    for (const [text, level] of legend) {
        if (lx + 110 > W - pad) { lx = pad + labelW + gap; legendY += 22; }
        body += level === -1 ? `<text class="muted" x="${lx + 3}" y="${legendY}">–</text>` : `<rect class="${level === null ? 'none' : `heat${level}`}" x="${lx}" y="${legendY - 11}" width="14" height="14" rx="3"/>`;
        body += `<text class="muted" x="${lx + 20}" y="${legendY}">${esc(text)}</text>`;
        lx += 118;
    }
    if (note) for (const line of note) { legendY += 20; body += `<text class="muted small" x="${pad}" y="${legendY}">${esc(line)}</text>`; }
    const H = legendY + pad;
    fs.writeFileSync(new URL(`./charts/${file}`, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title><style>${STYLE}</style>
<rect class="surface" width="${W}" height="${H}" rx="8"/>
<text class="text title" x="${pad}" y="${pad + 8}" style="font-size:16px">${esc(title)}</text>
${lines.map((line, i) => `<text class="muted" x="${pad}" y="${pad + 26 + i * 18}">${esc(line)}</text>`).join('')}
${body}
</svg>
`);
}

// speed: each cell the time of one operation, by how far it is from the fastest of its row (log scale-like steps)
const speedRows = libs => SPEED.filter(([key]) => libs.some(lib => results.speed[key][lib])).map(([key, label]) => {
    const best = Math.min(...libs.map(lib => results.speed[key][lib]).filter(r => r && !r.error).map(r => r.ms));
    const cells = {};
    for (const lib of libs) {
        const r = results.speed[key][lib];
        if (!r) continue;
        const slower = r.ms / best;
        cells[lib] = r.error ? { text: 'fails', level: null } : { text: duration(r.ms), level: slower < 1.1 ? 0 : slower < 2 ? 1 : slower < 4 ? 2 : slower < 10 ? 3 : 4 };
    }
    return { label, cells };
});
const speedLegend = [['fastest', 0], ['< 2× slower', 1], ['2-4×', 2], ['4-10×', 3], ['> 10× slower', 4], ['not supported', -1]];
const timing = `time per operation, less is faster, colored by the distance to the fastest in each row · Node.js ${results.node.match(/\d+/)[0]}, ${cpu}`;
const native = LIBS.filter(lib => KIND[lib].startsWith('native'));
const portable = LIBS.filter(lib => !native.includes(lib));
grid('overview-portable.svg', portable, 'Libraries that run everywhere: JavaScript and WebAssembly', timing, speedRows(portable), speedLegend);
grid('overview-native.svg', [HIGHLIGHT, ...native], 'For reference: native libraries (Node.js only, platform-specific binaries)', timing, speedRows([HIGHLIGHT, ...native]), speedLegend);

// sizes: lossless files rank by size alone (they decode to the same pixels); lossy ones only among the files of about
// the same quality (within 1 dB PSNR of the best of the row): a smaller file of clearly lower quality isn't better
const QUALITY_BAND = 1;
const sizeLevel = ratio => ratio < 1.05 ? 0 : ratio < 1.25 ? 1 : ratio < 1.5 ? 2 : ratio < 2 ? 3 : 4;
const LOSSLESS = ['photo PNG', 'graphic PNG', 'photo WebP', 'graphic WebP'];
const sizeRow = (key, libs) => {
    const sizes = results.sizes[key], db = quality[key] ?? {}, lossy = !LOSSLESS.includes(key);
    const present = libs.filter(lib => sizes[lib]);
    const dbOf = lib => db[lib] === 'lossless' ? Infinity : db[lib] ?? -Infinity;
    const bestDb = Math.max(...present.map(dbOf));
    const ranked = present.filter(lib => !lossy || (db[lib] !== undefined && dbOf(lib) >= bestDb - QUALITY_BAND));
    // (a row with a single file of the best quality and smaller ones of lower quality has no fair ranking: all grey)
    if (lossy && ranked.length < 2 && present.some(lib => sizes[lib] < sizes[ranked[0]])) ranked.length = 0;
    const smallest = Math.min(...ranked.map(lib => sizes[lib]));
    const cells = {};
    for (const lib of present) {
        const text = bytes(sizes[lib]) + (lossy && db[lib] !== undefined ? db[lib] === 'lossless' ? ' · identical' : ` · ${db[lib]} dB` : '');
        cells[lib] = { text, level: ranked.includes(lib) ? sizeLevel(sizes[lib] / smallest) : null };
    }
    return { label: sizeLabel(key), cells };
};
const sizeLegend = [['smallest', 0], ['< 25% larger', 1], ['25-50%', 2], ['50-100%', 3], ['> 2× larger', 4]];
const sizeLibs = LIBS.filter(lib => Object.values(results.sizes).some(s => s[lib]));
const keysOf = test => Object.keys(results.sizes).filter(test);
grid('sizes-lossless.svg', sizeLibs, 'File sizes: lossless', 'every file keeps exactly the pixels its library decoded, less is better · colored by the distance to the smallest in each row',
    keysOf(key => LOSSLESS.includes(key)).map(key => sizeRow(key, sizeLibs)), sizeLegend);
grid('sizes-lossy.svg', sizeLibs, 'File sizes: lossy, with their quality', `size and PSNR (more is better quality) · colored by size among the files within ${QUALITY_BAND} dB of the best quality of each row`,
    ['photo JPEG', 'graphic JPEG', 'photo AVIF', 'graphic AVIF', 'photo JPEG XL', 'graphic JPEG XL', 'animation GIF'].filter(key => results.sizes[key]).map(key => sizeRow(key, sizeLibs)),
    [...sizeLegend, ['not comparable', null]],
    [`JPEG at quality 80, AVIF at ${AVIF_QUALITY} and JPEG XL at ${JXL_QUALITY} in every library; their quality scales differ, so the files differ in quality too.`,
        `Grey: more than ${QUALITY_BAND} dB below the best quality of its row, or the only file at that quality (a smaller file of lower quality isn't comparable).`,
        'The GIF: the 256-color animation re-encoded; "identical" keeps every pixel, lower values are lossy re-quantizations.']);

/**
 * ImageScript against the fastest of a group of libraries, per task: how many times as fast (log scale around 1×)
 * @param kinds which libraries belong to the group (by KIND)
 */
function comparison(title, subtitle, belongs, file, note) {
    const W = 820, pad = 20, labelW = 190, rowH = 26, barH = 14, half = 165, center = pad + labelW + 15 + half, valueX = center + half + 20;
    const rows = SPEED.map(([key, label]) => {
        const ours = results.speed[key][HIGHLIGHT];
        const others = Object.entries(results.speed[key]).filter(([lib, r]) => lib !== HIGHLIGHT && belongs(lib) && !r.error);
        if (!ours || ours.error || !others.length) return null;
        const [rival, r] = others.reduce((a, b) => b[1].ms < a[1].ms ? b : a);
        return { label, rival, ratio: r.ms / ours.ms };
    }).filter(Boolean).sort((a, b) => b.ratio - a.ratio);
    const span = Math.log(Math.max(...rows.map(r => Math.max(r.ratio, 1 / r.ratio)), 4));
    let y = pad + 62, body = `<line class="grid" x1="${center}" x2="${center}" y1="${y - 8}" y2="${y + rows.length * rowH}" stroke-width="1"/>`;
    body += `<text class="muted small" x="${center - 8}" y="${y - 12}" text-anchor="end">← slower</text><text class="muted small" x="${center + 8}" y="${y - 12}">faster →</text>`;
    for (const { label, rival, ratio } of rows) {
        const cy = y + rowH / 2, w = Math.max(2, Math.abs(Math.log(ratio)) / span * half);
        body += `<text class="text" x="${pad + labelW - 10}" y="${cy + 4}" text-anchor="end">${esc(label)}</text>`;
        // (the values in their own column: long bars on either side never run into them)
        const text = ratio >= 1 ? `${number(ratio)}× as fast as ${rival}` : `${Math.round(ratio * 100)}% of ${rival}`;
        if (ratio >= 1) body += bar(center + 1, cy - barH / 2, w, barH, 'ahead');
        else body += `<rect class="behind" x="${center - w}" y="${cy - barH / 2}" width="${w}" height="${barH}" rx="3"/>`;
        body += `<text class="${ratio >= 1 ? 'text bold' : 'text'}" x="${valueX}" y="${cy + 4}">${esc(text)}</text>`;
        y += rowH;
    }
    if (note) { y += 16; body += `<text class="muted small" x="${pad}" y="${y}">${esc(note)}</text>`; }
    const H = y + pad;
    fs.writeFileSync(new URL(`./charts/${file}`, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title><style>${STYLE}</style>
<rect class="surface" width="${W}" height="${H}" rx="8"/>
<text class="text title" x="${pad}" y="${pad + 8}" style="font-size:16px">${esc(title)}</text>
<text class="muted" x="${pad}" y="${pad + 26}">${esc(subtitle)}</text>
${body}
</svg>
`);
}
// (PureJsImage's AVIF encoder has no quality option: its speed comes with much larger files of lower quality)
function avifNote() {
    const size = results.sizes['photo AVIF'], db = quality['photo AVIF'];
    if (!size?.PureJsImage || !size[HIGHLIGHT]) return undefined;
    return `encode AVIF: PureJsImage's encoder has no quality setting, its file is ${bytes(size.PureJsImage)} at ${db.PureJsImage} dB (ImageScript: ${bytes(size[HIGHLIGHT])} at ${db[HIGHLIGHT]} dB)`;
}
comparison('ImageScript vs. the fastest other pure JavaScript library', 'speed per task, against Jimp, image-js and PureJsImage (whichever is fastest at it)',
    lib => KIND[lib] === 'JavaScript', 'vs-javascript.svg', avifNote());

// tables: the same numbers, to read exactly
const table = (rows, columns, cell) => [
    `| | ${columns.map(c => `**${c}**`).join(' | ')} |`,
    `|---|${columns.map(() => '--:').join('|')}|`,
    ...rows.map(([key, label]) => `| ${label} | ${columns.map(c => cell(key, c)).join(' | ')} |`)
].join('\n');
const speedCell = (key, lib) => { const r = results.speed[key][lib]; return r?.error ? 'fails' : r ? (lib === HIGHLIGHT ? `**${duration(r.ms)}**` : duration(r.ms)) : '–'; };

const readme = `# ImageScript benchmark

How [ImageScript](https://github.com/imagescript/ImageScript) compares to other image libraries for Node.js: speed, file
sizes and what installing each takes. ImageScript is plain JavaScript with no dependencies, so it runs wherever
JavaScript does, like Jimp, image-js and PureJsImage; sharp and @napi-rs/canvas wrap native libraries (libvips, Skia),
Photon is WebAssembly, and so is jsquash (Squoosh's libavif and libjxl, for AVIF and JPEG XL).

<img src="charts/overview-portable.svg" alt="Time per operation of the libraries that run everywhere, colored by the distance to the fastest">

<img src="charts/vs-javascript.svg" alt="ImageScript's speed compared to the fastest other pure JavaScript library">

<img src="charts/overview-native.svg" alt="Time per operation of ImageScript and the native libraries">

<img src="charts/install.svg" alt="Install size of each library">

<img src="charts/codecs.svg" alt="Decoding and encoding speed">

<img src="charts/modern.svg" alt="AVIF and JPEG XL decoding and encoding speed">

<img src="charts/operations.svg" alt="Speed of image operations">

<img src="charts/rendering.svg" alt="Text and SVG rendering speed">

<img src="charts/animation.svg" alt="Animated GIF decoding and encoding speed">

<img src="charts/sizes-lossless.svg" alt="Lossless file sizes">

<img src="charts/sizes-lossy.svg" alt="Lossy file sizes with their quality">

## Numbers

Time per operation (less is faster), measured ${results.date} with Node.js ${results.node} on ${results.cpu}, ImageScript ${results.versions['ImageScript 3']}.

${table(SPEED, LIBS, speedCell)}

Encoded sizes:

${table(Object.keys(results.sizes).map(k => [k, k]), LIBS, (key, lib) => results.sizes[key][lib] ? sizeText(key, lib) : '–')}

| | ${LIBS.map(l => `**${l}**`).join(' | ')} |
|---|${LIBS.map(() => '---').join('|')}|
| kind | ${LIBS.map(l => KIND[l]).join(' | ')} |
| package | ${LIBS.map(l => `\`${installs[l].package}\``).join(' | ')} |
| install size | ${LIBS.map(l => bytes(installs[l].bytes)).join(' | ')} |
| packages | ${LIBS.map(l => installs[l].packages).join(' | ')} |

## Method

- Inputs (in \`inputs/\`, sources in [inputs/SOURCES.md](inputs/SOURCES.md)): a 1920×1080 photo (JPEG, and made from it
  when the benchmark starts, PNG, lossy WebP, AVIF by sharp (libaom) and JPEG XL by jsquash (libjxl, effort 7), both
  at the qualities below), a 1434×1434 graphic with transparency (PNG), a 445×445 diagram with transparency placed on
  the photo (PNG), a 300×300 GIF with 101 frames.
- AVIF and JPEG XL are encoded at the same nominal quality (${AVIF_QUALITY} and ${JXL_QUALITY}); as the libraries' scales differ,
  the file sizes come with their PSNR (of the color over black, decoded by libavif and libjxl). PureJsImage's AVIF
  encoder has no quality option, and its JPEG XL decoder doesn't support everything libjxl's files use, which shows as
  failing. jsquash only encodes and decodes AVIF and JPEG XL (it gets the other inputs as pixels); @napi-rs/canvas
  decodes both with Skia's codecs, but doesn't encode them.
- Rendering: "${TEXT}" in Source Sans 3 at ${TEXT_SIZE}px, and \`tests/svgs/features.svg\` (gradients, clipping,
  CSS) at ${SVG_WIDTH} pixels wide. Jimp, image-js, PureJsImage and Photon can't render TrueType/OpenType fonts or SVGs;
  @napi-rs/canvas (Skia's SVG module) ignores its CSS, so it draws a little less.
- Every operation starts from the same decoded image and returns a new one: libraries that change images in place
  clone first, sharp runs a pipeline from raw pixels back to raw pixels, PureJsImage (which has no decoded images) one
  from a BMP back to a BMP, @napi-rs/canvas draws into a new canvas. PureJsImage has no blur, composite, rendering or
  animated GIFs.
- Where the library lets you choose, resizing is bilinear, blurring is
  gaussian with a radius or sigma of 5, rotating grows the image to fit. Each library uses its own defaults
  otherwise, e.g. its PNG compression level.
- Threads: ImageScript uses worker threads where they pay off (the processors available, at most 8), and sharp gets
  as many (\`sharp.concurrency()\`; its default on glibc Linux without jemalloc, like on CI, is one). The other
  libraries run on one thread (jsquash turns its threaded builds off in Node).
- [tinybench](https://github.com/tinylibs/tinybench), at least 1.5 seconds and 3 runs per measurement, every library
  in its own process.
- The release workflow runs the benchmark for every release and commits the results, on a GitHub Actions runner;
  runners vary, so compare libraries within one run rather than between runs.
- Install sizes: \`npm install <library>\` in an empty project, the apparent size of \`node_modules\`.

Run it: \`npm install\` in this directory, then \`node run.js\` (on an idle machine; \`IMAGESCRIPT=local\` measures
this checkout after \`npm run build\` instead of the version from npm), \`node installs.js\` and \`node report.js\`.
`;
fs.writeFileSync(new URL('./README.md', import.meta.url), readme);
console.log('charts/ and README.md written');
