import type { DomainLoopDef } from "../loop.js";
export const probe: DomainLoopDef = {
  name: "probe",
  intervalMs: 60_000,
  run: (services, beat) =>
    services.probe === undefined
      ? Promise.reject(new Error("探针服务尚未装配"))
      : services.probe(beat),
};
