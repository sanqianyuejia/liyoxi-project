import { expect, it } from "vitest";
import {
  assertContentAdminLiveScope,
  parseOutputBatchLiveManifest as parseSharedManifest,
} from "@liyoxi/services/testing";
import { parseOutputBatchLiveManifest } from "./upload-batch-live-server.js";

const runId = "1234567890abcdef",
  id = "01950000-0000-7000-8000-000000000001";
const owned = {
  runId,
  name: `lyx_test_admin_live_${runId}`,
  prefix: `lyx:test:admin_live_${runId}:`,
};
const scope = { ...owned, startedAt: "2026-10-01T00:00:00.000Z", uploaderId: id, dramaIds: [id] };
// The original runner passes this full fixture envelope, not its nested scope alone.
const content = { scope, dramaId: id, title: "虚构页面", query: "页面", expectedDraftCount: 13 };
const delivery = {
  ...owned,
  startedAt: scope.startedAt,
  entityId: id,
  storeId: id,
  orderId: id,
  itemId: id,
  ticketId: id,
  uploaderId: id,
  managerId: id,
};
// Codec input only: parser tests do not claim these facts came from a real media probe.
const video = {
  path: "/tmp/parser-only.mp4",
  sha256: "0".repeat(64),
  size: 1,
  probe: {
    kind: "video",
    container: "mp4",
    durationMs: 20_000,
    width: 720,
    height: 1280,
    rotation: 0,
    displayWidth: 720,
    displayHeight: 1280,
    fpsNum: 25,
    fpsDen: 1,
    vcodec: "h264",
    vprofile: "High",
    pixFmt: "yuv420p",
    acodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    audioStreamCount: 1,
    bitrateKbps: null,
    isFaststart: true,
    avDriftMs: null,
    aigcMeta: null,
    probeVersion: 1,
    raw: {},
  },
};
const original = {
  current: { ...delivery, dramaId: id },
  legacy: delivery,
  video,
  resumeVideo: video,
};
it("without W312 the original strict four-field manifest remains unchanged", () => {
  // The API and old delivery CLI use this identical public testing adapter.
  expect(parseOutputBatchLiveManifest).toBe(parseSharedManifest);
  expect(parseOutputBatchLiveManifest(original)).toEqual({ inputs: original, w312: undefined });
  expect(() => parseOutputBatchLiveManifest({ ...original, unexpected: true })).toThrow();
});
it("W312 is independently parsed and stripped before the original strict manifest", () => {
  expect(parseOutputBatchLiveManifest({ ...original, w312: content })).toEqual({
    inputs: original,
    w312: scope,
  });
  expect(() =>
    parseOutputBatchLiveManifest({ ...original, w312: content, unexpected: true }),
  ).toThrow();
  expect(() =>
    parseOutputBatchLiveManifest({ ...original, w312: { ...content, verified: true } }),
  ).toThrow();
  expect(() =>
    parseOutputBatchLiveManifest({
      ...original,
      w312: { ...content, scope: { ...scope, verified: true } },
    }),
  ).toThrow();
  expect(() =>
    parseOutputBatchLiveManifest({
      ...original,
      w312: { ...content, scope: { ...scope, dramaIds: [id, id] } },
    }),
  ).toThrow();
  expect(() => parseOutputBatchLiveManifest({ ...original, w312: undefined })).toThrow();
  expect(() => parseSharedManifest({ ...original, w312: null })).toThrow();
  expect(() =>
    parseSharedManifest({ ...original, w312: { ...content, expectedDraftCount: 12 } }),
  ).toThrow();
});
it("W312 cannot broaden the original current or legacy target contract", () => {
  expect(() =>
    parseOutputBatchLiveManifest({
      ...original,
      w312: content,
      current: { ...original.current, anotherTarget: id },
    }),
  ).toThrow();
  expect(() =>
    parseOutputBatchLiveManifest({
      ...original,
      w312: content,
      video: { ...video, verified: true },
    }),
  ).toThrow();
});
it("W312 scope requires this exact local owned database, app role and Redis prefix", () => {
  const env = {
    APP_ENV: "test" as const,
    DATABASE_URL: `postgresql://liyoxi:lyx-local-dev@localhost:5442/${owned.name}?options=-c%20role%3Dlyx_app`,
    REDIS_URL: "redis://localhost:6389/0",
  };
  expect(assertContentAdminLiveScope({ env }, scope)).toEqual(scope);
  for (const patch of [
    { runId: "abcdef1234567890" },
    { name: "liyoxi" },
    { prefix: "lyx:test:other:" },
  ])
    expect(() => assertContentAdminLiveScope({ env }, { ...scope, ...patch })).toThrow();
  for (const patch of [
    { APP_ENV: "local" as const },
    { DATABASE_URL: env.DATABASE_URL.replace(owned.name, "liyoxi") },
    { DATABASE_URL: env.DATABASE_URL.replace("lyx_app", "liyoxi") },
    { REDIS_URL: "redis://localhost:6389/1" },
  ])
    expect(() => assertContentAdminLiveScope({ env: { ...env, ...patch } }, scope)).toThrow();
});
