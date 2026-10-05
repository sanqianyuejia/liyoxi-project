// kernel/queue：队列封装（W0-23）。用法见 ../README.md 的“队列”一节与 channel.ts 开头的注释。
export { bullPrefix, createQueueChannel, REDIS_DOWN_FALLBACK_MS } from "./channel.js";
export type { QueueChannel, QueueChannelOptions, QueueConsumer } from "./channel.js";
