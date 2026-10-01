import { useState } from "react"
import { toast } from "sonner"
import { helpDeskAPI } from "@food/api"

/**
 * One help-centre ticket's conversation, opened on demand, with a box to write
 * back (core/support/supportThread.js). Rides tickets are answered in the
 * Rides app, so they show the conversation without the box.
 */
export default function TicketThread({ ticket }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const canReply = !String(ticket.key || "").startsWith("taxi:")

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || messages) return
    try {
      const res = await helpDeskAPI.getTicket(ticket.key)
      setMessages(res?.data?.data?.ticket?.messages || [])
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load the conversation")
    }
  }

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      const res = await helpDeskAPI.reply(ticket.key, text.trim())
      setMessages(res?.data?.data?.ticket?.messages || [])
      setText("")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not send")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-2">
      {!open && ticket.reply ? (
        <p className="text-xs text-slate-600 dark:text-slate-300">Reply: {ticket.reply}</p>
      ) : null}
      <button type="button" onClick={toggle} className="text-xs font-medium text-blue-600 mt-1">
        {open ? "Hide conversation" : "View conversation"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {messages === null ? <p className="text-xs text-slate-500">Loading...</p> : null}
          {(messages || []).map((m, i) => (
            <div key={i} className={`flex ${m.from === "admin" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap ${m.from === "admin" ? "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100" : "bg-blue-600 text-white"}`}>
                <div className="font-semibold mb-0.5">{m.from === "admin" ? "Support" : "You"}</div>
                {m.message}
                {m.at ? <div className="opacity-70 mt-0.5">{new Date(m.at).toLocaleString()}</div> : null}
              </div>
            </div>
          ))}
          {canReply ? (
            <form onSubmit={send} className="flex gap-2">
              <input
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a message"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-transparent"
              />
              <button type="submit" disabled={sending || !text.trim()} className="px-3 py-2 text-xs rounded-lg bg-blue-600 text-white disabled:opacity-50">Send</button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
