/**
 * Gives a class a short form for `console.log()` (Node's `util.inspect`, Bun and Deno use the same symbol) and for
 * `JSON.stringify()`: the class' `toString()` and a few fields, not the pixels (an image of 12 megapixels would write
 * 12 million keys). Done to the prototype: a method with a symbol as its name can't be declared in a class body
 * @internal
 */
export function describe<T extends object>(type: new (...args: never[]) => T, json: (value: T) => object): void {
    Object.defineProperty(type.prototype, Symbol.for('nodejs.util.inspect.custom'), {
        value(this: T): string {
            return (this as { toString(): string }).toString();
        },
        writable: true,
        configurable: true
    });
    Object.defineProperty(type.prototype, 'toJSON', {
        value(this: T): object {
            return json(this);
        },
        writable: true,
        configurable: true
    });
}
