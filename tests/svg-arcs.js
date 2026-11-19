const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// Curves between far-apart points: an arc's radius grows to half the distance of its ends, and the number of curves
// and points it was drawn with grew with the radius, without a limit: a 139-byte path killed the process with an out
// of memory error. Each renders, or throws a LimitError, in a bounded time and memory (in a process of its own, which
// can die without taking this one along)
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = shape => `<svg viewBox="0 0 200 200" ${NS}>${shape}</svg>`;
let many = 'M -1e12 100';
for (let i = 0; i < 1000; i++) many += i & 1 ? ' A 1 1 0 0 1 -1e12 100' : ' A 1 1 0 0 1 1e12 100';
const cases = {
    'stroked arc from 1e25': svg('<path d="M 1e25 100 A 40 30 20 1 1 160 100" fill="none" stroke="gray"/>'),
    'filled arc from 1e25': svg('<path d="M 1e25 100 A 40 30 20 1 1 160 100"/>'),
    'stroked arc from 301e30': svg('<path d="M 301e30 100 A 40 30 20 1 1 160 100" fill="none" stroke="gray"/>'),
    'arc from 1e300': svg('<path d="M 1e300 100 A 40 30 20 1 1 160 100" fill="none" stroke="gray"/>'),
    'arc of radius 1e300': svg('<path d="M 10 10 A 1e300 1e300 0 1 1 20 20" fill="none" stroke="gray"/>'),
    '1000 arcs between 1e12 and -1e12': svg(`<path d="${many}" fill="none" stroke="red"/>`),
    'circle of radius 1e30': svg('<circle cx="100" cy="100" r="1e30" fill="none" stroke="red"/>'),
    // many such arcs in one path: their curves were made while the path was read, before any budget counted them
    '20000 arcs between 1e30 and -1e30': svg(`<path d="M -1e30 100${Array.from({length: 20000}, (_, i) => i & 1 ? 'A1 1 0 1 1-1e30 100' : 'A1 1 0 1 1 1e30 100').join('')}"/>`),
    '100000 arcs between 1e12 and -1e12': svg(`<path d="M -1e12 100${Array.from({length: 100000}, (_, i) => i & 1 ? 'A1 1 0 1 1-1e12 100' : 'A1 1 0 1 1 1e12 100').join('')}" fill="none" stroke="red"/>`),
    // many different long paths in SVGs embedded as images: the paths read were kept until the render ended
    'many long paths in embedded SVGs': (() => {
        const body = 'L1 1L0 0'.repeat(50000);
        const uri = k => {
            let s = `<svg ${NS} width="10" height="10">`;
            for (let p = 0; p < 40; p++) s += `<path d="M${k} ${p}${body}" fill="none"/>`;
            return 'data:image/svg+xml;base64,' + require('zlib').gzipSync(s + '</svg>', {level: 9}).toString('base64');
        };
        return `<svg viewBox="0 0 10 10" width="10" height="10" ${NS}>${Array.from({length: 8}, (_, k) => `<image href="${uri(k)}" width="10" height="10"/>`).join('')}</svg>`;
    })(),
    // a long path a textPath follows, through <use>: measuring the path for each copy wasn't counted
    'textPath through use': (() => {
        let defs = `<path id="p" d="M0 0${'L1 1L0 0'.repeat(20000)}"/><g id="g0"><text font-size="1" fill="none"><textPath href="#p">A</textPath></text></g>`;
        for (let i = 1; i <= 4; i++) defs += `<g id="g${i}">${`<use href="#g${i - 1}"/>`.repeat(10)}</g>`;
        return `<svg viewBox="0 0 10 10" width="10" height="10" ${NS}><defs>${defs}</defs>${'<use href="#g4"/>'.repeat(9)}</svg>`;
    })(),
    // a path a textPath follows that is longer than a path may be
    'textPath along a too long path': `<svg viewBox="0 0 10 10" width="10" height="10" ${NS}><defs><path id="p" d="M0 0${'L1 1L0 0'.repeat(1100000)}"/></defs><text font-size="1"><textPath href="#p">A</textPath></text></svg>`,
    // long text in a clip path and as text: its glyphs were collected with spreads, past the call stack's limit
    'long text in a clip path': `<svg ${NS} width="10" height="10"><clipPath id="c"><text font-size="1" y="5">${'W'.repeat(50000)}</text></clipPath><rect width="10" height="10" clip-path="url(#c)"/></svg>`,
    'long text': `<svg ${NS} width="10" height="10"><text font-size="1" y="5">${'W'.repeat(50000)}</text></svg>`,
    // a path of lines only, drawn 90000 times through <use> without painting anything: no budget counted its points
    'lines through use': (() => {
        let defs = `<path id="g0" d="M0 0${'h1h-1'.repeat(50000)}" fill="none"/>`;
        for (let i = 1; i <= 4; i++) defs += `<g id="g${i}">${`<use href="#g${i - 1}"/>`.repeat(10)}</g>`;
        return `<svg viewBox="0 0 10 10" width="10" height="10" ${NS}><defs>${defs}</defs>${'<use href="#g4"/>'.repeat(9)}</svg>`;
    })()
};
const [command, ...flags] = typeof Deno !== 'undefined' ? [process.execPath, 'run', '-A', '--v8-flags=--max-old-space-size=1024'] : [process.execPath, ...(process.versions.bun ? [] : ['--max-old-space-size=1024'])];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-arcs-'));
try {
    for (const [name, document] of Object.entries(cases)) {
        const file = path.join(directory, 'svg');
        fs.writeFileSync(file, document);
        const begin = Date.now();
        let output;
        try {
            output = JSON.parse(child_process.execFileSync(command, [...flags, './tests/util/render-svg.js', file], {timeout: 60000, maxBuffer: 1 << 24, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim());
        } catch (error) {
            panic(`${name}: ${error.signal === 'SIGTERM' ? 'hung for 60 s' : `crashed (${error.signal || `exit ${error.status}`})`}`);
        }
        if (output.result !== 'ok' && !output.result.startsWith('LimitError')) panic(`${name}: ${output.result}`);
        if (name === 'textPath along a too long path' && !output.result.startsWith('LimitError')) panic(`${name}: should throw a LimitError`);
        if (Date.now() - begin > 20000) panic(`${name}: took ${Date.now() - begin} ms`);
        if (output.mb > 768) panic(`${name}: took ${output.mb} MB`);
        console.log(name, output.result.slice(0, 60), `${Date.now() - begin} ms`, `${output.mb} MB`);
    }
} finally {
    fs.rmSync(directory, {recursive: true, force: true});
}
