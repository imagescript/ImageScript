---
group: Examples
---

# Social cards for static sites

A link preview (the Open Graph image) is the picture a chat app or social network shows when someone shares a page.
Generating one per page usually means a headless browser or a hosted service. ImageScript renders text, gradients and
photos in plain TypeScript, so a card is a short build script: no browser, no native module, the same pixels on every
machine, and nothing to install in CI besides `npm install`.

This is a card the script made:

![A link preview: the title, a summary and the site with the date, on a dark purple gradient](./social-card-example.png)

## The script

This script writes one 1200×630 card for every Markdown post in `content/posts`, using the `title`, `description` and
`date` from the front matter. Save it as `scripts/social-cards.mjs`, put a font in `fonts/` (any TrueType, OpenType or
WOFF file; a variable font such as Inter gives the bold weight from one file) and run `node scripts/social-cards.mjs`.

```js
// One 1200×630 link preview per Markdown post: content/posts/<slug>.md -> public/og/<slug>.png
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Image } from 'imagescript';

const postsDir = 'content/posts';
const outDir = 'public/og';
const site = 'example.com';

// any TrueType, OpenType or WOFF font; a variable font gives the bold weight from the same file
const font = await readFile('fonts/Inter.ttf');
const width = 1200;
const height = 630;
const pad = 72;

// the background is the same for every card: make it once
const stops = [0x141821ff, 0x2a2350ff];
const background = Image.linearGradient(width, height, { stops, angle: 135 });

// front matter: the `key: value` lines between the two `---` lines at the top
function frontMatter(source) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  const pairs = block.split(/\r?\n/).map((line) => /^(\w+):\s*(.*)$/.exec(line)).filter(Boolean);
  return Object.fromEntries(pairs.map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, '$2')]));
}

async function card({ title, description, date }) {
  const image = background.clone();
  const footer = await Image.renderText(`${site}${date ? ` · ${date}` : ''}`, {
    font, size: 28, color: 0xf28db2ff, variations: { weight: 600 },
  });
  const summary = description && await Image.renderText(description, {
    font, size: 32, color: 0xb8bfd0ff, width: width - pad * 2, height: 100,
  });
  // the title in the largest size that leaves room for the summary and the footer
  const room = height - pad * 2 - footer.height - (summary ? summary.height + 28 : 0) - 28;
  let heading;
  for (let size = 72; size >= 40; size -= 4) {
    heading = await Image.renderText(title, {
      font, size, color: 0xffffffff, variations: { weight: 800 }, width: width - pad * 2,
    });
    if (heading.height <= room) break;
  }
  image.composite(heading, { x: pad, y: pad });
  if (summary) image.composite(summary, { x: pad, y: pad + heading.height + 28 });
  image.composite(footer, { x: pad, y: height - pad - footer.height });
  // compression level 1 is several times faster than the default, and only a little larger for flat graphics
  return image.encodePNG({ compression: 1 });
}

await mkdir(outDir, { recursive: true });
for (const file of (await readdir(postsDir)).filter((name) => name.endsWith('.md'))) {
  const slug = file.slice(0, -3);
  const target = `${outDir}/${slug}.png`;
  // keep the cards that are newer than their post
  const [post, existing] = await Promise.all([stat(`${postsDir}/${file}`), stat(target).catch(() => null)]);
  if (existing && existing.mtimeMs > post.mtimeMs) continue;
  const data = frontMatter(await readFile(`${postsDir}/${file}`, 'utf8'));
  const { title = slug, description, date } = data;
  await writeFile(target, await card({ title, description, date }));
  console.log('wrote', target);
}
```

A card takes about 30 milliseconds (Node.js 26 on a 2018 laptop CPU), so a site with hundreds of posts is done in
seconds. Cards that are newer than their post are skipped, and the title shrinks until it fits the card.

## Using it

Run the script before your site's build, for example `"build": "node scripts/social-cards.mjs && <your build>"`, and
point every page at its card:

```html
<meta property="og:image" content="https://example.com/og/hello-world.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

## Changing the design

- **A cover photo and an avatar:** decode them with {@link Image.decode}, size them with {@link Image.resize | resize}
  (`fit: 'cover'`), round them with {@link Image.roundCorners | roundCorners} or {@link Image.cropCircle | cropCircle}
  and place them with {@link Image.composite | composite}. The [Playground](https://try.imagescript.dev/) has this as the
  example "Open Graph Card", with a shadow and a glow behind the cover.
- **Other scripts and emoji:** `font` takes a list; every character comes from the first font that has it, for example
  `font: [inter, notoArabic, notoEmoji]`. A character that no font has is drawn as a box.
- **A logo:** render an SVG once with {@link Image.renderSVG} and composite it onto every card.

## At request time

The same `card()` function works in a request handler on any runtime that runs ImageScript. Mind the CPU time your
platform allows per request: a card like this one needs about 30 milliseconds, which is more than the 10 milliseconds of
Cloudflare Workers' free plan. For a static site, generating the cards at build time has no such limit.
