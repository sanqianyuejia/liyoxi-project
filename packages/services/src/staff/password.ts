// 口令（W1-01a；D4 第 6.2 节；a01 第 3.4 节）：scrypt 哈希与口令规则。只用 node:crypto。
//   哈希串自带参数：scrypt$N$r$p$<盐 base64>$<哈希 base64>。校验时从串里解析参数并显式给 maxmem，
//   所以日后调高 N，旧哈希照样能校验，也不会撞 Node 的默认内存上限（N = 2^15 时默认值就不够）。
//   “账号不存在也跑一次校验”用的假哈希按当前生效的参数生成，进程里只生成一次。
// 没有借参考工程的代码：任务书 第 11 节的候选没有打开，照 D4 第 6.2 节直接写的。
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** 当前生效的参数（D4 第 6.2 节：单次约 20ms） */
export const SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };
const SALT_BYTES = 16;
const HASH_BYTES = 64;
/** 解析哈希串时收的上限：库里的串写坏了也不至于一次校验吃掉几个 G */
const MAX = { N: 2 ** 20, r: 32, p: 16 };

const derive = (
  password: string,
  salt: Buffer,
  { N, r, p }: ScryptParams,
  length: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

/** 算口令的哈希串。参数缺省取当前生效的那一组 */
export async function hashPassword(
  password: string,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params, HASH_BYTES);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | null {
  const [scheme, N, r, p, salt, hash, ...rest] = stored.split("$");
  if (scheme !== "scrypt" || rest.length > 0 || !salt || !hash) return null;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  const whole = Object.values(params).every((value) => Number.isInteger(value) && value > 0);
  // N 要是 2 的幂
  if (!whole || params.N < 2 || (params.N & (params.N - 1)) !== 0) return null;
  if (params.N > MAX.N || params.r > MAX.r || params.p > MAX.p) return null;
  const parsed = { params, salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
  return parsed.salt.length > 0 && parsed.hash.length >= 16 ? parsed : null;
}

/** 校验口令。哈希串写法不对即 false，不抛错 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (parsed === null) return false;
  const actual = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  return timingSafeEqual(actual, parsed.hash);
}

let decoy: Promise<string> | undefined;

/**
 * 白跑一次同参数的校验，结果恒为 false：账号不存在、未启用、待激活、桶锁定中都调它，
 * 让这几种失败与“密码错”的耗时分不开（D4 第 6.3 节）。
 */
export async function burnPasswordCheck(password: string): Promise<false> {
  decoy ??= hashPassword(randomBytes(24).toString("base64"));
  await verifyPassword(password, await decoy);
  return false;
}

/** 口令规则的编码（a01 第 5 节 PASSWORD_POLICY_VIOLATED 的 details.rules） */
export const PASSWORD_RULES = [
  "min_length",
  "letters_and_digits",
  "contains_phone",
  "weak_password",
] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

export const PASSWORD_MIN_LENGTH = 10;

/** 内置弱口令表：够长、有字母有数字、却人人都会试的那些。比对时不分大小写 */
const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  "password123",
  "password1234",
  "password12345",
  "passw0rd123",
  "p@ssw0rd123",
  "qwerty12345",
  "qwerty123456",
  "qwertyuiop1",
  "qwertyuiop123",
  "1q2w3e4r5t",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "q1w2e3r4t5",
  "q1w2e3r4t5y6",
  "zaq12wsxcde3",
  "abc1234567",
  "abc12345678",
  "abcd123456",
  "abcd1234567",
  "abcde12345",
  "a123456789",
  "a1234567890",
  "aa12345678",
  "abc123abc123",
  "123456789a",
  "1234567890a",
  "123456789abc",
  "1234567890abc",
  "123456789q",
  "1234567890q",
  "1234qwerasdf",
  "asdfghjkl1",
  "asdfghjkl123",
  "admin12345",
  "admin123456",
  "admin1234567",
  "administrator1",
  "iloveyou123",
  "woaini1314520",
  "woaini123456",
  "welcome123",
  "welcome1234",
  "letmein12345",
  "liyoxi12345",
  "liyoxi123456",
]);

/**
 * 口令不满足哪几条规则；空数组即合规。规则：至少 10 位、同时含字母与数字、不含登录手机号、不在弱口令表里。
 * phone 给登录手机号的 11 位数字。
 */
export function passwordViolations(password: string, phone: string): PasswordRule[] {
  const violations: PasswordRule[] = [];
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) violations.push("min_length");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) violations.push("letters_and_digits");
  if (phone !== "" && password.includes(phone)) violations.push("contains_phone");
  if (WEAK_PASSWORDS.has(password.toLowerCase())) violations.push("weak_password");
  return violations;
}
