const panic = message => {
    console.error(message);
    process.exit(1);
};

// resvg's test cases of the filter primitives (tests/svgs/resvg/filters/fe*), compared like in svg.js
(async () => {
    await require('./util/resvg')(file => file.startsWith('filters/fe'), panic);
})();

// feDisplacementMap applies its scale once (resvg multiplies by it twice) and reads the map's colors unpremultiplied,
// like browsers: a map of R = 1 (half transparent) moves every pixel's source 0.5 * scale to the right
(async () => {
    const {Image, Colors} = require('..');
    const svg = opacity => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
        <filter id="f" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
            <feFlood flood-color="#ff8000" flood-opacity="${opacity}" result="map"/>
            <feDisplacementMap in="SourceGraphic" in2="map" scale="20" xChannelSelector="R" yChannelSelector="A"/>
        </filter>
        <rect x="40" y="0" width="20" height="20" fill="#000" filter="url(#f)"/></svg>`;
    for (const opacity of [1, 0.5]) {
        const image = await Image.renderSVG(svg(opacity));
        // y offset: (alpha - 0.5) * 20, 10 rows down at opacity 1, none at 0.5; x: the rect drawn 10 pixels left
        const row = opacity === 1 ? 5 : 10;
        const covered = [...Array(100).keys()].filter(x => Colors.toRGBA(image.getPixelAt(x, row))[3] > 128);
        if (covered[0] !== 30 || covered.at(-1) !== 49) panic(`feDisplacementMap (map opacity ${opacity}): covers ${covered[0]}-${covered.at(-1)}, not 30-49`);
    }
})();
