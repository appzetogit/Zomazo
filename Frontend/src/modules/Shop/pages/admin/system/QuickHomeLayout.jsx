import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { adminAPI, uploadAPI } from "@/services/api"

/**
 * Editor for the Quick phone home (QUICK_MOBILE_SPEC.md §3): the themed tabs
 * and their promo tiles, rewards banner and offer strip; the featured cards;
 * the campaign banners; and the category groups.
 *
 * One layout per zone, falling back to the global one, so a festival can run
 * everywhere or in one city. Images upload through /uploads/image; links are
 * app paths such as /quick/category/milk or /quick/search?minDiscount=35.
 */

const input =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none"
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
const smallBtn =
  "inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"

const blankTheme = () => ({
  slug: "",
  label: "",
  iconUrl: "",
  backgroundUrl: "",
  accent: "",
  poweredBy: [],
  promoTiles: [
    { title: "", imageUrl: "", link: "" },
    { title: "", imageUrl: "", link: "" },
    { title: "", imageUrl: "", link: "" },
  ],
  rewards: { title: "", subtitle: "", thumbs: [], link: "" },
  offerStrip: { text: "", link: "" },
  startsAt: "",
  endsAt: "",
  isActive: true,
})
const blankFeatured = () => ({ title: "", badge: "Featured", style: "featured", artUrl: "", link: "", isActive: true })
const blankCampaign = () => ({
  title: "",
  subtitle: "",
  artUrl: "",
  poweredBy: [],
  ctaText: "Shop now",
  link: "",
  tint: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
})
const blankGroup = () => ({ title: "", parentCategoryId: "" })

const toDateInput = (value) => (value ? String(value).slice(0, 10) : "")

