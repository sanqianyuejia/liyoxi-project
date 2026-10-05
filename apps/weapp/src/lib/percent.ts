/** 进度取整到 0–100：不是数的按 0 算。进度条与上传格共用 */
export function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
