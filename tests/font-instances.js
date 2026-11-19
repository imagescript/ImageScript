const fs = require('fs');

const panic = message => {
    console.error(message);
    process.exit(1);
};

// the instances of a variable font (one for each weight, and each size for a font with an optical size axis) are kept
// in a bounded number, the least recently used dropped: a chart of 5 sizes and 4 weights is 20 instances, and rebuilt
// each time it took 3 times as long. A new weight each render doesn't grow memory without end
(async () => {
    const {Font} = await import('../dist/render/font.js');
    const font = new Font(fs.readFileSync(`${__dirname}/fonts/resvg/RobotoFlex.subset.ttf`));
    const used = [];
    for (let size = 0; size < 5; size++) for (let weight = 0; weight < 4; weight++) used.push(font.withVariations({opsz: 12 + size * 6, wght: 300 + weight * 200}));
    if (new Set(used).size !== 20) panic(`20 combinations should be 20 instances, not ${new Set(used).size}`);
    for (let round = 0; round < 3; round++) {
        let i = 0;
        for (let size = 0; size < 5; size++) for (let weight = 0; weight < 4; weight++) {
            if (font.withVariations({opsz: 12 + size * 6, wght: 300 + weight * 200}) !== used[i++]) panic(`round ${round}: an instance of 20 was rebuilt`);
        }
    }
    // a hot instance stays while new ones come: one used between every two new weights isn't dropped
    const hot = font.withVariations({wght: 900});
    for (let i = 0; i < 500; i++) {
        font.withVariations({wght: 100 + i * 1.5});
        if (font.withVariations({wght: 900}) !== hot) panic(`the instance in use was dropped after ${i} new weights`);
    }
    // and 500 weights kept no more than a bounded number
    if (font.instances.size > 64) panic(`${font.instances.size} instances kept`);
})();
