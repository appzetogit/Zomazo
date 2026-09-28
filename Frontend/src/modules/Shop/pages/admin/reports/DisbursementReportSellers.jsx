import DisbursementReport from "@food/components/admin/reports/DisbursementReport"
import { adminAPI } from "@shop/api"

// The Shop's sellers, from its own withdrawal requests (/ecom/admin/withdrawals).
const SELLERS = {
  title: "Seller disbursements",
  who: "Seller",
  load: (params) => adminAPI.getWithdrawals(params),
  name: (r) => r.sellerName || "N/A",
  ref: (r) => r.sellerIdString || "",
}

export default function DisbursementReportSellers() {
  return <DisbursementReport kind="sellers" source={SELLERS} />
}
