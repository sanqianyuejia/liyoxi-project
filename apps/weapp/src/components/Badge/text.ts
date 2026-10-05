/** 数字角标上显示什么：不大于 0 或不是数的不显示（null）；超过 max 的写成“max+” */
export function badgeText(count: number | undefined, max = 99): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > max ? `${max}+` : String(whole);
}
