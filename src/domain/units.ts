const round1 = (n: number): number => {
  const r = Math.round(n * 10 + Number.EPSILON * Math.sign(n)) / 10;
  return r === 0 ? 0 : r; // avoid -0
};

export function toOz(bottles: number, oz: number, sizeOz: number): number {
  return round1(bottles * sizeOz + oz);
}

export function fromOz(
  totalOz: number,
  sizeOz: number,
): { bottles: number; oz: number } {
  const total = round1(totalOz);
  if (!Number.isFinite(sizeOz) || sizeOz <= 0 || !Number.isFinite(total) || total < 0) {
    return { bottles: 0, oz: Number.isFinite(total) ? total : totalOz };
  }
  const bottles = Math.floor(total / sizeOz + 1e-9);
  return { bottles, oz: round1(total - bottles * sizeOz) };
}

export function parseNum(input: string): number {
  const n = parseFloat(input.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
