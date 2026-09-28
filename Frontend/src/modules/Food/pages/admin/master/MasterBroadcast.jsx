import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Loader2, Send, CheckCircle2, XCircle, MinusCircle, ExternalLink } from "lucide-react"
import { masterBroadcastAPI } from "@food/api"
import { ECOMMERCE_ENABLED, SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * Master > Broadcast: one push message to several services at once.
 *
 * Each service still sends its own (its own device tokens, inbox and history)
 * through the same endpoint its own Push Notifications screen uses; this page
 * only calls them one after another and shows how each went. A service that
 * fails does not stop the others.
 */

const AUDIENCES = [
  { key: "all", label: "Everyone" },
  { key: "customers", label: "Customers" },
  { key: "partners", label: "Partners", hint: "restaurants, stores, service vendors" },
  { key: "fleet", label: "Delivery & field", hint: "riders, drivers, service workers" },
]

/*
 * How each service names the audience. null: the service has no such group
 * (Taxi has no partner businesses), so it is skipped rather than sent to
 * everyone by mistake.
 */
const SERVICES = [
  {
    key: "food",
    label: "Food",
    own: "/admin/food/broadcast-notification",
    target: { all: "ALL", customers: "USER", partners: "RESTAURANT", fleet: "DELIVERY" },
    send: (t, msg) => masterBroadcastAPI.food({ title: msg.title, message: msg.message, link: msg.link || undefined, targetType: t }),
  },
  {
    key: "quick",
    label: "Quick & Medical",
    own: "/admin/quick-commerce/broadcast-notification",
    target: { all: "ALL", customers: "USER", partners: "RESTAURANT", fleet: "DELIVERY" },
    send: (t, msg) => masterBroadcastAPI.quick({ title: msg.title, message: msg.message, link: msg.link || undefined, targetType: t }),
  },
  {
    key: "taxi",
    label: "Taxi",
    own: "/taxi/admin/promotions/send-notification",
    target: { all: "all", customers: "users", partners: null, fleet: "drivers" },
    // Taxi sends per city, so "every city" is one send per service location.
    send: async (t, msg, ctx) => {
      const ids = ctx.taxiLocation ? [ctx.taxiLocation] : ctx.taxiLocations.map((l) => l.id)
      if (!ids.length) throw new Error("No taxi cities to send to")
      for (const id of ids) {
        await masterBroadcastAPI.taxi({ service_location_id: id, send_to: t, push_title: msg.title, message: msg.message })
      }
      return { cities: ids.length }
    },
  },
  ...(SERVICE_PROVIDER_ENABLED
    ? [{
      key: "services",
      label: "Services",
      own: "/admin/sp/broadcast",
      target: { all: "all", customers: "customers", partners: "vendors", fleet: "workers" },
      send: (t, msg) => masterBroadcastAPI.services({ title: msg.title, message: msg.message, link: msg.link || undefined, audiences: t }),
    }]
    : []),
  // The Shop ships by courier: it has sellers but no riders of its own.
  ...(ECOMMERCE_ENABLED
    ? [{
      key: "shop",
      label: "Shop",
      own: "/admin/shop/broadcast-notification",
      target: { all: "ALL", customers: "USER", partners: "SELLER", fleet: null },
      send: (t, msg) => masterBroadcastAPI.shop({ title: msg.title, message: msg.message, link: msg.link || undefined, targetType: t }),
    }]
    : []),
]

const errText = (err) => err?.response?.data?.message || err?.message || "Failed"
const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"

function ResultIcon({ state }) {
  if (state === "sending") return <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
  if (state === "sent") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (state === "failed") return <XCircle className="h-4 w-4 text-red-600" />
  return <MinusCircle className="h-4 w-4 text-neutral-400" />
}

export default function MasterBroadcast() {
  const [msg, setMsg] = useState({ title: "", message: "", link: "" })
  const [audience, setAudience] = useState("customers")
  const [chosen, setChosen] = useState(() => SERVICES.map((s) => s.key))
  const [taxiLocations, setTaxiLocations] = useState([])
  const [taxiLocation, setTaxiLocation] = useState("")
  const [results, setResults] = useState({})
  const [sending, setSending] = useState(false)

  useEffect(() => {
    masterBroadcastAPI.taxiLocations()
      .then((res) => {
        const body = res?.data?.data ?? res?.data
        const rows = body?.results || body?.data || body || []
        setTaxiLocations((Array.isArray(rows) ? rows : []).map((l) => ({ id: String(l._id || l.id), name: l.name || l.service_location_name || "City" })))
      })
      .catch(() => setTaxiLocations([]))
  }, [])

  const toggle = (key) => setChosen((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const send = async (e) => {
    e.preventDefault()
    const targets = SERVICES.filter((s) => chosen.includes(s.key))
    if (!targets.length) {
      toast.error("Choose at least one service")
      return
    }
    const who = AUDIENCES.find((a) => a.key === audience)?.label
    if (!window.confirm(`Send "${msg.title}" to ${who.toLowerCase()} in ${targets.map((t) => t.label).join(", ")}? This cannot be undone.`)) return

    setSending(true)
    const next = Object.fromEntries(targets.map((s) => [s.key, { state: "sending" }]))
    setResults(next)
    for (const s of targets) {
      const t = s.target[audience]
      if (t === null) {
        next[s.key] = { state: "skipped", note: `${s.label} has no ${who.toLowerCase()}` }
      } else {
        try {
          const out = await s.send(t, msg, { taxiLocation, taxiLocations })
          next[s.key] = { state: "sent", note: out?.cities ? `${out.cities} ${out.cities === 1 ? "city" : "cities"}` : "" }
        } catch (err) {
          next[s.key] = { state: "failed", note: errText(err) }
        }
      }
      setResults({ ...next })
    }
    setSending(false)
    const failed = Object.values(next).filter((r) => r.state === "failed").length
    if (failed) toast.error(`${failed} service${failed === 1 ? "" : "s"} failed; see below`)
    else toast.success("Broadcast sent")
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Broadcast</h1>
          <p className="mt-1 text-sm text-neutral-600">One push message to every service you pick, sent through each service&rsquo;s own notifications.</p>
        </div>

        <form onSubmit={send} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-5">
          <fieldset>
            <legend className="text-sm font-medium text-neutral-800">Services</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SERVICES.map((s) => (
                <label key={s.key} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${chosen.includes(s.key) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700"}`}>
                  <input type="checkbox" className="sr-only" checked={chosen.includes(s.key)} onChange={() => toggle(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-neutral-800">Who</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {AUDIENCES.map((a) => (
                <label key={a.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${audience === a.key ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}>
                  <input type="radio" name="audience" className="mt-0.5" checked={audience === a.key} onChange={() => setAudience(a.key)} />
                  <span>
                    <span className="font-medium text-neutral-900">{a.label}</span>
                    {a.hint && <span className="block text-xs text-neutral-500">{a.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {chosen.includes("taxi") && (
            <div>
              <label className="text-sm font-medium text-neutral-800" htmlFor="taxi-city">Taxi city</label>
              <select id="taxi-city" className={`${inputCls} mt-1`} value={taxiLocation} onChange={(e) => setTaxiLocation(e.target.value)}>
                <option value="">Every city ({taxiLocations.length})</option>
                {taxiLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-neutral-800" htmlFor="bc-title">Title</label>
            <input id="bc-title" className={`${inputCls} mt-1`} maxLength={120} required value={msg.title} onChange={(e) => setMsg((m) => ({ ...m, title: e.target.value }))} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-800" htmlFor="bc-message">Message</label>
            <textarea id="bc-message" className={`${inputCls} mt-1 min-h-[96px]`} maxLength={1000} required value={msg.message} onChange={(e) => setMsg((m) => ({ ...m, message: e.target.value }))} />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-800" htmlFor="bc-link">Open on tap <span className="font-normal text-neutral-500">(optional; Taxi ignores it)</span></label>
            <input id="bc-link" className={`${inputCls} mt-1`} placeholder="/offers" value={msg.link} onChange={(e) => setMsg((m) => ({ ...m, link: e.target.value }))} />
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={sending} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-300">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </div>
        </form>

        {Object.keys(results).length > 0 && (
          <section className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-100 px-5 py-3 text-sm font-semibold text-neutral-900">This send</h2>
            <ul className="divide-y divide-neutral-100">
              {SERVICES.filter((s) => results[s.key]).map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="flex items-center gap-2">
                    <ResultIcon state={results[s.key].state} />
                    <span className="font-medium text-neutral-900">{s.label}</span>
                    <span className="text-neutral-500">{results[s.key].state}{results[s.key].note ? ` · ${results[s.key].note}` : ""}</span>
                  </span>
                  <Link to={s.own} className="inline-flex items-center gap-1 text-neutral-600 hover:underline">
                    History <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
