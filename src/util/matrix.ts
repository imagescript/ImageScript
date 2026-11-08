/** A 2D affine transform as SVG writes it, `matrix(a b c d e f)`: [a, b, c, d, e, f] */
export type Matrix = number[];

/** The transform that leaves everything where it is */
export const IDENTITY: Readonly<Matrix> = [1, 0, 0, 1, 0, 0];

/** The transform that applies `b` first, then `a` (the product a x b) */
export function multiply(a: Matrix, b: Matrix): Matrix {
    return [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
    ];
}

/** The transform that undoes `m`, null when there is none (it flattens everything, or isn't finite) */
export function invert(m: Matrix): Matrix | null {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det || !isFinite(det)) return null;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
