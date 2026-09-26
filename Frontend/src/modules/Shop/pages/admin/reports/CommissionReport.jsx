import { useEffect, useState } from "react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"
import {
  ReportPage, ReportFilters, ReportTable, SummaryCard, defaultRange, toParams, errorMessage,
  formatCurrency, formatNumber, useXlsxDownload,
} from "./reportShared"

const money = (key) => ({ key, align: "right", render: (r) => formatCurrency(r[key]) })

export default function CommissionReport() {
  const [filters, setFilters] = useState({ ...defaultRange(30), fulfilmentMode: "all" })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { exporting, download } = useXlsxDownload(adminAPI.exportCommissionReport, "commission")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAPI.getCommissionReport(toParams(filters))
      .then((res) => { if (!cancelled) setData(res?.data?.data || null) })
      .catch((e) => { if (!cancelled) { setData(null); toast.error(errorMessage(e, "Failed to load commission report")) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filters])

  const t = data?.totals || {}
  return (
    <ReportPage title="Commission Report">
      <ReportFilters value={filters} onApply={setFilters} onExport={(f) => download(toParams(f))} exporting={exporting} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <SummaryCard label="Gross item value" value={formatCurrency(t.grossItemValue)} hint={`${formatNumber(t.orders || 0)} orders`} />
        <SummaryCard label="Commission" value={formatCurrency(t.commission)} tone="text-green-600" hint={`${t.commissionPct ?? 0}% of gross`} />
        <SummaryCard label="Platform-funded discounts" value={formatCurrency(t.platformFundedDiscount)} tone="text-red-600" />
        <SummaryCard label="Coins discount (platform)" value={formatCurrency(t.coinsDiscount)} tone="text-red-600" />
        <SummaryCard label="Net payable to sellers" value={formatCurrency(t.netPayable)} tone="text-blue-600" />
      </div>

      <ReportTable
        title="Sellers"
        loading={loading}
        rows={(data?.sellers || []).map((s) => ({ ...s, key: s.sellerId }))}
        footer={data?.totals}
        columns={[
          { key: "sellerName", label: "Seller", render: (r) => r.sellerName || r.sellerId },
          { key: "orders", label: "Orders", align: "right" },
          { ...money("grossItemValue"), label: "Gross item value" },
          { ...money("commission"), label: "Commission" },
          { key: "commissionPct", label: "Comm. %", align: "right", render: (r) => `${r.commissionPct ?? 0}%` },
          { ...money("sellerFundedDiscount"), label: "Seller-funded disc." },
          { ...money("platformFundedDiscount"), label: "Platform-funded disc." },
          { ...money("coinsDiscount"), label: "Coins disc." },
          { ...money("netPayable"), label: "Net payable" },
        ]}
      />
      <p className="text-[11px] text-slate-500 px-1">
        Non-cancelled orders placed in the range. Commission and discount split come from the order's transaction; coins are platform-borne and do not reduce the seller payout.
      </p>
    </ReportPage>
  )
}
