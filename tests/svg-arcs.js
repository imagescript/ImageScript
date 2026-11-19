const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');

// arcs between far-apart ends get a radius of half their distance, and were drawn with as many curves as it takes, and
// flattened to as many points: a 139-byte path ran the process out of memory. Each case runs in its own process with 1
// GB of heap, so that a failure can't take the test runner with it
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = body => `<svg viewBox="0 0 200 200" width="200" height="200" ${NS}>${body}</svg>`;
const cases = {
    'stroked arc from 1e25': svg('<path d="M 1e25 100 A 40 30 20 1 1 160 100" fill="none" stroke="red"/>'),
    'stroked arc from 301e30': svg('<path d="M 301e30 100 A 40 30 20 1 1 160 100" fill="none" stroke="red"/>'),
    '1000 arcs between 1e12 and -1e12': svg(`<path d="M -1e12 100${Array.from({length: 1000}, (_, i) => i & 1 ? 'A1 1 0 1 1-1e12 100' : 'A1 1 0 1 1 1e12 100').join('')}" fill="none" stroke="red"/>`),
    '20000 arcs between 1e30 and -1e30': svg(`<path d="M -1e30 100${Array.from({length: 20000}, (_, i) => i & 1 ? 'A1 1 0 1 1-1e30 100' : 'A1 1 0 1 1 1e30 100').join('')}"/>`),
    'circle of radius 1e30': svg('<circle cx="100" cy="100" r="1e30" fill="none" stroke="red"/>'),
};

const panic = message => {
    console.error(message);
    process.exit(1);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-arcs-'));
const [command, ...flags] = typeof Deno !== 'undefined' ? [process.execPath, 'run', '-A', '--v8-flags=--max-old-space-size=1024'] : [process.execPath, ...(process.versions.bun ? [] : ['--max-old-space-size=1024'])];
try {
    for (const [name, document] of Object.entries(cases)) {
        const file = path.join(dir, 'case.svg');
        fs.writeFileSync(file, document);
        const begin = Date.now();
        let output;
        try {
            output = JSON.parse(child_process.execFileSync(command, [...flags, './tests/util/render-svg.js', file], {timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim());
        } catch (err) {
            panic(`${name}: crashed (${err.signal || err.status})`);
        }
        if (output.result !== 'ok' && !/too complex/.test(output.result)) panic(`${name}: ${output.result}`);
        if (output.mb > 768) panic(`${name}: took ${output.mb} MB`);
        if (Date.now() - begin > 20000) panic(`${name}: took ${Date.now() - begin} ms`);
        console.log(name, output.result.slice(0, 60), Date.now() - begin, 'ms', output.mb, 'MB');
    }
} finally {
    fs.rmSync(dir, {recursive: true, force: true});
}