/** Up/down/remove controls for one entry in a list. */
function RowControls({ index, count, onMove, onRemove }) {
  return (
    <div className="flex gap-1">
      <button type="button" className={smallBtn} disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move up">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={smallBtn} disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="Move down">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={`${smallBtn} text-red-600`} onClick={() => onRemove(index)} aria-label="Remove">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** An image field: preview, upload, clear, and the URL for pasting. */
function ImageField({ title, value, folder, onChange, hint }) {
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const res = await uploadAPI.uploadMedia(file, { folder })
      const url = res?.data?.data?.url
      if (!url) throw new Error("No URL came back")
      onChange(url)
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Upload failed")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <span className={label}>{title}</span>
      <div className="flex items-center gap-2">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-4 w-4 text-slate-400" />}
        </div>
        <input className={input} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="/uploads/… or https://…" />
        <label className={`${smallBtn} cursor-pointer whitespace-nowrap`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          Upload
          <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  )
}

function Field({ title, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      <input type={type} className={input} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function Toggle({ checked, onChange, text = "Active" }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked !== false} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  )
}

function BrandsField({ brands = [], folder, onChange }) {
  const set = (i, patch) => onChange(brands.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <div>
      <span className={label}>Powered by (real partners only — hidden when empty)</span>
      <div className="space-y-2">
        {brands.map((b, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input className={input} value={b.name || ""} onChange={(e) => set(i, { name: e.target.value })} placeholder="Brand name" />
            <ImageField title="Logo" value={b.logoUrl} folder={folder} onChange={(url) => set(i, { logoUrl: url })} />
            <button type="button" className={`${smallBtn} h-fit self-end text-red-600`} onClick={() => onChange(brands.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {brands.length < 4 ? (
          <button type="button" className={smallBtn} onClick={() => onChange([...brands, { name: "", logoUrl: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add brand
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ThemeEditor({ theme, onChange }) {
  const set = (patch) => onChange({ ...theme, ...patch })
  const folder = `quick/themes/${theme.slug || "new"}`
  const tiles = theme.promoTiles?.length ? theme.promoTiles : blankTheme().promoTiles
  const setTile = (i, patch) => set({ promoTiles: tiles.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  const thumbs = theme.rewards?.thumbs || []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field title="Tab label" value={theme.label} onChange={(v) => set({ label: v })} placeholder="All, Festive…" />
        <Field
          title="Slug"
          value={theme.slug}
          onChange={(v) => set({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
          placeholder="all"
        />
        <Field title="Accent (hex)" value={theme.accent} onChange={(v) => set({ accent: v })} placeholder="#E8A53A" />
        <div className="flex items-end">
          <Toggle checked={theme.isActive} onChange={(v) => set({ isActive: v })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field title="Starts" type="date" value={toDateInput(theme.startsAt)} onChange={(v) => set({ startsAt: v || null })} />
        <Field title="Ends" type="date" value={toDateInput(theme.endsAt)} onChange={(v) => set({ endsAt: v || null })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ImageField title="Tab icon" value={theme.iconUrl} folder={folder} onChange={(v) => set({ iconUrl: v })} hint="48×48 line icon, one colour" />
        <ImageField title="Background art" value={theme.backgroundUrl} folder={folder} onChange={(v) => set({ backgroundUrl: v })} hint="1080×960, calm across the top" />
      </div>

      <div>
        <h4 className="mb-2 text-sm font-bold text-slate-800">Promo tiles</h4>
        <div className="grid gap-3 lg:grid-cols-3">
          {tiles.map((tile, i) => (
            <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <Field title={`Tile ${i + 1} title`} value={tile.title} onChange={(v) => setTile(i, { title: v })} placeholder="Buy 2 Get 1 Free" />
              <Field title="Link" value={tile.link} onChange={(v) => setTile(i, { link: v })} placeholder="/quick/search?minDiscount=35" />
              <ImageField title="Product cluster" value={tile.imageUrl} folder={folder} onChange={(v) => setTile(i, { imageUrl: v })} hint="420×420, transparent" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <h4 className="text-sm font-bold text-slate-800">Rewards banner</h4>
          <Field title="Title" value={theme.rewards?.title} onChange={(v) => set({ rewards: { ...theme.rewards, title: v } })} placeholder="Win assured rewards" />
          <Field title="Subtitle" value={theme.rewards?.subtitle} onChange={(v) => set({ rewards: { ...theme.rewards, subtitle: v } })} placeholder="Shop for ₹249 or more to avail" />
          <Field title="Link" value={theme.rewards?.link} onChange={(v) => set({ rewards: { ...theme.rewards, link: v } })} placeholder="/spin opens Spin & Win" />
          {[0, 1, 2].map((i) => (
            <ImageField
              key={i}
              title={`Photo ${i + 1}`}
              value={thumbs[i] || ""}
              folder={folder}
              onChange={(v) => {
                const next = [...thumbs]
                next[i] = v
                set({ rewards: { ...theme.rewards, thumbs: next.filter(Boolean) } })
              }}
            />
          ))}
        </div>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <h4 className="text-sm font-bold text-slate-800">Offer strip</h4>
          <Field title="Text" value={theme.offerStrip?.text} onChange={(v) => set({ offerStrip: { ...theme.offerStrip, text: v } })} placeholder="Extra 5% OFF on first order above ₹249" />
          <Field title="Link" value={theme.offerStrip?.link} onChange={(v) => set({ offerStrip: { ...theme.offerStrip, link: v } })} placeholder="/quick/search?q=organic" />
          <BrandsField brands={theme.poweredBy || []} folder={`${folder}/brands`} onChange={(v) => set({ poweredBy: v })} />
        </div>
      </div>
    </div>
  )
}

export default function QuickHomeLayout() {
  const [zones, setZones] = useState([])
  const [categories, setCategories] = useState([])
  const [zoneId, setZoneId] = useState("")
  const [layout, setLayout] = useState(null)
  const [inherited, setInherited] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openTheme, setOpenTheme] = useState(0)

  useEffect(() => {
    adminAPI.getZones().then((res) => {
      const d = res?.data?.data
      setZones(d?.zones || d?.items || (Array.isArray(d) ? d : []))
    }).catch(() => setZones([]))
    adminAPI.getPublicCategories().then((res) => {
      const list = res?.data?.data?.categories || res?.data?.categories || []
      setCategories(Array.isArray(list) ? list : [])
    }).catch(() => setCategories([]))
  }, [])

  const load = (zone) => {
    setLoading(true)
    adminAPI
      .getQuickHomeLayout(zone || undefined)
      .then((res) => {
        const d = res?.data?.data || {}
        const l = d.layout || {}
        setInherited(Boolean(d.inherited) && Boolean(zone))
        setLayout({
          themes: (l.themes || []).map((t) => ({ ...blankTheme(), ...t })),
          featured: l.featured || [],
          campaigns: l.campaigns || [],
          categoryGroups: (l.categoryGroups || []).map((g) => ({ ...g, parentCategoryId: String(g.parentCategoryId || "") })),
        })
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Could not load the layout"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(zoneId)
  }, [zoneId])

  const parents = useMemo(() => categories.filter((c) => !c.parentId), [categories])

  const update = (key, value) => setLayout((l) => ({ ...l, [key]: value }))
  const move = (key) => (index, dir) =>
    setLayout((l) => {
      const list = [...l[key]]
      const [item] = list.splice(index, 1)
      list.splice(index + dir, 0, item)
      return { ...l, [key]: list }
    })
  const remove = (key) => (index) => setLayout((l) => ({ ...l, [key]: l[key].filter((_, i) => i !== index) }))

  const save = async () => {
    setSaving(true)
    try {
      // Order on screen is the order on the phone.
      const withOrder = (list) => list.map((item, i) => ({ ...item, sortOrder: i }))
      const payload = {
        themes: withOrder(layout.themes),
        featured: withOrder(layout.featured),
        campaigns: withOrder(layout.campaigns),
        categoryGroups: withOrder(layout.categoryGroups.filter((g) => g.parentCategoryId)),
      }
      await adminAPI.saveQuickHomeLayout(zoneId || undefined, payload)
      toast.success(zoneId ? "Saved for this zone" : "Saved for every zone without its own layout")
      load(zoneId)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    if (!zoneId) return
    try {
      await adminAPI.resetQuickHomeLayout(zoneId)
      toast.success("This zone now uses the global layout")
      load(zoneId)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not reset")
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quick home layout</h1>
          <p className="text-sm text-slate-500">
            What the Quick storefront shows on phones: themed tabs, featured cards, campaigns and category groups.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${input} w-auto`} value={zoneId} onChange={(e) => setZoneId(e.target.value)} aria-label="Zone">
            <option value="">All zones (global)</option>
            {zones.map((z) => (
              <option key={z._id} value={z._id}>
                {z.name || z.zoneName}
              </option>
            ))}
          </select>
          <a href="/quick" target="_blank" rel="noreferrer" className={smallBtn}>
            <ExternalLink className="h-3.5 w-3.5" /> Preview
          </a>
          {zoneId && !inherited ? (
            <button type="button" onClick={reset} className={smallBtn}>
              <RotateCcw className="h-3.5 w-3.5" /> Use global
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || loading || !layout}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>

      {zoneId && inherited ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          This zone has no layout of its own and shows the global one below. Saving creates one just for this zone.
        </p>
      ) : null}

      {loading || !layout ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <section className={card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Themes (tabs)</h2>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  update("themes", [...layout.themes, blankTheme()])
                  setOpenTheme(layout.themes.length)
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add theme
              </button>
            </div>
            <div className="space-y-3">
              {layout.themes.map((theme, i) => (
                <div key={i} className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between gap-2 p-3">
                    <button type="button" onClick={() => setOpenTheme(openTheme === i ? -1 : i)} className="min-w-0 flex-1 text-left">
                      <span className="font-semibold text-slate-900">{theme.label || "Untitled theme"}</span>
                      <span className="ml-2 text-xs text-slate-400">{theme.slug}</span>
                      {theme.isActive === false ? <span className="ml-2 text-xs text-red-500">off</span> : null}
                    </button>
                    <RowControls index={i} count={layout.themes.length} onMove={move("themes")} onRemove={remove("themes")} />
                  </div>
                  {openTheme === i ? (
                    <div className="border-t border-slate-200 p-3">
                      <ThemeEditor
                        theme={theme}
                        onChange={(next) => update("themes", layout.themes.map((t, j) => (j === i ? next : t)))}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
              {!layout.themes.length ? <p className="text-sm text-slate-500">No themes — phones show the built-in "All" theme.</p> : null}
            </div>
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Featured this week</h2>
              <button type="button" className={smallBtn} onClick={() => update("featured", [...layout.featured, blankFeatured()])}>
                <Plus className="h-3.5 w-3.5" /> Add card
              </button>
            </div>
            <div className="space-y-3">
              {layout.featured.map((f, i) => {
                const set = (patch) => update("featured", layout.featured.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <div key={i} className="grid gap-3 rounded-lg bg-slate-50 p-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
                    <Field title="Title" value={f.title} onChange={(v) => set({ title: v })} placeholder="Juice Corner" />
                    <Field title="Badge" value={f.badge} onChange={(v) => set({ badge: v })} placeholder="Featured" />
                    <label className="block">
                      <span className={label}>Style</span>
                      <select className={input} value={f.style || "featured"} onChange={(e) => set({ style: e.target.value })}>
                        <option value="featured">Featured (bordered)</option>
                        <option value="launch">Newly launched (warm)</option>
                      </select>
                    </label>
                    <div className="flex items-end justify-end">
                      <RowControls index={i} count={layout.featured.length} onMove={move("featured")} onRemove={remove("featured")} />
                    </div>
                    <Field title="Link" value={f.link} onChange={(v) => set({ link: v })} placeholder="/quick/search?q=juice" />
                    <div className="lg:col-span-2">
                      <ImageField title="Art" value={f.artUrl} folder="quick/featured" onChange={(v) => set({ artUrl: v })} hint="600×750, top 30% clear for the title" />
                    </div>
                    <div className="flex items-end">
                      <Toggle checked={f.isActive} onChange={(v) => set({ isActive: v })} />
                    </div>
                  </div>
                )
              })}
              {!layout.featured.length ? <p className="text-sm text-slate-500">No featured cards — the row is hidden.</p> : null}
            </div>
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Campaign banners</h2>
              <button type="button" className={smallBtn} onClick={() => update("campaigns", [...layout.campaigns, blankCampaign()])}>
                <Plus className="h-3.5 w-3.5" /> Add campaign
              </button>
            </div>
            <div className="space-y-3">
              {layout.campaigns.map((c, i) => {
                const set = (patch) => update("campaigns", layout.campaigns.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
                    <div className="flex justify-end">
                      <RowControls index={i} count={layout.campaigns.length} onMove={move("campaigns")} onRemove={remove("campaigns")} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field title="Headline" value={c.title} onChange={(v) => set({ title: v })} placeholder="Everything you need for Visarjan" />
                      <Field title="Subtitle" value={c.subtitle} onChange={(v) => set({ subtitle: v })} placeholder="Give Bappa a warm farewell" />
                      <Field title="Button" value={c.ctaText} onChange={(v) => set({ ctaText: v })} placeholder="Shop now" />
                      <Field title="Link" value={c.link} onChange={(v) => set({ link: v })} placeholder="/quick/search?q=pooja" />
                      <Field title="Tint behind the art (hex)" value={c.tint} onChange={(v) => set({ tint: v })} placeholder="#3AA6B9" />
                      <div className="flex items-end">
                        <Toggle checked={c.isActive} onChange={(v) => set({ isActive: v })} />
                      </div>
                      <Field title="Starts" type="date" value={toDateInput(c.startsAt)} onChange={(v) => set({ startsAt: v || null })} />
                      <Field title="Ends" type="date" value={toDateInput(c.endsAt)} onChange={(v) => set({ endsAt: v || null })} />
                    </div>
                    <ImageField title="Art" value={c.artUrl} folder="quick/campaigns" onChange={(v) => set({ artUrl: v })} hint="1360×680, left 55% kept clear for the copy" />
                    <BrandsField brands={c.poweredBy || []} folder="quick/campaigns/brands" onChange={(v) => set({ poweredBy: v })} />
                  </div>
                )
              })}
              {!layout.campaigns.length ? <p className="text-sm text-slate-500">No campaigns — none are shown.</p> : null}
            </div>
          </section>

          <section className={card}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Category groups</h2>
              <button type="button" className={smallBtn} onClick={() => update("categoryGroups", [...layout.categoryGroups, blankGroup()])}>
                <Plus className="h-3.5 w-3.5" /> Add group
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-500">
              Each group shows a parent category&apos;s subcategories, four across. With none chosen, every parent that has subcategories is shown.
            </p>
            <div className="space-y-2">
              {layout.categoryGroups.map((g, i) => {
                const set = (patch) => update("categoryGroups", layout.categoryGroups.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <div key={i} className="grid items-end gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Field title="Heading" value={g.title} onChange={(v) => set({ title: v })} placeholder="Grocery & Kitchen" />
                    <label className="block">
                      <span className={label}>Parent category</span>
                      <select className={input} value={g.parentCategoryId} onChange={(e) => set({ parentCategoryId: e.target.value })}>
                        <option value="">Choose…</option>
                        {parents.map((c) => (
                          <option key={c._id || c.id} value={c._id || c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <RowControls index={i} count={layout.categoryGroups.length} onMove={move("categoryGroups")} onRemove={remove("categoryGroups")} />
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
