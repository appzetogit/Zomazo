import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Search, Send, MessageSquare } from "lucide-react"
import { supportInboxAPI } from "@/services/api"
import { errorOf, fmtDate } from "./api"

const WHO = { customer: "Customer", restaurant: "Restaurant", store: "Store", rider: "Rider", user: "Customer", driver: "Driver", owner: "Owner" }

/*
 * A ticket as a conversation. The opened ticket carries every message
 * (core/support/supportThread.js); until it loads, the list row's request and
 * latest answer stand in.
 */
function threadOf(t) {
  if (t.messages?.length) return t.messages
  const out = [{ from: "requester", message: t.description || t.subject, at: t.createdAt }]
  if (t.reply) out.push({ from: "admin", message: t.reply, at: t.updatedAt })
  return out
}

/**
 * Chattings: the platform support centre's tickets for one service, read as
 * conversations with customers, restaurants and riders. Not a second support
 * system -- replies go through the same inbox (core/support/supportInbox),
 * so each service notifies the person exactly as a reply from Help & Support.
 */
export default function AdminChattings({ service }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [who, setWho] = useState("")
  const [openKey, setOpenKey] = useState("")
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await supportInboxAPI.list({ service, q, limit: 100 })
      setItems(res?.data?.data?.items || [])
    } catch (err) {
      toast.error(errorOf(err, "Could not load conversations"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, q])

  const shown = useMemo(() => items.filter((t) => !who || t.requesterType === who), [items, who])
  const open = items.find((t) => t.key === openKey) || null

  // The list carries no thread; the ticket itself does.
  const openTicket = async (t) => {
    setOpenKey(t.key)
    setReply("")
    try {
      const res = await supportInboxAPI.get(t.source, t.id)
      const full = res?.data?.data
      if (full) setItems((prev) => prev.map((x) => (x.key === full.key ? full : x)))
    } catch (err) {
      toast.error(errorOf(err, "Could not load the conversation"))
    }
  }

  const send = async (e) => {
    e.preventDefault()
    if (!open || !reply.trim()) return
    setSending(true)
    try {
      const res = await supportInboxAPI.update(open.source, open.id, { reply: reply.trim(), status: "in_progress" })
      const updated = res?.data?.data
      if (updated) setItems((prev) => prev.map((t) => (t.key === updated.key ? updated : t)))
      setReply("")
      toast.success("Reply sent")
    } catch (err) {
      toast.error(errorOf(err, "Could not send the reply"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col max-h-[80vh]">
          <div className="p-4 border-b border-slate-200 space-y-3">
            <h1 className="text-lg font-semibold text-slate-900">Conversations</h1>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-2 flex-wrap text-xs">
              {[["", "All"], ["customer", "Customers"], ["restaurant", "Restaurants"], ["rider", "Riders"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setWho(v)} className={`px-3 py-1 rounded-full ${who === v ? "bg-blue-600 text-white" : "bg-slate-100"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? <p className="p-6 text-center text-sm text-slate-500">Loading...</p> : null}
            {!loading && shown.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No conversations.</p> : null}
            {shown.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => openTicket(t)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${openKey === t.key ? "bg-blue-50" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-sm text-slate-900 truncate">{t.requesterName || t.requesterPhone || `#${t.code}`}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDate(t.updatedAt)}</span>
                </div>
                <div className="text-xs text-slate-500">{WHO[t.requesterType] || "User"} · {t.status.replace("_", " ")}</div>
                <div className="text-sm text-slate-600 truncate">{t.subject}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[60vh] max-h-[80vh]">
          {!open ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
              <MessageSquare className="w-10 h-10" />
              <p className="text-sm">Pick a conversation</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-slate-200">
                <div className="font-semibold text-slate-900">{open.requesterName || open.requesterPhone || `#${open.code}`}</div>
                <div className="text-xs text-slate-500">{open.sourceLabel} · #{open.code} · {open.subject}{open.orderRef ? ` · Order ${open.orderRef}` : ""}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                {threadOf(open).map((m, i) => (
                  <div key={i} className={`flex ${m.from === "admin" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${m.from === "admin" ? "bg-blue-600 text-white" : "bg-white border border-slate-200"}`}>
                      {m.message}
                      <div className={`text-[10px] mt-1 ${m.from === "admin" ? "text-blue-100" : "text-slate-400"}`}>{fmtDate(m.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} className="p-3 border-t border-slate-200 space-y-1">
                <div className="flex gap-2">
                  <input value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  <button type="submit" disabled={sending || !reply.trim()} className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
