import { useEffect, useState } from "react"
import { toast } from "sonner"
import { MessageSquare, X, Wrench } from "lucide-react"
import { adminAIAPI } from "@store/api"

const errorMessage = (e, fallback) => e?.response?.data?.message || e?.message || fallback
const fmt = (d) => (d ? new Date(d).toLocaleString() : "")
const who = (c) => (c.user ? c.user.name || c.user.phone || c.user.email || String(c.userId) : c.userId ? String(c.userId) : "Guest")

function Transcript({ id, onClose }) {
  const [conv, setConv] = useState(null)

  useEffect(() => {
    adminAIAPI.getConversation(id)
      .then((res) => setConv(res?.data?.data?.conversation || null))
      .catch((e) => toast.error(errorMessage(e, "Failed to load conversation")))
  }, [id])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-xl bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="font-semibold text-slate-900">Conversation</div>
            {conv && (
              <div className="text-xs text-slate-500">
                {who(conv)} · {fmt(conv.createdAt)} · {conv.totalTokens || 0} tokens{conv.model ? ` · ${conv.model}` : ""}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {!conv && <div className="text-sm text-slate-500">Loading…</div>}
          {conv?.messages?.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-line ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-800"}`}>
                {m.text}
                {m.toolCalls?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.toolCalls.map((t, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                        <Wrench className="w-3 h-3" />{t.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`mt-1 text-[10px] ${m.role === "user" ? "text-indigo-200" : "text-slate-400"}`}>
                  {fmt(m.at)}{m.promptTokens || m.outputTokens ? ` · ${m.promptTokens + m.outputTokens} tokens` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AiConversations() {
  const [filters, setFilters] = useState({ userId: "", from: "", to: "" })
  const [applied, setApplied] = useState({ userId: "", from: "", to: "" })
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ conversations: [], total: 0, limit: 20 })
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = { page, limit: 20, ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) }
    adminAIAPI.getConversations(params)
      .then((res) => { if (!cancelled) setData(res?.data?.data || { conversations: [], total: 0, limit: 20 }) })
      .catch((e) => { if (!cancelled) toast.error(errorMessage(e, "Failed to load conversations")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applied, page])

  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 20)))

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-5 h-5 text-indigo-600" />
        <h1 className="text-xl font-bold text-slate-900">Assistant conversations</h1>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters) }}
        className="flex flex-wrap items-end gap-3 mb-4 bg-white border border-slate-200 rounded-xl p-3"
      >
        <label className="text-xs text-slate-600">
          User ID
          <input value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value.trim() })} placeholder="24-character id" className="block mt-1 w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          From
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          To
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="block mt-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white">Apply</button>
        <button type="button" onClick={() => { const empty = { userId: "", from: "", to: "" }; setFilters(empty); setApplied(empty); setPage(1) }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Reset</button>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">First message</th>
              <th className="px-3 py-2 text-right">Messages</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2">Support</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Loading…</td></tr>}
            {!loading && data.conversations.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No conversations</td></tr>}
            {!loading && data.conversations.map((c) => (
              <tr key={c._id} onClick={() => setOpenId(c._id)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2 whitespace-nowrap">{fmt(c.createdAt)}</td>
                <td className="px-3 py-2">{who(c)}</td>
                <td className="px-3 py-2 max-w-md truncate text-slate-600">{c.firstMessage}</td>
                <td className="px-3 py-2 text-right">{c.messageCount}</td>
                <td className="px-3 py-2 text-right">{c.totalTokens || 0}</td>
                <td className="px-3 py-2">{c.supportTicketId ? "Handed off" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
        <span>{data.total || 0} conversations</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Previous</button>
          <span>Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>

      {openId && <Transcript id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
