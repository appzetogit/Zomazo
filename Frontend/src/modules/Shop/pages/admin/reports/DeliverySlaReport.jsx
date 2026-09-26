import { useEffect, useState } from "react"
import { toast } from "sonner"
import { adminAPI } from "@store/api"
import {
  ReportPage, ReportFilters, ReportTable, SummaryCard, defaultRange, toParams, errorMessage,
  formatNumber, formatDateTime, useXlsxDownload,
} from "./reportShared"

const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`)
const dur = (v, unit) => (v === null || v === undefined ? "—" : `${v} ${unit === "days" ? "d" : "min"}`)

const statColumns = [
  { key: "count", label: "Delivered", align: "right" },
  { key: "median", label: "Median", align: "right", render: (r) => dur(r.median, r.unit) },
  { key: "p90", label: "P90", align: "right", render: (r) => dur(r.p90, r.unit) },
  { key: "onTimePct", label: "On time", align: "right", render: (r) => `${pct(r.onTimePct)} (${r.onTime}/${r.judged})` },
  { key: "late", label: "Late", align: "right" },
]

export default function DeliverySlaReport() {
  const [filters, setFilters] = useState({ ...defaultRange(30), fulfilmentMode: "all" })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const { exporting, download } = useXlsxDownload(adminAPI.exportDeliverySlaReport, "delivery_sla")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAPI.getDeliverySlaReport(toParams(filters))
      .then((res) => { if (!cancelled) setData(res?.data?.data || null) })
      .catch((e) => { if (!cancelled) { setData(null); toast.error(errorMessage(e, "Failed to load SLA report")) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filters])

  const byMode = data?.byMode || []
  return (
    <ReportPage title="Delivery SLA Report">
      <ReportFilters value={filters} onApply={setFilters} onExport={(f) => download(toParams(f))} exporting={exporting} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        {byMode.map((m) => (
          <SummaryCard
            key={`${m.fulfilmentMode}-count`}
            label={`${m.fulfilmentMode === "quick" ? "Quick" : "Standard"} on time`}
            value={pct(m.onTimePct)}
            tone={m.onTimePct === null ? "text-slate-900" : m.onTimePct >= 90 ? "text-green-600" : "text-red-600"}
            hint={`${formatNumber(m.count)} delivered · median ${dur(m.median, m.unit)} · p90 ${dur(m.p90, m.unit)}`}
          />
        ))}
        <SummaryCard label="Late orders" value={formatNumber(data?.lateOrders?.length || 0)} tone="text-red-600"
          hint={`Quick SLA: promised ETA, else ${data?.quickSlaMinutes ?? 30} min; standard: courier ETD`} />
      </div>

      <ReportTable
        title="By fulfilment mode"
        loading={loading}
        rows={byMode.map((m) => ({ ...m, key: m.fulfilmentMode }))}
        columns={[{ key: "fulfilmentMode", label: "Mode" }, ...statColumns]}
      />
      <ReportTable
        title="By seller"
        loading={loading}
        rows={(data?.bySeller || []).map((s) => ({ ...s, key: `${s.sellerId}-${s.fulfilmentMode}` }))}
        columns={[
          { key: "sellerName", label: "Seller", render: (r) => r.sellerName || r.sellerId },
          { key: "fulfilmentMode", label: "Mode" },
          ...statColumns,
        ]}
      />
      <ReportTable
        title="Late orders"
        loading={loading}
        empty="No late orders"
        rows={(data?.lateOrders || []).map((o) => ({ ...o, key: o.orderId }))}
        columns={[
          { key: "order_id", label: "Order", render: (r) => r.order_id || r.orderId },
          { key: "sellerName", label: "Seller" },
          { key: "fulfilmentMode", label: "Mode" },
          { key: "placedAt", label: "Placed", render: (r) => formatDateTime(r.placedAt) },
          { key: "deliveredAt", label: "Delivered", render: (r) => formatDateTime(r.deliveredAt) },
          { key: "duration", label: "Took", align: "right", render: (r) => dur(r.duration, r.unit) },
          { key: "promised", label: "Promised", render: (r) => (r.unit === "days" ? formatDateTime(r.promised) : `${r.promised} min`) },
        ]}
      />
    </ReportPage>
  )
}
