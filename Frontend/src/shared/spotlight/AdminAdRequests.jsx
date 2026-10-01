import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Check, X } from "lucide-react"
import { spotlightAdminAPI, listOf, errorOf, fmtDate, STATE_STYLE, KIND_LABEL } from "./api"

/**
 * Advertisement > Ad Requests: what partners asked for, waiting for a decision.
 * A rejection needs a reason; the partner sees it on their Advertise page.
 */
export default function AdminAdRequests({ service }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("pending")
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      setItems(listOf(await spotlightAdminAPI.list({ service, view: "requests", status })))
    } catch (err) {
      toast.error(errorOf(err, "Could not load requests"))
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [service, status])

  const decide = async (id, body) => {
    try {
      await spotlightAdminAPI.review(id, body)
      toast.success(body.decision === "approve" ? "Approved" : "Rejected")
      setRejecting(null)
      setReason("")
      load()
    } catch (err) {
      toast.error(errorOf(err, "Could not save the decision"))
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Ad Requests</h1>
            <p className="text-sm text-slate-500 mt-1">Ads partners asked to run. Approved ones move to the Ads List.</p>
          </div>
          <div className="flex gap-2">
            {["pending", "rejected"].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${status === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">No {status} requests.</div>
          ) : items.map((ad) => (
            <div key={ad.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row gap-4">
              {ad.imageUrl ? <img src={ad.imageUrl} alt="" className="w-full md:w-48 h-28 object-cover rounded-lg" /> : null}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{ad.title}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${STATE_STYLE[ad.state] || ""}`}>{ad.state}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">{KIND_LABEL[ad.kind]}</span>
                </div>
                <div className="text-sm text-slate-600">{ad.partnerName || "-"} · {fmtDate(ad.startDate)} – {fmtDate(ad.endDate)}</div>
                {ad.description ? <p className="text-sm text-slate-700">{ad.description}</p> : null}
                {ad.budgetNote ? <p className="text-sm text-slate-500">Budget: {ad.budgetNote}</p> : null}
                {ad.ctaLink ? <p className="text-xs text-slate-500 break-all">Link: {ad.ctaLink}</p> : null}
                {ad.rejectionReason ? <p className="text-sm text-red-600">Rejected: {ad.rejectionReason}</p> : null}
              </div>
              {ad.status === "pending" ? (
                <div className="flex md:flex-col gap-2 md:w-40">
                  <button type="button" onClick={() => decide(ad.id, { decision: "approve" })} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white text-sm">
                    <Check className="w-4 h-4" /> Approve
                  </button>
                  <button type="button" onClick={() => setRejecting(ad.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              ) : null}
              {rejecting === ad.id ? (
                <form
                  className="md:w-72 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    decide(ad.id, { decision: "reject", reason })
                  }}
                >
                  <textarea required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? The partner sees this." className="w-full px-3 py-2 border rounded-lg text-sm" rows={3} />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm">Reject</button>
                    <button type="button" onClick={() => setRejecting(null)} className="flex-1 py-2 rounded-lg bg-slate-100 text-sm">Cancel</button>
                  </div>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
