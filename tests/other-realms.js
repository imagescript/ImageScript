const vm = require('vm');
const {Image, ImageType} = require('..');

const panic = message => {
	console.error(message);
	process.exit(1);
};

// values made in another realm (a vm context, an iframe, Jest's environment) are accepted like local ones: instanceof
// is false for them
(async () => {
	if (typeof Deno !== 'undefined' || process.versions.bun) return; // (node:vm contexts)
	const context = vm.createContext({});
	const png = await new Image(2, 2).fill(0xff0000ff).encodePNG();
	const buffer = vm.runInContext(`new ArrayBuffer(${png.length})`, context);
	new Uint8Array(buffer).set(png);
	for (const [name, data] of [['ArrayBuffer', buffer], ['Uint8Array', vm.runInContext('b => new Uint8Array(b)', context)(buffer)]]) {
		const image = await Image.decode(data).catch(err => err);
		if (!(image instanceof Image) || image.getPixelAt(0, 0) !== 0xff0000ff) panic(`${name} of another realm: ${image}`);
		if (ImageType.getType(data) !== 'png') panic(`ImageType.getType(${name} of another realm)`);
	}
	// objects that only claim to be one by their tag are not
	for (const [name, fake] of [['ArrayBuffer', {[Symbol.toStringTag]: 'ArrayBuffer', byteLength: 8}], ['SharedArrayBuffer', {[Symbol.toStringTag]: 'SharedArrayBuffer', byteLength: 8}], ['proxied ArrayBuffer', new Proxy(new ArrayBuffer(8), {})]]) {
		const err = await Image.decode(fake).then(() => null, err => err);
		if (!(err instanceof TypeError) || !/^Binary data has to be/.test(err.message)) panic(`a fake ${name}: ${err}`);
	}
	const fakeDate = await new Image(1, 1).encodePNG({metadata: {creationTime: {[Symbol.toStringTag]: 'Date'}}}).then(() => null, err => err);
	if (!(fakeDate instanceof TypeError) || !/^creationTime must be a Date/.test(fakeDate.message)) panic(`a fake Date: ${fakeDate}`);
	// a detached buffer (transferred to a worker) is said to be one
	const detached = png.buffer.slice(0), detachedView = new Uint8Array(detached);
	structuredClone(detached, {transfer: [detached]});
	for (const data of [detached, detachedView]) {
		const err = await Image.decode(data).then(() => null, err => err);
		if (!(err instanceof TypeError) || !/detached/.test(err.message) || !/^Binary data/.test(err.message)) panic(`a detached buffer: ${err}`);
	}
	const date = vm.runInContext('new Date(Date.UTC(2020, 1, 1))', context);
	const file = await new Image(1, 1).encodePNG({metadata: {creationTime: date}}).catch(err => err);
	if (!(file instanceof Uint8Array) || !Buffer.from(file).toString('latin1').includes('2020')) panic(`a Date of another realm: ${file}`);
})();
