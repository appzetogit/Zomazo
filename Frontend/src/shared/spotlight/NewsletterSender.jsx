import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { mailListAdminAPI, listOf, errorOf } from "./api"

/**
 * Write a newsletter and send it to everyone still subscribed (or one
 * source's subscribers). Each mail carries its own unsubscribe link; the
 * server sends in batches and the history below shows the counts.
 */
export default function NewsletterSender({ sources, defaultSource = "" }) {
  const [form, setForm] = useState({ subject: "", body: "", source: defaultSource })
  const [history, setHistory] = useState([])
  const [sending, setSending] = useState(false)

  const load = async () => {
    try {
      setHistory(listOf(await mailListAdminAPI.campaigns()))
    } catch {
      setHistory([])
    }
  }

  useEffect(() => {
    load()
  }, [])

  // While a send is running, refresh its counts.
  useEffect(() => {
    if (!history.some((c) => c.status === "sending")) return undefined
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [history])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const who = sources.find(([v]) => v === form.source)?.[1] || "everyone"
    if (!window.confirm(`Send "${form.subject}" to ${form.source ? `${who} subscribers` : "every subscriber"}?`)) return
    setSending(true)
    try {
      await mailListAdminAPI.sendCampaign(form)
      toast.success("Sending started")
      setForm((f) => ({ ...f, subject: "", body: "" }))
      load()
    } catch (err) {
      toast.error(errorOf(err, "Could not send"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <h2 className="font-semibold text-slate-900">Send newsletter</h2>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input required maxLength={200} value={form.subject} onChange={set("subject")} placeholder="Subject" className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <select value={form.source} onChange={set("source")} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
            {sources.map(([v, l]) => <option key={v} value={v}>{v ? `${l} subscribers` : "Every subscriber"}</option>)}
          </select>
        </div>
        <textarea required maxLength={20000} rows={6} value={form.body} onChange={set("body")} placeholder="Message (plain text). An unsubscribe link is added to every mail." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        <button type="submit" disabled={sending} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
          <Send className="w-4 h-4" /> {sending ? "Starting..." : "Send"}
        </button>
      </form>
      {history.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-2">Subject</th><th>To</th><th>Sent / total</th><th>Failed</th><th>Status</th><th>When</th></tr>
          </thead>
          <tbody>
            {history.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="py-2 pr-2">{c.subject}</td>
                <td className="capitalize">{c.source || "Everyone"}</td>
                <td>{c.sent} / {c.total}</td>
                <td>{c.failed}</td>
                <td className="capitalize">{c.status}</td>
                <td className="whitespace-nowrap">{new Date(c.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
