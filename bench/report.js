// Turns results.json (run.js) and installs.json (installs.js) into charts/*.svg and README.md
import fs from 'node:fs';

const results = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
const installs = JSON.parse(fs.readFileSync(new URL('./installs.json', import.meta.url)));
const { libraries, TEXT, TEXT_SIZE, SVG_WIDTH, WEBP_QUALITY, AVIF_QUALITY, JXL_QUALITY } = await import('./libs.js');
const quality = results.quality ?? {};
const LIBS = libraries.map(l => l.name);
const KIND = Object.fromEntries(libraries.map(l => [l.name, l.kind]));
const HIGHLIGHT = 'ImageScript';
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
const bytes = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`;


// the tasks in sections: every codec's decoding together, then encoding (with AVIF, JPEG XL and animated GIFs), then
// the operations and rendering
const SECTIONS = [
    ['Decoding', [['decode JPEG', 'JPEG'], ['decode PNG', 'PNG'], ['decode WebP', 'WebP (lossy)'], ['decode AVIF', 'AVIF'],
        ['decode JPEG XL', 'JPEG XL'], ['decode GIF', 'animated GIF'], ['decode animated WebP', 'animated WebP']]],
    ['Encoding', [['encode JPEG', 'JPEG (quality 80)'], ['encode PNG', 'PNG'], ['encode WebP lossy', `WebP (quality ${WEBP_QUALITY})`],
        ['encode WebP', 'WebP (lossless)'], ['encode AVIF', `AVIF (quality ${AVIF_QUALITY})`], ['encode JPEG XL', `JPEG XL (quality ${JXL_QUALITY})`],
        ['encode JPEG XL lossless', 'JPEG XL (lossless)'], ['encode GIF', 'animated GIF'], ['encode animated WebP', `animated WebP (q ${WEBP_QUALITY})`]]],
    ['Image operations', [['resize', 'resize to half'], ['resizeBicubic', 'resize to half, bicubic'], ['cover', 'thumbnail (cover 400×400)'],
        ['crop', 'crop'], ['rotate', 'rotate by 30°'], ['rotate90', 'rotate by 90°'], ['flip', 'flip'], ['blur', 'blur (radius 5)'],
        ['sharpen', 'sharpen'], ['composite', 'composite an overlay'], ['greyscale', 'greyscale'], ['adjust', 'brightness and contrast']]],
    ['Rendering', [['text', 'render text'], ['svg', 'render SVG']]],
    ['HDR photos', [['hdr thumbnail', 'thumbnail, keeping HDR']]]
].map(([section, tasks]) => [section, tasks.filter(([key]) => results.speed[key])]);
// (the tables' labels name the operation too)
const SPEED = SECTIONS.flatMap(([section, tasks]) => tasks.map(([key, label]) =>
    [key, section === 'Decoding' ? `decode ${label}` : section === 'Encoding' ? `encode ${label}` : label]));
const cpu = results.cpu.replace(/\((R|TM)\)|\bCPU\b|@.*$/g, '').replace(/\s+/g, ' ').trim();

// (AVIF and JPEG XL with their PSNR: the libraries' quality scales differ)
const sizeLabel = key => key.replace(/ JPEG$/, ' JPEG (q 80)').replace(/ WebP$/, ' WebP').replace(' WebP lossy', ` WebP (q ${WEBP_QUALITY})`)
    .replace(' AVIF', ` AVIF (q ${AVIF_QUALITY})`).replace(/ JPEG XL$/, ` JPEG XL (q ${JXL_QUALITY})`).replace(' JPEG XL lossless', ' JPEG XL')
    .replace('animation GIF', 'animated GIF').replace('animation WebP', `animated WebP (q ${WEBP_QUALITY})`);
const sizeText = (key, lib) => bytes(results.sizes[key][lib]) + (quality[key]?.[lib] === 'lossless' ? ', identical pixels' : quality[key]?.[lib] ? `, ${quality[key][lib]} dB` : '');

/**
 * Rows of results by libraries, each cell a value colored by a level (0 best .. 4 worst), `null` for a grey cell
 * (shown, but not ranked); libraries without a value get a dash
 * @param rows [{ label, cells: { library: { text, level } } }]
 * @param legend [[text, level]]: level -1 is the dash, null a grey cell
 */
function grid(file, libs, title, subtitle, rows, legend, note, extra) {
    const pad = 20, labelW = 190, headH = 62, rowH = 26, gap = 3, cellW = 118, extraW = extra ? 215 : 0;
    const W = pad * 2 + labelW + libs.length * cellW + extraW;
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
    const ex = pad + labelW + libs.length * cellW + 14;
    if (extra) {
        body += `<text class="text bold" x="${ex}" y="${top + 24}">${esc(extra.title)}</text>`;
        body += `<text class="muted small" x="${ex}" y="${top + 42}">${esc(extra.subtitle)}</text>`;
    }
    rows.forEach(({ label, cells, section, extra: value }, row) => {
        const y = top + headH + row * rowH;
        if (section) {
            body += `<text class="text title" x="${pad}" y="${y + rowH / 2 + 8}">${esc(section)}</text>`;
            if (row) body += `<line class="grid" x1="${pad}" x2="${W - pad}" y1="${y + 4}" y2="${y + 4}" stroke-width="1"/>`;
            return;
        }
        if (value) body += `<text class="${value.ahead ? 'text bold' : 'muted'}" x="${ex}" y="${y + rowH / 2 + 4}">${esc(value.text)}</text>`;
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

// (PureJsImage's AVIF encoder has no quality option: its speed comes with much larger files of lower quality)
function avifNote() {
    const size = results.sizes['photo AVIF'], db = quality['photo AVIF'];
    if (!size?.PureJsImage || !size[HIGHLIGHT]) return undefined;
    return `encode AVIF: PureJsImage's encoder has no quality setting, its file is ${bytes(size.PureJsImage)} at ${db.PureJsImage} dB (ImageScript: ${bytes(size[HIGHLIGHT])} at ${db[HIGHLIGHT]} dB)`;
}

