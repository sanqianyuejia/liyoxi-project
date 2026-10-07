// W2-05：L0 配置测试只经本公开测试入口组装实际上层服务，不深引领域私有夹具。
import type { PrismaClient } from "@liyoxi/db";
import { createApproval } from "../approval/index.js";
import { createEvents } from "../events/index.js";
import { createFlow } from "../flow/index.js";
import { createBizNoIssuer, createIdentityContext, createTxRunner } from "../kernel/index.js";
import { createMedia } from "../media/index.js";
import { createTenant } from "../tenant/index.js";
import { createProfile } from "../profile/index.js";
import type { ProfileViewer } from "../profile/index.js";
import { staffBriefs } from "../staff/index.js";
import { assembleForTest } from "./assembly.js";
import { createClock } from "./clock.js";
import { createFactories, TEST_KEYRING } from "./data/index.js";
import { createFakeProviders } from "./providers/index.js";
export const configTestStaffBriefs = staffBriefs;
export function createConfigProfileFixture(prisma: PrismaClient) {
  const clock = createClock(),
    tx = createTxRunner({ prisma, appEnv: "test" }),
    assembly = assembleForTest({ entry: "api" });
  const make = createFactories({ db: prisma, clock }),
    fake = createFakeProviders({ clock });
  const events = createEvents({ tx, clock, assembly }),
    flow = createFlow({ assembly, clock, events }),
    tenant = createTenant({ tx, clock, flow, assembly });
  const approval = createApproval({
    assembly,
    clock,
    flow,
    events,
    bizNo: createBizNoIssuer({ clock, appEnv: "test" }),
  });
  const media = createMedia({ tx, clock, assembly, events, storage: fake.storage });
  const profile = createProfile({
    tx,
    clock,
    assembly,
    tenant,
    approval,
    events,
    media,
    keyring: () => TEST_KEYRING,
    wechat: fake.wechat,
    currentOpenid: async () => "lyxtest_config_openid",
  });
  return {
    profile,
    async owner() {
      const user = await make.merchantUser();
      const entity = await make.entity({ createdByUserId: user.id });
      const store = await make.store({ entityId: entity.id, isPrimary: true });
      const member = await make.entityMember({
        entityId: entity.id,
        merchantUserId: user.id,
        role: "owner",
      });
      const viewer: ProfileViewer = {
        ctx: createIdentityContext({
          actor: { type: "merchant", id: user.id, client: "weapp" },
          requestId: "config_reference_race",
        }),
        principal: {
          sessionId: user.id,
          merchantUserId: user.id,
          wechatIdentityId: user.id,
          consentStamp: "test",
        },
        membership: {
          memberId: member.id,
          entityId: entity.id,
          storeId: store.id,
          role: "owner",
          storeMode: "active",
        },
      };
      return { viewer };
    },
  };
}
