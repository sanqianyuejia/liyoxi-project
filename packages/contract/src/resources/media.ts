// media 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("media", [
  resource("file_object", "files", "fileId", ["m", "admin", "portal"]),
  resource("file_purge_run", "purge-runs", "purgeRunId", ["admin"]),
  resource("upload_batch", "upload-batches", "uploadBatchId", ["admin"]),
  resource("upload_batch_item", "upload-batch-items", "uploadBatchItemId", ["admin"]),
  resource("media_job", "media-jobs", "mediaJobId", ["admin", "hooks"]),
  resource("production_record", "production-records", "productionRecordId", ["admin"]),
  resource("playable_asset", "playables", "playableId", ["m"]),
  resource("drama_trailer", "drama-trailers", null, ["admin"], ["/admin/dramas/{dramaId}/trailer"]),
  resource("store_asset", "store-assets", "storeAssetId", ["m", "admin"]),
  resource("store_asset_demand", "asset-demands", "assetDemandId", ["m", "admin"]),
]);
