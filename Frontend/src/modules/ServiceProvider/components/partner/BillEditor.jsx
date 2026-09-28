import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button, Card, inputClass, inr } from "./ui"

/*
 * Extra services and parts added to a job's bill, picked from the platform's
 * vendor catalogue or typed in.
 *
 * The backend prices catalogue items itself (vendorBillController looks the
 * catalogId up and uses its price), so a catalogue line's price here is only a
 * preview; a typed-in line is billed at what was entered. The booked service is
 * always on the bill already and is not listed.
 *
 * `loadCatalog` returns { services, parts } -- the vendor and the worker read the
 * same catalogue from their own endpoints.
 */
const blank = { catalogId: "", name: "", price: "", quantity: 1 }

function Lines({ title, items, catalog, onChange }) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const pick = (i, catalogId) => {
    const c = catalog.find((x) => x._id === catalogId)
    update(i, c ? { catalogId, name: c.name, price: c.price } : { catalogId: "" })
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <button
          type="button"
          onClick={() => onChange([...items, { ...blank }])}
          className="flex items-center gap-1 text-sm font-semibold text-emerald-700"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {!items.length && <p className="text-xs text-slate-500">None added.</p>}
      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-xl bg-slate-50 p-2">
          {catalog.length > 0 && (
            <select className={inputClass} value={it.catalogId} onChange={(e) => pick(i, e.target.value)}>
              <option value="">Custom item</option>
              {catalog.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({inr(c.price)})
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-[1fr_5.5rem_4rem_auto] gap-2">
            <input
              className={inputClass}
              placeholder="Name"
              value={it.name}
              disabled={Boolean(it.catalogId)}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Price"
              inputMode="decimal"
              value={it.price}
              disabled={Boolean(it.catalogId)}
              onChange={(e) => update(i, { price: e.target.value.replace(/[^\d.]/g, "") })}
            />
            <input
              className={inputClass}
              inputMode="numeric"
              value={it.quantity}
              onChange={(e) => update(i, { quantity: e.target.value.replace(/\D/g, "") })}
            />
            <button
              type="button"
              aria-label="Remove"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="rounded-lg px-1 text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </Card>
  )
}

const clean = (items) =>
  items
    .filter((it) => it.catalogId || (it.name.trim() && Number(it.price) >= 0 && it.price !== ""))
    .map((it) => ({
      ...(it.catalogId ? { catalogId: it.catalogId } : {}),
      name: it.name.trim(),
      price: Number(it.price) || 0,
      quantity: Math.max(1, Number(it.quantity) || 1),
    }))

export default function BillEditor({ loadCatalog, submitLabel, onSubmit, busy }) {
  const [catalog, setCatalog] = useState({ services: [], parts: [] })
  const [services, setServices] = useState([])
  const [parts, setParts] = useState([])

  useEffect(() => {
    let alive = true
    loadCatalog()
      .then((c) => alive && setCatalog({ services: c.services || [], parts: c.parts || [] }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [loadCatalog])

  const preview = [...services, ...parts].reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0)

  return (
    <div className="space-y-3">
      <Lines title="Extra services" items={services} catalog={catalog.services} onChange={setServices} />
      <Lines title="Parts used" items={parts} catalog={catalog.parts} onChange={setParts} />
      {preview > 0 && <p className="text-right text-sm text-slate-600">Extras before tax: {inr(preview)}</p>}
      <Button className="w-full" loading={busy} onClick={() => onSubmit({ services: clean(services), parts: clean(parts) })}>
        {submitLabel}
      </Button>
    </div>
  )
}

// What a saved VendorBill looks like on screen.
export function BillSummary({ bill }) {
  if (!bill) return null
  const lines = [...(bill.services || []), ...(bill.parts || []), ...(bill.customItems || [])]
  return (
    <Card className="space-y-2">
      <p className="text-sm font-semibold">Bill</p>
      {lines.map((l, i) => (
        <div key={i} className="flex justify-between text-sm">
          <span className="text-slate-600">
            {l.name} {l.quantity > 1 ? `× ${l.quantity}` : ""}
          </span>
          <span>{inr(l.total ?? l.price * (l.quantity || 1))}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
        <span>Total</span>
        <span>{inr(bill.grandTotal)}</span>
      </div>
    </Card>
  )
}
