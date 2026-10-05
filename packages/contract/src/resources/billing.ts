// billing 模块的表对应的资源名（docs/api/working/resources.json；约定 C10）。一张表一个资源名，三端同名。
// 表、资源名、参数名、端、别名与 resources.json 对账（pnpm api-registries:check）。
import { defineResources, resource } from "./define.js";

export const resources = defineResources("billing", [
  resource("plan", "plans", "planId", ["m", "admin"]),
  resource("plan_revision", "plan-revisions", "planRevisionId", ["admin"]),
  resource("point_pack", "point-packs", "pointPackId", ["m", "admin"]),
  resource("price_tier_revision", "price-tier-revisions", "priceTierRevisionId", ["admin"]),
  resource("drama_price_revision", "drama-price-revisions", "dramaPriceRevisionId", ["admin"]),
  resource("billing_param", "billing-params", "billingParamId", ["admin"]),
  resource("billing_account", "point-accounts", "pointAccountId", ["m", "admin"], ["/m/wallet"]),
  resource("subscription_term", "subscription-terms", "subscriptionTermId", ["admin"]),
  resource("point_ledger_entry", "point-ledger-entries", null, ["m", "admin"]),
  resource("point_adjustment_request", "point-adjustment-requests", "pointAdjustmentRequestId", [
    "admin",
  ]),
  resource("term_extension_request", "term-extension-requests", "termExtensionRequestId", [
    "admin",
  ]),
  resource("billing_order", "payment-orders", "paymentOrderId", ["m", "admin"]),
  resource("payment_txn", "payment-transactions", "paymentTransactionId", ["admin"]),
  resource("transfer_proof", "transfer-proofs", "transferProofId", ["m", "admin"]),
  resource("refund_request", "refund-requests", "refundRequestId", ["admin"]),
  resource("payment_exception", "payment-exceptions", "paymentExceptionId", ["admin"]),
  resource("recon_day", "reconciliations", "reconciliationId", ["admin"]),
  resource("invoice_request", "invoice-requests", "invoiceRequestId", ["m", "admin"]),
  resource("finance_config_revision", "finance-config-revisions", "financeConfigRevisionId", [
    "admin",
  ]),
]);
