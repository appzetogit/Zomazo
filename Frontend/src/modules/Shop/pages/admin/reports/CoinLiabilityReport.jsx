import { useEffect, useState } from "react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"
import {
  ReportPage, ReportFilters, ReportTable, SummaryCard, defaultRange, toParams, errorMessage,
  formatCurrency, formatNumber, useXlsxDownload,
} from "./reportShared"

const num = (key, label) => ({ key, label, align: "right", render: (r) => formatNumber(r[key]) })

export default function CoinLiabilityReport() {
  const [filters, setFilters] = useState(defaultRange(30))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { exporting, download } = useXlsxDownload(adminAPI.exportCoinLiabilityReport, "coin_liability")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAPI.getCoinLiabilityReport(toParams(filters))
      .then((res) => { if (!cancelled) setData(res?.data?.data || null) })
      .catch((e) => { if (!cancelled) { setData(null); toast.error(errorMessage(e, "Failed to load coin liability report")) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filters])

  const o = data?.outstanding || { expiring: {} }
  const p = data?.period || {}
  const rows = (data?.bySource || []).map((s) => ({ ...s, key: s.source }))
  const totals = rows.length
    ? rows.reduce((acc, r) => {
        for (const k of Object.keys(r)) if (typeof r[k] === "number") acc[k] = (acc[k] || 0) + r[k]
        return acc
      }, { source: "Total" })
    : null

  return (
    <ReportPage title="Coin Liability Report">
      <ReportFilters value={filters} onApply={setFilters} showMode={false} onExport={(f) => download(toParams(f))} exporting={exporting} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <SummaryCard label="Outstanding coins" value={formatNumber(o.total ?? 0)} hint={`${formatNumber(o.neverSpendable ?? 0)} can never be spent`} />
        <SummaryCard label="Spendable liability" value={formatCurrency(o.spendableValue)} tone="text-red-600" hint={`${formatNumber(o.spendable ?? 0)} coins`} />
        <SummaryCard label="Expiring (spendable)" value={formatNumber(o.expiring?.days30 ?? 0)}
          hint={`7d ${formatNumber(o.expiring?.days7 ?? 0)} · 30d ${formatNumber(o.expiring?.days30 ?? 0)} · 90d ${formatNumber(o.expiring?.days90 ?? 0)}`} />
        <SummaryCard label="In range" value={`+${formatNumber(p.issued ?? 0)}`} tone="text-green-600"
          hint={`redeemed ${formatNumber(p.netRedeemed ?? 0)} net · expired ${formatNumber(p.expired ?? 0)}`} />
      </div>

      <ReportTable
        title="By source"
        loading={loading}
        rows={rows}
        footer={totals}
        columns={[
          { key: "source", label: "Source", render: (r) => <span className="capitalize">{r.source}</span> },
          num("outstanding", "Outstanding"),
          num("spendable", "Spendable"),
          num("neverSpendable", "Never spendable"),
          num("expiring7", "Exp. 7d"),
          num("expiring30", "Exp. 30d"),
          num("expiring90", "Exp. 90d"),
          num("issued", "Issued"),
          num("redeemed", "Redeemed"),
          num("expired", "Expired"),
        ]}
      />
      <p className="text-[11px] text-slate-500 px-1">
        Outstanding and expiry are as of now; issued, redeemed and expired cover the selected range. Redeemed is gross ({formatNumber(p.returned ?? 0)} coins returned from cancelled orders in the range).
      </p>
    </ReportPage>
  )
}