// speed: each cell the time of one operation, by how far it is from the fastest of its row (log scale-like steps)
// (with section headers; versus: the libraries the last column compares ImageScript to, by speed)
const speedRows = (libs, versus) => SECTIONS.flatMap(([section, tasks]) => {
    const rows = tasks.filter(([key]) => libs.some(lib => results.speed[key][lib])).map(([key, label]) => speedRow(key, label, libs, versus));
    return rows.length ? [{ section }, ...rows] : [];
});
function speedRow(key, label, libs, versus) {
    const best = Math.min(...libs.map(lib => results.speed[key][lib]).filter(r => r && !r.error).map(r => r.ms));
    const cells = {};
    for (const lib of libs) {
        const r = results.speed[key][lib];
        if (!r) continue;
        const slower = r.ms / best;
        cells[lib] = r.error ? { text: 'fails', level: null } : { text: duration(r.ms), level: slower < 1.1 ? 0 : slower < 2 ? 1 : slower < 4 ? 2 : slower < 10 ? 3 : 4 };
    }
    let extra;
    const ours = results.speed[key][HIGHLIGHT];
    const rivals = versus ? Object.entries(results.speed[key]).filter(([lib, r]) => versus(lib) && !r.error) : [];
    if (ours && !ours.error && rivals.length) {
        const [rival, r] = rivals.reduce((a, b) => b[1].ms < a[1].ms ? b : a);
        const ratio = r.ms / ours.ms;
        extra = { ahead: ratio >= 1, text: ratio >= 1.05 ? `${number(ratio)}× faster` : ratio > 0.95 ? `as fast (${rival})` : `${number(1 / ratio)}× slower (${rival})` };
    } else if (versus && ours && !ours.error) extra = { ahead: true, text: 'only ImageScript' };
    return { label, cells, extra };
}
const speedLegend = [['fastest', 0], ['< 2× slower', 1], ['2-4×', 2], ['4-10×', 3], ['> 10× slower', 4], ['not supported', -1]];
const timing = `time per operation, less is faster, colored by the distance to the fastest in each row · Node.js ${results.node.match(/\d+/)[0]}, ${cpu}`;
const native = LIBS.filter(lib => KIND[lib].startsWith('native'));
const portable = LIBS.filter(lib => !native.includes(lib));
const pureJS = lib => lib !== HIGHLIGHT && KIND[lib] === 'JavaScript';
grid('overview-portable.svg', portable, 'Libraries that run everywhere: JavaScript and WebAssembly', timing, speedRows(portable, pureJS), speedLegend,
    avifNote() && [avifNote()], { title: 'vs. pure JavaScript', subtitle: 'its fastest at each task' });
grid('overview-native.svg', [HIGHLIGHT, ...native], 'For reference: native libraries (Node.js only, platform-specific binaries)', timing, speedRows([HIGHLIGHT, ...native]), speedLegend);

