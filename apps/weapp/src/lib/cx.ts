/** 拼类名：假值跳过。组件里的修饰符都经它拼，不写行内样式（规范 第 4.1 节） */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
