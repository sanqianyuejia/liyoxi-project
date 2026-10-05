// 敏感字段三件套的注入点，与测试用的缺省实现（W0-25；KF-1 把缺省从假三件套换成 W0-14 的真三件套）。
//
// 工厂写手机号、统一社会信用代码这些列时不自己拼密文，调注入进来的 seal（createFactories 的 seal 选项）。
// 缺省是 testSealer：security 模块的真实现（sealPhone、sealUscc、encryptField），配一把测试密钥环 TEST_KEYRING。
// 密文是 v1:<kid>:… 的真密文，盲索引是真的 HMAC：被测代码按同一把密钥环解密、按盲索引等值查找，都对得上。
//   - 用例里的被测代码要用密钥环时，传 TEST_KEYRING（或者自己造一把，连同 sealerOf(自己的密钥环) 一起注入）；
//   - 断言密文里是什么：openSealed(列, 密文)。
// 测试密钥环照 security/__fixtures__/keys.ts 的办法：固定字节现造，不读任何文件，不是任何环境在用的密钥
// （CLAUDE.md 硬性规则 1）。填充字节与那边的不同：两处的密文互相解不开，不会串用。
import {
  createKeyring,
  encryptField,
  openField,
  sealPhone,
  sealUscc,
} from "../../security/index.js";
import type { Keyring, SealedField, SealedPhone, SensitiveColumn } from "../../security/index.js";

// 三个类型就是 security 模块的那三个；从这里再给一遍，引 testing 的用例不用另开一条引入
export type { SealedField, SealedPhone, SensitiveColumn };

export interface FactorySealer {
  phone(column: SensitiveColumn, phone: string): SealedPhone;
  uscc(column: SensitiveColumn, uscc: string): SealedField;
  /** 只存密文的字段（如法定代表人姓名） */
  text(column: SensitiveColumn, plaintext: string): string;
}

const testKey = (fill: number): Buffer => Buffer.alloc(32, fill);

/** 测试密钥环：一把数据密钥（kid 是 test）、两个用途各一把盲索引密钥，都是固定字节 */
export const TEST_KEYRING: Keyring = createKeyring({
  data: { current: "test", keys: { test: testKey(0x51) } },
  bidx: { phone: testKey(0x52), uscc: testKey(0x53) },
});

/** 用一把密钥环做成工厂要的三件套：就是 security 的三个函数去掉 keyring 一参 */
export const sealerOf = (keyring: Keyring): FactorySealer => ({
  phone: (column, phone) => sealPhone(keyring, column, phone),
  uscc: (column, uscc) => sealUscc(keyring, column, uscc),
  text: (column, plaintext) => encryptField(keyring, column, plaintext),
});

/** createFactories 的缺省三件套：真实现加测试密钥环 */
export const testSealer: FactorySealer = sealerOf(TEST_KEYRING);

/** 解开缺省三件套写的密文。column 要与写入时的相同（它进了密文的附加认证数据），不同即抛错 */
export const openSealed = (column: SensitiveColumn, enc: string): string =>
  openField(TEST_KEYRING, column, enc);
