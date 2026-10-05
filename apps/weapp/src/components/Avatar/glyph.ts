/** 字形头像上的那个字：去掉首尾空白后的第一个字（按码点取，不把一个表情劈成两半）；没有字时是空串 */
export function firstGlyph(text: string | undefined): string {
  return Array.from((text ?? "").trim())[0] ?? "";
}
