// 演示员工（W1-01a 的演示种子；任务书 第 10 节第 11 项与文末的统稿补充；计划 第 8.5 节）。
// 7 位：客服、交付经理、剪辑师、发布专员、内容运营各一位，财务两位（受控财务配置要提议人与批准人不同）。
// 只进本地、测试与预发：appEnv 是 prod 即拒绝。不是 W0-21 的种子，由演示种子的运行器（../demo-seed.ts）调。
//
//   都建成“待激活”（启用、没有口令），各出一枚激活码，明文只在返回值里出现一次，由命令行打到终端；
//   仓库里不放任何固定口令。演示全程也可以只用 staff:bootstrap 引导出来的超级管理员。
//   没有才建：按登录手机号认人，已有的不动、不重发码，所以可以重复跑。
//   每位员工一个事务：经 flow.transition 写状态历史、ops 审计（操作人是系统，任务名 cli.db.seed.demo）、staff.created。
//   交付经理、剪辑师、发布专员各进自己的分配池（city_code 为空串 = 不限城市）。
//   发布专员的数据范围：角色的代码默认是“本人”，演示里要他看得到全部门店的账号核验与链接核验（W1-19、W1-20），
//   所以新建这位员工时把库里发布专员那一行角色的 data_scope 改成 all（代码默认配置不动；之后在后台改回去的不再覆盖）。
// 员工的新增接口（admin.staff.create，W1-01b）到位之前，这里自己插员工行；到位之后可以换成调它的服务函数。
import type { EnumValue, ASSIGNMENT_POOL } from "@liyoxi/contract/enums";
import type { StaffRoleKey } from "@liyoxi/contract";

import type { Flow } from "../flow/index.js";
import { createIdentityContext, uuidv7 } from "../kernel/index.js";
import type { AppEnv, Clock, SeedTableResult, TxRunner } from "../kernel/index.js";
import { sealPhone } from "../security/index.js";
import type { Keyring } from "../security/index.js";
import { issueActivationCode } from "./activation.js";
import { findStaffByPhone } from "./repo.js";

/** 演示种子写审计与状态历史时的任务名；staff.status “新增”一行的守卫认它 */
export const DEMO_SEED_JOB = "cli.db.seed.demo";

type Pool = EnumValue<typeof ASSIGNMENT_POOL>;

export interface DemoStaffDef {
  /** 别的模块的演示种子按它找人（demoStaffId） */
  readonly key: string;
  readonly name: string;
  /** 登录手机号：199 0000 00xx，只在演示库里用 */
  readonly phone: string;
  readonly roleKey: Exclude<StaffRoleKey, "super_admin">;
  readonly isLead: boolean;
  readonly pool?: Pool;
}

export const DEMO_STAFF = [
  { key: "cs", name: "演示客服", phone: "19900000001", roleKey: "cs", isLead: false },
  {
    key: "delivery_manager",
    name: "演示交付经理",
    phone: "19900000002",
    roleKey: "delivery_manager",
    isLead: true,
    pool: "delivery_manager",
  },
  {
    key: "editor",
    name: "演示剪辑师",
    phone: "19900000003",
    roleKey: "editor",
    isLead: false,
    pool: "editor",
  },
  {
    key: "publisher",
    name: "演示发布专员",
    phone: "19900000004",
    roleKey: "publisher",
    isLead: false,
    pool: "publisher",
  },
  {
    key: "content_ops",
    name: "演示内容运营",
    phone: "19900000005",
    roleKey: "content_ops",
    isLead: false,
  },
  {
    key: "finance_lead",
    name: "演示财务主管",
    phone: "19900000006",
    roleKey: "finance",
    isLead: true,
  },
  { key: "finance", name: "演示财务", phone: "19900000007", roleKey: "finance", isLead: false },
] as const satisfies readonly DemoStaffDef[];

export type DemoStaffKey = (typeof DEMO_STAFF)[number]["key"];

export interface DemoStaffDeps {
  readonly tx: TxRunner;
  readonly clock: Clock;
  /** 字段加密的密钥环：手机号的三件套与盲索引 */
  readonly keyring: Keyring;
  readonly flow: Pick<Flow, "transition">;
  readonly appEnv: AppEnv;
}

export interface DemoStaffMember {
  readonly key: DemoStaffKey;
  readonly staffId: string;
  readonly staffNo: number;
  readonly name: string;
  readonly roleKey: StaffRoleKey;
  /** 本次新建的才有：激活码明文只出现这一次 */
  readonly activation: { readonly code: string; readonly expiresAt: Date } | null;
}

