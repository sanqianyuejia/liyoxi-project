import { describe, expect, it } from "vitest";

import { assembleServices } from "../assembly.js";
import { AssemblyError } from "../kernel/index.js";
import { assembleForTest } from "../testing/index.js";
import { membershipAuthorizationsPort } from "./index.js";

describe("下载页成员授权强制端口（W2-10 PR1）", () => {
  it.each(["api", "worker"] as const)("%s 真实组合根收集 tenant 声明和 identity 实现", (entry) => {
    const assembly = assembleServices({ entry, appEnv: "test" });
    expect(membershipAuthorizationsPort.name).toBe("tenant.membership_authorizations");
    expect(membershipAuthorizationsPort.fallback).toBeUndefined();
    expect(assembly.ports.filter(({ port }) => port === membershipAuthorizationsPort)).toEqual([
      { port: membershipAuthorizationsPort, module: "tenant" },
    ]);
    const implementations = assembly.portImplementations.filter(
      ({ port }) => port === membershipAuthorizationsPort,
    );
    expect(implementations).toHaveLength(1);
    expect(implementations[0]?.module).toBe("identity");
    expect(assembly.port(membershipAuthorizationsPort)).toBe(implementations[0]?.impl);
    expect(typeof assembly.port(membershipAuthorizationsPort).revokePortalGrants).toBe("function");
  });

  it.each(["api", "worker"] as const)("%s 缺 identity 实现必须拒绝装配，不能当零授权", (entry) => {
    let caught: unknown;
    try {
      assembleForTest({ entry, withoutRealPorts: [membershipAuthorizationsPort] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AssemblyError);
    if (!(caught instanceof AssemblyError)) throw new Error("缺实现本该拒绝启动");
    expect(caught.issues).toEqual([
      expect.objectContaining({
        category: "port",
        name: "tenant.membership_authorizations",
        modules: ["tenant"],
        reason: "缺实现：端口没有默认实现，也没有模块实现它",
      }),
    ]);
  });
});
