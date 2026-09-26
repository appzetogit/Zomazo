import { useEffect, useMemo, useState } from "react"
import { Check, Search, X } from "lucide-react"

/**
 * The filter sheet from the mobile mockup (screen 10): price range, size,
 * colour and brand, with a live "Show N products" count.
 *
 * It edits a draft and hands it back on apply, so closing it changes nothing.
 * Options come from the search API's facets; `countFor(draft)` returns how
 * many products the draft would show.
 */

export const EMPTY_MOBILE_FILTERS = { brands: [], sizes: [], colours: [], minPrice: null, maxPrice: null }

export const activeFilterCount = (f) =>
  f.brands.length + f.sizes.length + f.colours.length + (f.minPrice != null || f.maxPrice != null ? 1 : 0)

function Section({ title, children, extra = null }) {
  return (
    <section className="border-b border-gray-100 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  )
}

const toggle = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

export default function FilterSheet({ open, onClose, value, onApply, facets, swatches = {}, countFor }) {
  const [draft, setDraft] = useState(value)
  const [brandQuery, setBrandQuery] = useState("")
  const [count, setCount] = useState(null)

  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  // A light count request as the draft changes, so the button tells the truth.
  useEffect(() => {
    if (!open || !countFor) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      Promise.resolve(countFor(draft))
        .then((n) => !cancelled && setCount(Number.isFinite(n) ? n : null))
        .catch(() => !cancelled && setCount(null))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, draft, countFor])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [open, onClose])

  const attr = (name) =>
    (facets?.attributes || []).find((a) => String(a.name).toLowerCase() === name)?.values || []
  const sizes = attr("size")
  const colours = attr("colour").length ? attr("colour") : attr("color")
  const brands = useMemo(
    () =>
      (facets?.brands || []).filter((b) => String(b.value).toLowerCase().includes(brandQuery.trim().toLowerCase())),
    [facets, brandQuery],
  )
  const range = facets?.priceRange || { min: 0, max: 0 }
  const lo = draft.minPrice ?? range.min
  const hi = draft.maxPrice ?? range.max
  const span = Math.max(1, range.max - range.min)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
      <button type="button" aria-label="Close filters" onClick={onClose} className="wh-reveal is-visible absolute inset-0 bg-black/40" />
      <div className="wh-slide-in-right absolute inset-0 flex flex-col bg-white">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 px-2">
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-gray-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <h2 className="flex-1 text-[17px] font-bold text-gray-900">Filters</h2>
          <button
            type="button"
            onClick={() => setDraft(EMPTY_MOBILE_FILTERS)}
            className="px-2 text-[13px] font-semibold text-[#EA580C]"
          >
            Clear All
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {range.max > range.min ? (
            <Section title="Price Range" extra={<span className="text-[12px] text-gray-500">₹{lo.toLocaleString("en-IN")} – ₹{hi.toLocaleString("en-IN")}</span>}>
              <div className="relative h-8">
                <span className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-200" />
                <span
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#EA580C]"
                  style={{ left: `${((lo - range.min) / span) * 100}%`, right: `${100 - ((hi - range.min) / span) * 100}%` }}
                />
                <input
                  type="range"
                  aria-label="Lowest price"
                  min={range.min}
                  max={range.max}
                  value={lo}
                  onChange={(e) => setDraft((d) => ({ ...d, minPrice: Math.min(Number(e.target.value), hi) }))}
                  className="wh-range absolute inset-0 w-full"
                />
                <input
                  type="range"
                  aria-label="Highest price"
                  min={range.min}
                  max={range.max}
                  value={hi}
                  onChange={(e) => setDraft((d) => ({ ...d, maxPrice: Math.max(Number(e.target.value), lo) }))}
                  className="wh-range absolute inset-0 w-full"
                />
              </div>
            </Section>
          ) : null}

          {sizes.length ? (
            <Section title="Size">
              <div className="flex flex-wrap gap-2">
                {sizes.map((s) => {
                  const on = draft.sizes.includes(s.value)
                  return (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft((d) => ({ ...d, sizes: toggle(d.sizes, s.value) }))}
                      className={`min-w-[44px] rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                        on ? "border-[#EA580C] bg-[#FFF1E7] text-[#C2410C]" : "border-gray-200 text-gray-700"
                      }`}
                    >
                      {s.value}
                    </button>
                  )
                })}
              </div>
            </Section>
          ) : null}

          {colours.length ? (
            <Section title="Color">
              <div className="flex flex-wrap gap-3">
                {colours.map((c) => {
                  const on = draft.colours.includes(c.value)
                  const hex = swatches[String(c.value).toLowerCase()] || "#d1d5db"
                  return (
                    <button
                      key={c.value}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${c.value} (${c.count})`}
                      onClick={() => setDraft((d) => ({ ...d, colours: toggle(d.colours, c.value) }))}
                      className="flex flex-col items-center gap-1"
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full border ${on ? "ring-2 ring-[#EA580C] ring-offset-2" : "border-gray-200"}`}
                        style={{ background: hex }}
                      >
                        {on ? <Check className={`h-4 w-4 ${/^#f|^#e|^#d/i.test(hex) ? "text-gray-900" : "text-white"}`} aria-hidden="true" /> : null}
                      </span>
                      <span className="text-[10px] text-gray-600">{c.value}</span>
                    </button>
                  )
                })}
              </div>
            </Section>
          ) : null}

          {(facets?.brands || []).length ? (
            <Section title="Brand">
              <label className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3">
                <Search className="h-4 w-4 text-gray-400" aria-hidden="true" />
                <span className="sr-only">Search brand</span>
                <input
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  placeholder="Search brand..."
                  className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
                />
              </label>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {brands.map((b) => {
                  const on = draft.brands.includes(b.value)
                  return (
                    <label key={b.value} className="flex cursor-pointer items-center gap-2 text-[13px] text-gray-800">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setDraft((d) => ({ ...d, brands: toggle(d.brands, b.value) }))}
                        className="h-4 w-4 accent-[#EA580C]"
                      />
                      <span className="truncate">{b.value}</span>
                      <span className="text-[11px] text-gray-400">({b.count})</span>
                    </label>
                  )
                })}
              </div>
            </Section>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-gray-100 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="h-12 w-full rounded-xl bg-[#EA580C] text-[15px] font-bold text-white shadow-md active:scale-[0.99]"
          >
            {count == null ? "Show products" : count ? `Show ${count.toLocaleString("en-IN")} Products` : "No products match"}
          </button>
        </div>
      </div>
    </div>
  )
}