// install size: on the same grid, one row each for the bytes and the packages
const installLevel = ratio => ratio < 1.1 ? 0 : ratio < 3 ? 1 : ratio < 10 ? 2 : ratio < 30 ? 3 : 4;
const installRow = (label, value, format) => {
    const least = Math.min(...LIBS.map(value));
    return { label, cells: Object.fromEntries(LIBS.map(lib => [lib, { text: format(value(lib)), level: installLevel(value(lib) / least) }])) };
};
// startup and memory: the same, against the least of each row (libraries without the job get a dash)
// (startup.js measures them, the charts leave them out until ImageScript's startup and memory are worked on)
const SHOW_STARTUP = false;
const startup = SHOW_STARTUP ? results.startup ?? {} : {};
const startupRow = (label, key, format) => {
    const libs = LIBS.filter(lib => startup[lib]?.[key] !== undefined), least = Math.min(...libs.map(lib => startup[lib][key]));
    const level = ratio => ratio < 1.25 ? 0 : ratio < 2 ? 1 : ratio < 4 ? 2 : ratio < 10 ? 3 : 4;
    return { label, cells: Object.fromEntries(libs.map(lib => [lib, { text: format(startup[lib][key]), level: level(startup[lib][key] / least) }])) };
};
const megabytes = mb => `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
grid('install.svg', LIBS, SHOW_STARTUP ? 'Install size, startup and memory' : 'Install size', `less is better, colored by the distance to the least in each row${SHOW_STARTUP ? ' · startup and memory: the median of 5 fresh processes' : ''}`,
    [...SHOW_STARTUP ? [{ section: 'Install' }] : [], installRow('size of node_modules', lib => installs[lib].bytes, bytes), installRow('packages', lib => installs[lib].packages, String),
        ...Object.keys(startup).length ? [{ section: 'Startup and memory' }, startupRow('time to first image', 'firstImageMs', duration),
            startupRow('memory for a job', 'jobMB', megabytes)] : []],
    [['least', 0], ['a little more', 1], ['more', 2], ['much more', 3], ['far more', 4], ...SHOW_STARTUP ? [['no such job', -1]] : []],
    ['npm install <library> in an empty project: all dependencies and the native binaries for this platform.', ...!SHOW_STARTUP ? [] : [
        'Time to first image: importing the library and a first job, cold, in a fresh process. The job: a 1920×1080 JPEG decoded, halved',
        'and encoded as a JPEG again (jsquash: AVIF and JPEG XL only). Memory: the peak resident set (heap, WebAssembly and native) of',
        'that job, over the process before it.']]);

// sizes: lossless files rank by size alone (they decode to the same pixels); lossy ones only among the files of about
// the same quality (within 1 dB PSNR of the best of the row): a smaller file of clearly lower quality isn't better
const QUALITY_BAND = 1;
const sizeLevel = ratio => ratio < 1.05 ? 0 : ratio < 1.25 ? 1 : ratio < 1.5 ? 2 : ratio < 2 ? 3 : 4;
const LOSSLESS = ['photo PNG', 'graphic PNG', 'photo WebP', 'graphic WebP', 'photo JPEG XL lossless', 'graphic JPEG XL lossless'];
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
    LOSSLESS.filter(key => results.sizes[key]).map(key => sizeRow(key, sizeLibs)), sizeLegend);
grid('sizes-lossy.svg', sizeLibs, 'File sizes: lossy, with their quality', `size and PSNR (more is better quality) · colored by size among the files within ${QUALITY_BAND} dB of the best quality of each row`,
    ['photo JPEG', 'graphic JPEG', 'photo WebP lossy', 'graphic WebP lossy', 'photo AVIF', 'graphic AVIF', 'photo JPEG XL', 'graphic JPEG XL', 'animation GIF', 'animation WebP'].filter(key => results.sizes[key]).map(key => sizeRow(key, sizeLibs)),
    [...sizeLegend, ['not comparable', null]],
    [`JPEG at quality 80, AVIF at ${AVIF_QUALITY} and JPEG XL at ${JXL_QUALITY} in every library; their quality scales differ, so the files differ in quality too.`,
        `Grey: more than ${QUALITY_BAND} dB below the best quality of its row, or the only file at that quality (a smaller file of lower quality isn't comparable).`,
        'The GIF: the 256-color animation re-encoded; "identical" keeps every pixel, lower values are lossy re-quantizations.']);


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

<img src="charts/overview-native.svg" alt="Time per operation of ImageScript and the native libraries">

<img src="charts/install.svg" alt="Install size of each library">

