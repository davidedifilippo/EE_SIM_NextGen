/**
 * Dense LU factorization with partial pivoting, on a row-major matrix stored in place.
 * Returns false when the matrix is singular.
 */
export function luFactor(a: Float64Array, n: number, pivots: Int32Array): boolean {
  for (let k = 0; k < n; k++) {
    let best = k;
    let bestAbs = Math.abs(a[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const abs = Math.abs(a[r * n + k]);
      if (abs > bestAbs) {
        best = r;
        bestAbs = abs;
      }
    }
    if (bestAbs < 1e-18) return false;
    pivots[k] = best;

    if (best !== k) {
      for (let c = 0; c < n; c++) {
        const tmp = a[k * n + c];
        a[k * n + c] = a[best * n + c];
        a[best * n + c] = tmp;
      }
    }

    const pivot = a[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const factor = a[r * n + k] / pivot;
      if (factor === 0) continue;
      a[r * n + k] = factor;
      for (let c = k + 1; c < n; c++) a[r * n + c] -= factor * a[k * n + c];
    }
  }
  return true;
}

/** Solves in place using the output of luFactor. */
export function luSolve(a: Float64Array, n: number, pivots: Int32Array, b: Float64Array): void {
  // Every swap comes first: luFactor swaps whole rows, so the multipliers are already in final order
  for (let k = 0; k < n; k++) {
    const p = pivots[k];
    if (p !== k) {
      const tmp = b[k];
      b[k] = b[p];
      b[p] = tmp;
    }
  }
  for (let k = 0; k < n; k++) {
    for (let r = k + 1; r < n; r++) b[r] -= a[r * n + k] * b[k];
  }
  for (let k = n - 1; k >= 0; k--) {
    let sum = b[k];
    for (let c = k + 1; c < n; c++) sum -= a[k * n + c] * b[c];
    b[k] = sum / a[k * n + k];
  }
}
