import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, X } from "lucide-react"
import { couponListAPI } from "@food/api"
import { ECOMMERCE_ENABLED, SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * Make or edit a platform coupon: one code the services it names all honour,
 * platform-funded, with its uses counted per customer across all of them
 * (core/promotions/platformCoupon.model.js).
 */

const SERVICES = [
  { key: "food", label: "Food" },
  { key: "quickCommerce", label: "Quick & Medical" },
  { key: "taxi", label: "Rides" },
  ...(ECOMMERCE_ENABLED ? [{ key: "ecommerce", label: "Shop" }] : []),
  ...(SERVICE_PROVIDER_ENABLED ? [{ key: "serviceProvider", label: "Services" }] : []),
]

const EMPTY = {
  code: "",
  title: "",
  services: [],
  discountType: "flat",
  discountValue: "",
  maxDiscount: "",
  minOrderValue: "",
  audience: "all",
  perUserLimit: "1",
  usageLimit: "",
  startDate: "",
  endDate: "",
}

// The admin's local calendar day, for a date input.
const toInputDate = (v) => {
  if (!v) return ""
  const d = new Date(v)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const errorText = (err, fallback) => err?.response?.data?.message || fallback

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none"
const label = "mb-1 block text-xs font-medium text-neutral-700"

export default function PlatformCouponForm({ couponId = null, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(Boolean(couponId))
  const [saving, setSaving] = useState(false)
  const [used, setUsed] = useState(0)

  useEffect(() => {
    if (!couponId) return undefined
    let cancelled = false
    couponListAPI
      .getPlatform(couponId)
      .then((res) => {
        const c = res?.data?.data
        if (cancelled || !c) return
        setUsed(Number(c.usedCount) || 0)
        setForm({
          code: c.code || "",
          title: c.title || "",
          services: c.services || [],
          discountType: c.discountType || "flat",
          discountValue: String(c.discountValue ?? ""),
          maxDiscount: c.maxDiscount ? String(c.maxDiscount) : "",
          minOrderValue: c.minOrderValue ? String(c.minOrderValue) : "",
          audience: c.audience || "all",
          perUserLimit: String(c.perUserLimit ?? ""),
          usageLimit: c.usageLimit ? String(c.usageLimit) : "",
          startDate: toInputDate(c.startDate),
          endDate: toInputDate(c.endDate),
        })
      })
      .catch((err) => toast.error(errorText(err, "Could not load this coupon.")))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [couponId])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const toggleService = (key) =>
    setForm((f) => ({
      ...f,
      services: f.services.includes(key) ? f.services.filter((s) => s !== key) : [...f.services, key],
    }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.services.length) {
      toast.error("Pick at least one service")
      return
    }
    const num = (v) => (v === "" ? 0 : Number(v))
    const body = {
      code: form.code.trim().toUpperCase(),
      title: form.title.trim(),
      services: form.services,
      discountType: form.discountType,
      discountValue: num(form.discountValue),
      maxDiscount: form.discountType === "percentage" ? num(form.maxDiscount) : 0,
      minOrderValue: num(form.minOrderValue),
      audience: form.audience,
      perUserLimit: num(form.perUserLimit),
      usageLimit: num(form.usageLimit),
      // The admin's own day boundaries, sent as exact instants: the start of the
      // start day and the end of the end day (inclusive).
      startDate: form.startDate ? new Date(`${form.startDate}T00:00:00`).toISOString() : null,
      endDate: form.endDate ? new Date(`${form.endDate}T23:59:59`).toISOString() : null,
    }
    setSaving(true)
    try {
      if (couponId) await couponListAPI.updatePlatform(couponId, body)
      else await couponListAPI.createPlatform(body)
      toast.success(couponId ? `${body.code} saved` : `${body.code} created`)
      onSaved?.()
    } catch (err) {
      toast.error(errorText(err, "Could not save this coupon."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{couponId ? "Edit coupon" : "New coupon for several services"}</h2>
            <p className="mt-0.5 text-xs text-neutral-600">
              Funded by the platform. A customer&apos;s uses count across every service you pick.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="pc-code">Code</label>
                <input
                  id="pc-code"
                  className={`${field} font-mono uppercase`}
                  value={form.code}
                  onChange={set("code")}
                  required
                  pattern="[A-Za-z0-9_\-]{3,20}"
                  title="3-20 letters, digits, - or _"
                  disabled={Boolean(couponId) && used > 0}
                />
                {Boolean(couponId) && used > 0 && <p className="mt-1 text-[11px] text-neutral-500">Used {used} times, so the code stays.</p>}
              </div>
              <div>
                <label className={label} htmlFor="pc-title">Title (optional)</label>
                <input id="pc-title" className={field} value={form.title} onChange={set("title")} maxLength={80} />
              </div>
            </div>

            <fieldset>
              <legend className={label}>Works in</legend>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((s) => (
                  <label
                    key={s.key}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                      form.services.includes(s.key) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700"
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={form.services.includes(s.key)} onChange={() => toggleService(s.key)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="pc-type">Discount</label>
                <select id="pc-type" className={field} value={form.discountType} onChange={set("discountType")}>
                  <option value="flat">Fixed amount (₹)</option>
                  <option value="percentage">Percentage (%)</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="pc-value">{form.discountType === "percentage" ? "Percent off" : "Rupees off"}</label>
                <input id="pc-value" type="number" min="1" max={form.discountType === "percentage" ? 100 : undefined} step="any" className={field} value={form.discountValue} onChange={set("discountValue")} required />
              </div>
              {form.discountType === "percentage" && (
                <div>
                  <label className={label} htmlFor="pc-max">Maximum discount (₹, 0 = none)</label>
                  <input id="pc-max" type="number" min="0" className={field} value={form.maxDiscount} onChange={set("maxDiscount")} />
                </div>
              )}
              <div>
                <label className={label} htmlFor="pc-min">Minimum order (₹)</label>
                <input id="pc-min" type="number" min="0" className={field} value={form.minOrderValue} onChange={set("minOrderValue")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="pc-audience">Who can use it</label>
                <select id="pc-audience" className={field} value={form.audience} onChange={set("audience")}>
                  <option value="all">Everyone</option>
                  <option value="first_order">First order in that service</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="pc-peruser">Uses per customer (0 = no limit)</label>
                <input id="pc-peruser" type="number" min="0" className={field} value={form.perUserLimit} onChange={set("perUserLimit")} />
              </div>
              <div>
                <label className={label} htmlFor="pc-total">Total uses (0 = no limit)</label>
                <input id="pc-total" type="number" min="0" className={field} value={form.usageLimit} onChange={set("usageLimit")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="pc-start">Starts (optional)</label>
                <input id="pc-start" type="date" className={field} value={form.startDate} onChange={set("startDate")} />
              </div>
              <div>
                <label className={label} htmlFor="pc-end">Ends (optional)</label>
                <input id="pc-end" type="date" className={field} value={form.endDate} onChange={set("endDate")} />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {couponId ? "Save" : "Create coupon"}
          </button>
        </div>
      </form>
    </div>
  )
}