<img src="charts/sizes-lossless.svg" alt="Lossless file sizes">

<img src="charts/sizes-lossy.svg" alt="Lossy file sizes with their quality">

## Numbers

Time per operation (less is faster), measured ${results.date} with Node.js ${results.node} on ${results.cpu}, ImageScript ${results.versions['ImageScript']}.

${table(SPEED, LIBS, speedCell)}

Encoded sizes:

${table(Object.keys(results.sizes).map(k => [k, k]), LIBS, (key, lib) => results.sizes[key][lib] ? sizeText(key, lib) : '–')}

| | ${LIBS.map(l => `**${l}**`).join(' | ')} |
|---|${LIBS.map(() => '---').join('|')}|
| kind | ${LIBS.map(l => KIND[l]).join(' | ')} |
| package | ${LIBS.map(l => `\`${installs[l].package}\``).join(' | ')} |
| install size | ${LIBS.map(l => bytes(installs[l].bytes)).join(' | ')} |
| packages | ${LIBS.map(l => installs[l].packages).join(' | ')} |
${Object.keys(startup).length ? [['import, until usable', 'importMs', duration], ['time to first image', 'firstImageMs', duration],
        ['memory for a job', 'jobMB', megabytes]].map(([label, key, format]) => `| ${label} | ${LIBS.map(l => startup[l]?.[key] !== undefined ? format(startup[l][key]) : '–').join(' | ')} |`).join('\n') + '\n' : ''}
## Method

- Inputs (in \`inputs/\`, sources in [inputs/SOURCES.md](inputs/SOURCES.md)): a 1920×1080 photo (JPEG, and made from it
  when the benchmark starts, PNG, lossy WebP, AVIF by sharp (libaom) and JPEG XL by jsquash (libjxl), at the
  qualities below), a 1434×1434 graphic with transparency (PNG), a 445×445 diagram with transparency placed on
  the photo (PNG), a 300×300 GIF with 101 frames (and made from it, an animated WebP by sharp at quality ${WEBP_QUALITY}).
- Lossy WebP, AVIF and JPEG XL are encoded at the same nominal quality (${WEBP_QUALITY}, ${AVIF_QUALITY} and ${JXL_QUALITY}); as the libraries'
  scales differ, the file sizes come with their PSNR (of the color over black, decoded by libwebp, libavif and
  libjxl). jsquash's libjxl runs at the effort ImageScript's default matches (cjxl's 5 lossy, 3 lossless; its own
  default is 7). PureJsImage's AVIF
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
- Where the library lets you choose, resizing is bilinear (or bicubic, in its own row), the thumbnail covers 400×400
  (cropping the sides), blurring is gaussian with a radius or sigma of 5, sharpening an unsharp mask of radius or
  sigma 1 (Photon: its 3×3 sharpening kernel), rotating by 30° grows the image to fit, brightness and contrast go up
  20% (Jimp's and Photon's scales converted). image-js's and sharp's greyscale make one grey channel (and alpha). Each library uses its own defaults
  otherwise, e.g. its PNG compression level.
- Threads: ImageScript uses worker threads where they pay off (the processors available, at most 8), and sharp gets
  as many (\`sharp.concurrency()\`; its default on glibc Linux without jemalloc, like on CI, is one). The other
  libraries run on one thread (jsquash turns its threaded builds off in Node).
- [tinybench](https://github.com/tinylibs/tinybench), at least 1.5 seconds and 3 runs per measurement, every library
  in its own process.
- The release workflow runs the benchmark for every release and commits the results, on a GitHub Actions runner;
  runners vary, so compare libraries within one run rather than between runs.
- Install sizes: \`npm install <library>\` in an empty project, the apparent size of \`node_modules\`.
${SHOW_STARTUP ? `- Startup and memory (\`startup.js\`): each library alone in a fresh process, 5 times, the medians. Time to first
  image: the import (until the library can be used; jsquash: its four codecs compiled) and a first job, a 1920×1080
  JPEG decoded, halved and encoded as a JPEG again. Memory: the peak resident set (the V8 heap, WebAssembly memories
  and native allocations alike) of that first job, over the process before it.
` : ''}
Run it: \`npm install\` in this directory, then \`node run.js\` (on an idle machine; \`IMAGESCRIPT=local\` measures
this checkout after \`npm run build\` instead of the version from npm; it runs \`startup.js\` too), \`node installs.js\` and \`node report.js\`.
`;
fs.writeFileSync(new URL('./README.md', import.meta.url), readme);
console.log('charts/ and README.md written');
