// the @example blocks of the doc comments run: each one against the names the docs use for its inputs (a decoded photo
// as `image`, an overlay, the bytes of a JPEG, a GIF, a font and a PNG)
const fs = require('fs');
const {Image, Frame, Animation, Colors, GainMap} = require('..');

const panic = msg => {
    console.error(msg);
    process.exit(1);
};

// the examples of a source file: the fenced blocks of every `@example` tag
function examples(file) {
    const found = [];
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*\* @example\s*$/.test(lines[i])) continue;
        const code = [];
        let fenced = false;
        for (i++; i < lines.length && !/^\s*\*\/|^\s*\* @/.test(lines[i]); i++) {
            const line = lines[i].replace(/^\s*\* ?/, '');
            if (line.startsWith('```')) { fenced = !fenced; continue; }
            if (fenced) code.push(line);
        }
        i--;
        found.push({file, line: i, code: code.join('\n')});
    }
    return found;
}

(async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const photo = await Image.decode(fs.readFileSync('./bench/inputs/photo.jpg'));
    const small = photo.clone().crop(700, 300, 400, 300);
    const inputs = {
        bytes: await small.encodeJPEG(),
        gifBytes: fs.readFileSync('./bench/inputs/animation.gif'),
        fontBytes: fs.readFileSync('./tests/fonts/sourcesans3 regular.otf'),
        logoPNG: await new Image(16, 16).fill(0x336699ff).encodePNG()
    };

    const files = fs.readdirSync('./src').filter(f => f.endsWith('.ts')).map(f => './src/' + f);
    const all = files.flatMap(examples);
    if (all.length < 10) panic(`doc examples: only ${all.length} found, the extraction is broken`);
    for (const example of all) {
        // a fresh image and overlay for each example, which runs in a block of its own (so it can declare its own names)
        const image = small.clone(), overlay = new Image(80, 60).fill((x, y) => Colors.fromRGBA(255, x * 3, y * 4, 200));
        const names = ['Image', 'Frame', 'Animation', 'Colors', 'GainMap', 'image', 'overlay', ...Object.keys(inputs)];
        try {
            await new AsyncFunction(...names, `{\n${example.code}\n}`)(Image, Frame, Animation, Colors, GainMap, image, overlay, ...Object.values(inputs));
        } catch (error) {
            panic(`doc example ${example.file}:${example.line} failed: ${error.stack ?? error}\n${example.code}`);
        }
    }
    console.log(`${all.length} doc examples ran`);
})().catch(e => panic(e.stack ?? e));
