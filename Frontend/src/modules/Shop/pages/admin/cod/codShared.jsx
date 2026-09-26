const CLS = {
  matched: "bg-green-50 text-green-700",
  short: "bg-amber-50 text-amber-700",
  excess: "bg-blue-50 text-blue-700",
  unexpected: "bg-red-50 text-red-700",
  duplicate: "bg-slate-100 text-slate-600",
  missing: "bg-red-50 text-red-700",
}

/** Result of matching one remittance line (or a missing shipment). */
export function LineStatus({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${CLS[status] || "bg-slate-100 text-slate-700"}`}>{status}</span>
}
