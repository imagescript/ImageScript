---
group: Examples
---

# Shrink images before upload

A phone photo is 3 to 6 MB, and the server usually wants a fraction of that. Shrinking the image in the browser before
it is uploaded saves bandwidth, and on a slow connection it saves the user's time. The browser's own way is a canvas:
draw the image on it, scale it, call `canvas.toBlob()`. ImageScript does the same in plain TypeScript, and the page
below is all it takes:

```html
<!doctype html>
<meta charset="utf-8">
<input type="file" id="file" accept="image/*">
<p id="info"></p>
<img id="preview" alt="" style="max-width: 100%">

<script type="module">
import { Image, LimitError } from 'https://cdn.jsdelivr.net/npm/imagescript@4/+esm';

// the image's longest side becomes at most `maxSize` pixels; the result is a WebP file
async function shrink(file, { maxSize = 1600, quality = 80 } = {}) {
  const image = await Image.decode(await file.arrayBuffer()); // turns the picture upright, as the Exif data says
  if (Math.max(image.width, image.height) > maxSize) {
    image.resize({ width: maxSize, height: maxSize, fit: 'inside' });
  }
  return new Blob([await image.encodeWebP({ quality })], { type: 'image/webp' });
}

const kilobytes = (bytes) => `${Math.round(bytes / 1000)} kB`;
const info = document.getElementById('info');
const preview = document.getElementById('preview');

document.getElementById('file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  info.textContent = 'Shrinking…';
  try {
    const blob = await shrink(file);
    info.textContent = `${kilobytes(file.size)} → ${kilobytes(blob.size)}`;
    preview.src = URL.createObjectURL(blob);
    // await fetch('/upload', { method: 'POST', body: blob });
  } catch (error) {
    info.textContent = error instanceof LimitError ? 'That image is too large.' : `Can't read that image: ${error.message}`;
  }
});
</script>
```

Save it as an `.html` file and open it from a web server (the browser doesn't run modules from `file://`). Choosing a
photo shows the size before and after and the result; the commented `fetch()` is where the upload goes.

## What you get

- **The same file in every browser.** `canvas.toBlob(callback, 'image/jpeg', 0.8)` runs the browser's own encoder, and
  the encoders differ: for the same photo the JPEG was 246 kB in Chromium, 280 kB in Firefox and 286 kB in Safari's
  engine. ImageScript makes the same bytes everywhere (234 kB), so a quality setting means the same thing for every
  user, and you can test it once.
- **Formats the browser can't encode.** Asking a canvas for `'image/avif'` gives a PNG instead, in Chromium, Firefox
  and WebKit, without an error: a 3.3 MB photo came back as a PNG of 2.9 to 3.8 MB, depending on the browser. ImageScript encodes AVIF and JPEG XL as well
  as WebP and JPEG, though AVIF takes several seconds for a photo, so it suits a worker or a server better.
- **Metadata that stays out.** The result carries none of the photo's Exif data (location, camera, time). The only
  metadata is the name of the software, `ImageScript`, which `metadata: { software: null }` leaves out.
- **Limits that protect the page.** A file whose pixels would not fit in memory throws a `LimitError` before it is
  decoded (`maxPixels`, 16383 × 16383 by default), so an enormous image can't freeze the tab.

## Keeping the page responsive

Decoding, resizing and encoding a 12-megapixel photo takes about a second of CPU time on a desktop (longer on a phone),
and the page above does it on the main thread, so it stops reacting for that long. For anything beyond a demo, run the
work in a worker, as below. The script is about 1.05 MB (438 kB compressed) and the browser keeps it after the first visit.

## In a worker

With a bundler (Vite, webpack, esbuild), the work moves off the main thread:

```js
// shrink.worker.js
import { Image } from 'imagescript';

self.onmessage = async ({ data: { buffer, maxSize, quality } }) => {
  const image = await Image.decode(buffer);
  if (Math.max(image.width, image.height) > maxSize) {
    image.resize({ width: maxSize, height: maxSize, fit: 'inside' });
  }
  const bytes = await image.encodeWebP({ quality });
  self.postMessage(bytes, [bytes.buffer]);
};
```

```js
// in the page
const worker = new Worker(new URL('./shrink.worker.js', import.meta.url), { type: 'module' });

function shrink(file, maxSize = 1600, quality = 80) {
  return new Promise(async (resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(new Blob([data], { type: 'image/webp' }));
    worker.onerror = reject;
    const buffer = await file.arrayBuffer();
    worker.postMessage({ buffer, maxSize, quality }, [buffer]);
  });
}
```

A page that is [cross-origin isolated](https://developer.mozilla.org/docs/Web/API/Window/crossOriginIsolated) also
lets the AVIF and lossless WebP encoders use several threads (the `threads` option): a photo like the one above takes
3 to 4 seconds as AVIF with threads, and 6 to 16 seconds without.

## Pictures that aren't stills

An animated GIF or WebP isn't a single image: `Image.decode()` takes its first frame. To keep the animation, leave
such files as they are (`if (file.type === 'image/gif') return file;`) or use {@link decode}, which returns an
{@link Animation} for them, and encode the frames again.
