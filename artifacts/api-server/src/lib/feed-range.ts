export function byteRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return { start: 0, end: size - 1 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return null;
  if ([m[1], m[2]].some(n => n && !Number.isSafeInteger(Number(n)))) return null;
  const suffix = !m[1];
  if (suffix && Number(m[2]) <= 0) return null;
  const start = suffix ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = suffix || !m[2] ? size - 1 : Math.min(Number(m[2]), size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : null;
}
