// 主键（W0-07）：UUID v7，由应用生成，库里不设默认值（06 第 3.1 节；ADR-011）。手写，只用 Node 内置的 crypto。
// 布局照 RFC 9562：48 位毫秒时间戳 | 版本 7 | 12 位序号 | 变体 10 | 62 位随机数。
// 时间戳取系统时钟，不取注入的时钟：主键不是业务时间。同一进程里连续生成的值按字典序严格递增：
// 同一毫秒内序号加一；序号用完就借下一毫秒；系统时钟回拨时不跟着退，接着上一个毫秒数往上数。
import { randomBytes } from "node:crypto";

let lastMs = -1;
let seq = 0;

export function uuidv7(): string {
  const bytes = randomBytes(16);
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    // 序号从 11 位随机数起步：最高位留空，同一毫秒里至少还能再发 2048 个
    seq = bytes.readUInt16BE(6) & 0x07ff;
  } else if (seq < 0x0fff) {
    seq += 1;
  } else {
    lastMs += 1;
    seq = 0;
  }
  bytes.writeUIntBE(lastMs, 0, 6);
  bytes.writeUInt16BE(0x7000 | seq, 6);
  bytes.writeUInt8(0x80 | (bytes.readUInt8(8) & 0x3f), 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 是不是小写、带连字符的 UUID（任何版本）：库里 uuid 列转成文本就是这个写法 */
export const isUuid = (value: string): boolean => UUID.test(value);