export interface DemoStaffResult {
  readonly tables: SeedTableResult[];
  readonly staff: readonly DemoStaffMember[];
}

/** 建 7 位演示员工；已有的（按手机号认）不动。返回各表新增与已有的行数、每位员工的 id 与本次发出的激活码 */
export async function seedDemoStaff(deps: DemoStaffDeps): Promise<DemoStaffResult> {
  if (deps.appEnv === "prod") throw new Error("演示员工只进本地、测试与预发，生产环境拒绝");
  const now = deps.clock.now();
  const identity = createIdentityContext({ actor: { type: "system", job: DEMO_SEED_JOB } });
  const members: DemoStaffMember[] = [];
  let pooled = 0;
  let pooledExisting = 0;

  for (const def of DEMO_STAFF) {
    const member = await deps.tx.run(async (tx): Promise<DemoStaffMember> => {
      // 两个演示种子进程同时跑时排队：后到的看到先到的已经建好的人
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('lyx:seed:demo'))");
      const found = await findStaffByPhone(tx, deps.keyring, def.phone);
      if (found !== null) {
        return {
          key: def.key,
          staffId: found.id,
          staffNo: found.staffNo,
          name: found.name,
          roleKey: found.staffRoleKey as StaffRoleKey,
          activation: null,
        };
      }
      const group = await tx.staffGroup.findFirst({
        where: { staffRoleKey: def.roleKey, isDefault: true },
        select: { id: true },
      });
      const sealed = sealPhone(deps.keyring, "staff.phone_enc", def.phone);
      const staff = await tx.staff.create({
        data: {
          id: uuidv7(),
          name: def.name,
          phoneEnc: sealed.enc,
          phoneBidx: sealed.bidx,
          phoneMask: sealed.mask,
          phoneLast4: sealed.last4,
          staffRoleKey: def.roleKey,
          staffGroupId: group?.id ?? null,
          isLead: def.isLead,
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      });
      await deps.flow.transition(tx, identity, {
        machine: "staff",
        stateField: "status",
        id: staff.id,
        event: "staff.create",
        created: true,
        audit: {
          stream: "ops",
          category: "staff_authz",
          action: "sys.staff.create",
          summary: `演示种子：新增员工 ${def.name}（工号 ${staff.staffNo}）`,
          target: { type: "staff", id: staff.id, label: def.name },
          before: null,
          after: {
            name: def.name,
            staffRoleKey: def.roleKey,
            isLead: def.isLead,
            phone: sealed.mask,
            status: "active",
          },
          fields: ["name", "staffRoleKey", "isLead", "phone", "status"],
        },
        emit: { type: "staff.created", payload: { v: 1, staffId: staff.id, roleKey: def.roleKey } },
      });
      if ("pool" in def) {
        await tx.assignmentPoolMember.create({
          data: { pool: def.pool, staffId: staff.id, cityCode: "", createdAt: now, updatedAt: now },
        });
      }
      if (def.key === "publisher") {
        await tx.staffRole.updateMany({
          where: { key: "publisher", dataScope: "own" },
          data: { dataScope: "all", lockVersion: { increment: 1 }, updatedAt: now },
        });
      }
      const activation = await issueActivationCode(tx, {
        staffId: staff.id,
        purpose: "activate",
        delivery: "manual",
        createdByStaffId: null,
        now,
      });
      return {
        key: def.key,
        staffId: staff.id,
        staffNo: staff.staffNo,
        name: staff.name,
        roleKey: def.roleKey,
        activation: { code: activation.code, expiresAt: activation.expiresAt },
      };
    });
    members.push(member);
    if ("pool" in def) {
      if (member.activation === null) pooledExisting += 1;
      else pooled += 1;
    }
  }

  const created = members.filter((member) => member.activation !== null).length;
  return {
    tables: [
      { table: "staff", inserted: created, existing: members.length - created },
      { table: "assignment_pool_member", inserted: pooled, existing: pooledExisting },
    ],
    staff: members,
  };
}

/** 别的模块的演示种子按键取演示员工的 id；没有这个人即抛错（先后固定：staff 排第一） */
export function demoStaffId(staff: readonly DemoStaffMember[], key: DemoStaffKey): string {
  const found = staff.find((member) => member.key === key);
  if (found === undefined)
    throw new Error(`演示员工 ${key} 还没建：演示种子里 staff 一步要排在前面`);
  return found.staffId;
}
