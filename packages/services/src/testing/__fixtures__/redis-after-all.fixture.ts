import { afterAll, expect, it } from "vitest";

import { useTestRedis } from "../redis.js";

// 用例全过，但后登记的一个 afterAll 失败：Redis 的收尾照样要执行，键不能留下（redis-isolation.test.ts 在外面核对）
const redis = useTestRedis();

afterAll(() => {
  throw new Error("夹具：afterAll 就是要失败");
});

it("往自己的前缀下写一个键", async () => {
  expect(redis.prefix).toBe(process.env.LYX_TEST_FIXTURE_PREFIX);
  const [client, raw] = [await redis.client(), await redis.raw()];
  await client.set("leftover", "1");
  expect(await raw.get(`${redis.prefix}leftover`)).toBe("1");
});
