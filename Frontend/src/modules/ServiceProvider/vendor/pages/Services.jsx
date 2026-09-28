import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Button, Card, Empty, Shell, Spinner, errorMessage, inputClass, inr } from "../../components/partner/ui"
import { BASE, vendorApi } from "../vendorApi"

/*
 * What this vendor offers.
 *
 * Categories decide which bookings are offered to the vendor at all (the booking
 * query matches serviceCategory against the vendor's `service` list), so they are
 * the first thing to set. Per-service price and on/off are the vendor's own
 * overrides (sp_vendor_services), never the platform catalogue itself.
 */
function Categories() {
  const [all, setAll] = useState(null)
  const [mine, setMine] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([vendorApi.categories(), vendorApi.profile()])
      .then(([c, p]) => {
        setAll(c?.categories || [])
        setMine(p?.vendor?.service || [])
      })
      .catch(() => setAll([]))
  }, [])

  const toggle = (title) => setMine((m) => (m.includes(title) ? m.filter((x) => x !== title) : [...m, title]))

  const save = async () => {
    setBusy(true)
    try {
      await vendorApi.updateProfile({ serviceCategory: mine })
      toast.success("Categories saved")
    } catch (error) {
      toast.error(errorMessage(error, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  if (!all) return <Spinner />
  return (
    <Card className="space-y-3">
      <div>
        <p className="font-semibold">Categories you serve</p>
        <p className="text-xs text-slate-500">You only receive booking requests in these categories.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {all.map((c) => {
          const on = mine.includes(c.title)
          return (
            <button
              key={c.id || c._id || c.title}
              type="button"
              onClick={() => toggle(c.title)}
              className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              {c.title}
            </button>
          )
        })}
      </div>
      <Button className="w-full" loading={busy} onClick={save}>
        Save categories
      </Button>
    </Card>
  )
}

function ServiceRow({ service, onSaved }) {
  const [price, setPrice] = useState(service.vendorPrice ?? "")
  const [busy, setBusy] = useState(null)
  const available = service.vendorAvailable !== false
  const catalogPrice = service.discountPrice || service.basePrice

  const run = async (key, fn, msg) => {
    setBusy(key)
    try {
      await fn()
      toast.success(msg)
      onSaved()
    } catch (error) {
      toast.error(errorMessage(error, "Could not save"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{service.title}</p>
          <p className="text-xs text-slate-500">
            {service.categoryId?.title || service.categoryIds?.[0]?.title || "Service"} · platform price {inr(catalogPrice)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          disabled={busy === "avail"}
          onClick={() => run("avail", () => vendorApi.setAvailability(service._id, !available), available ? "Turned off" : "Turned on")}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${available ? "bg-emerald-600" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${available ? "left-5" : "left-0.5"}`} />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="Your price (blank = platform price)"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
        />
        <Button variant="secondary" loading={busy === "price"} onClick={() => run("price", () => vendorApi.setPrice(service._id, price === "" ? null : Number(price)), "Price saved")}>
          Save
        </Button>
      </div>
    </Card>
  )
}

export default function Services() {
  const [items, setItems] = useState(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  const load = useCallback(async (p = 1) => {
    try {
      const res = await vendorApi.services({ page: p, limit: 30 })
      setItems((prev) => (p === 1 ? res?.data || [] : [...(prev || []), ...(res?.data || [])]))
      setPage(p)
      setPages(res?.pagination?.pages || 1)
    } catch {
      if (p === 1) setItems([])
    }
  }, [])

  useEffect(() => {
    load(1)
  }, [load])

  return (
    <Shell title="My services" back={`${BASE}/profile`}>
      <Categories />
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Services and prices</h2>
      {!items ? (
        <Spinner />
      ) : items.length ? (
        <div className="space-y-2">
          {items.map((s) => (
            <ServiceRow key={s._id} service={s} onSaved={() => load(1)} />
          ))}
          {page < pages && (
            <Button variant="secondary" className="w-full" onClick={() => load(page + 1)}>
              Load more
            </Button>
          )}
        </div>
      ) : (
        <Empty title="No services in the catalogue yet" />
      )}
    </Shell>
  )
}
