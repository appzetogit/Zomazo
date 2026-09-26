import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Plus, Trash2, Wand2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { catalogAPI } from "@store/api"

/**
 * Variant matrix editor shared by the admin and seller product forms.
 *
 * Options come from the category's attribute set (its own, else its parent's).
 * Without a set the user can type options freely. "Generate" builds every
 * combination of the picked values; rows that already exist keep their data.
 *
 * Role-agnostic: the caller passes how to upload an image (`uploadImage`) and
 * which channels its seller may sell in (`approvedChannels`).
 *
 * Draft shape (strings for inputs, converted by toVariantPayload):
 * { id, name, attributes: [{ name, value }], sku, barcode, price, otherPrice, mrp,
 *   stock: { quick, shop }, lowStockThreshold: { quick, shop },
 *   channels: { quick: "inherit"|"on"|"off", shop: ... }, isActive, images: [url] }
 *
 * Payload (CHANNELS_CONTRACT.md): channels { quick: Boolean|null, shop } (null = inherit
 * the product's), stock { quick: Number|null, shop } (null = draws on the product's
 * stock for that channel), lowStockThreshold { quick: Number|null, shop }.
 */

export const CHANNELS = ["quick", "shop"]
export const CHANNEL_LABEL = { quick: "Quick", shop: "Shop" }
/** Most photos one variant can carry; the product endpoints refuse more. */
export const MAX_VARIANT_IMAGES = 10
const overrideToDraft = (v) => (v === true ? "on" : v === false ? "off" : "inherit")
const overrideToPayload = (v) => (v === "on" ? true : v === "off" ? false : null)

const newId = () => `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const str = (v) => (v === null || v === undefined ? "" : String(v))
/** { quick, shop } of input strings from a { quick, shop } object of numbers/nulls. */
export const perChannelDraft = (obj) => ({ quick: str(obj?.quick), shop: str(obj?.shop) })

export const createVariantDraft = (variant = {}) => ({
  id: String(variant?.id || variant?._id || newId()),
  name: str(variant?.name),
  attributes: Array.isArray(variant?.attributes)
    ? variant.attributes.map((a) => ({ name: str(a?.name), value: str(a?.value) })).filter((a) => a.name && a.value)
    : [],
  sku: str(variant?.sku),
  barcode: str(variant?.barcode),
  price: variant?.price != null ? String(variant.price) : "",
  otherPrice: variant?.otherPrice ? String(variant.otherPrice) : "",
  mrp: str(variant?.mrp),
  stock: perChannelDraft(variant?.stock),
  lowStockThreshold: perChannelDraft(variant?.lowStockThreshold),
  channels: {
    quick: typeof variant?.channels?.quick === "string" ? variant.channels.quick : overrideToDraft(variant?.channels?.quick),
    shop: typeof variant?.channels?.shop === "string" ? variant.channels.shop : overrideToDraft(variant?.channels?.shop),
  },
  isActive: variant?.isActive !== false,
  images: Array.isArray(variant?.images) ? variant.images.filter(Boolean) : [],
})

const attributeKey = (attributes = []) =>
  attributes
    .map((a) => `${a.name.toLowerCase()}=${a.value.toLowerCase()}`)
    .sort()
    .join("|")

const optionalNumber = (v) => (str(v).trim() === "" ? null : Number(v))

/** Converts a { quick, shop } draft of strings; returns [error, { quick, shop }]. */
export const perChannelPayload = (draft, label, name) => {
  const out = {}
  for (const c of CHANNELS) {
    const n = optionalNumber(draft?.[c])
    if (n !== null && !(Number.isInteger(n) && n >= 0)) {
      return [`${CHANNEL_LABEL[c]} ${label}${name ? ` for ${name}` : ""} must be a whole number of 0 or more`, null]
    }
    out[c] = n
  }
  return [null, out]
}

/** Validates drafts and returns [error, payload] in the shape the product endpoints accept. */
export const toVariantPayload = (drafts = []) => {
  const rows = drafts.filter(
    (d) => d.attributes?.length || str(d.name).trim() || str(d.price).trim() || !String(d.id).startsWith("variant-"),
  )
  const seen = new Set()
  const out = []
  for (const d of rows) {
    const name = str(d.name).trim() || d.attributes.map((a) => a.value).join(" / ")
    if (!name) return ["Each variant needs a name or options", null]
    const price = Number(d.price)
    if (!Number.isFinite(price) || price <= 0) return [`Price for ${name} must be greater than 0`, null]
    const mrp = optionalNumber(d.mrp)
    if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) return [`MRP for ${name} is invalid`, null]
    if (mrp !== null && price > mrp) return [`Price of ${name} cannot be above its MRP`, null]
    const [stockErr, stock] = perChannelPayload(d.stock, "stock", name)
    if (stockErr) return [stockErr, null]
    const [lowErr, lowStockThreshold] = perChannelPayload(d.lowStockThreshold, "low-stock alert", name)
    if (lowErr) return [lowErr, null]
    const channels = { quick: overrideToPayload(d.channels?.quick), shop: overrideToPayload(d.channels?.shop) }
    if (d.attributes.length) {
      const key = attributeKey(d.attributes)
      if (seen.has(key)) return [`Two variants have the same options: ${name}`, null]
      seen.add(key)
    }
    const otherPrice = Number(d.otherPrice) || 0
    out.push({
      ...(!String(d.id).startsWith("variant-") ? { _id: d.id } : {}),
      name,
      price,
      otherPrice: otherPrice > 0 ? otherPrice : 0,
      attributes: d.attributes,
      sku: str(d.sku).trim(),
      barcode: str(d.barcode).trim(),
      mrp,
      channels,
      stock,
      lowStockThreshold,
      isActive: d.isActive !== false,
      images: [...new Set((d.images || []).map((u) => str(u).trim()).filter(Boolean))].slice(0, MAX_VARIANT_IMAGES),
    })
  }
  return [null, out]
}

const cartesian = (lists) =>
  lists.reduce((acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])), [[]])

const inputCls =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm md:text-xs outline-none focus:border-slate-900 bg-white disabled:bg-slate-100 disabled:text-slate-400"

/** Channel switch + stock + low-stock alert of one variant in one channel. */
function ChannelCell({ variant, channel, onChannel, labelled = false }) {
  const off = variant.channels?.[channel] === "off"
  return (
    <div className="space-y-1">
      {labelled && <p className="text-[11px] font-semibold text-slate-700">{CHANNEL_LABEL[channel]}</p>}
      <select
        className={inputCls}
        value={variant.channels?.[channel] || "inherit"}
        title={`Sell this variant in ${CHANNEL_LABEL[channel]}`}
        aria-label={`Sell ${variant.name || "this variant"} in ${CHANNEL_LABEL[channel]}`}
        onChange={(e) => onChannel("channels", channel, e.target.value)}
      >
        <option value="inherit">Inherit product</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
      <div className="grid grid-cols-2 gap-1">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          className={inputCls}
          placeholder={labelled ? "Stock (shared)" : "Shared"}
          title={`${CHANNEL_LABEL[channel]} stock. Empty: draws on the product stock for this channel`}
          aria-label={`${CHANNEL_LABEL[channel]} stock`}
          disabled={off}
          value={variant.stock?.[channel] ?? ""}
          onChange={(e) => onChannel("stock", channel, e.target.value)}
        />
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          className={inputCls}
          placeholder={labelled ? "Low alert" : "Low"}
          title={`${CHANNEL_LABEL[channel]} low-stock alert`}
          aria-label={`${CHANNEL_LABEL[channel]} low-stock alert`}
          disabled={off}
          value={variant.lowStockThreshold?.[channel] ?? ""}
          onChange={(e) => onChannel("lowStockThreshold", channel, e.target.value)}
        />
      </div>
    </div>
  )
}

/** Thumbnails of one variant's photos with remove buttons and an upload tile. */
function ImagesCell({ variant, onRemove, onUpload, uploading, busy, canUpload, maxImages, large = false }) {
  const box = large ? "h-14 w-14" : "h-8 w-8"
  const count = (variant.images || []).length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(variant.images || []).map((url) => (
        <span key={url} className="relative">
          <img src={url} alt="" className={`${box} rounded border object-cover`} />
          <button
            type="button"
            onClick={() => onRemove(url)}
            className={`absolute -right-1.5 -top-1.5 rounded-full bg-white text-rose-600 shadow ${large ? "p-0.5" : ""}`}
            aria-label="Remove image"
          >
            <X className={large ? "h-4 w-4" : "h-3 w-3"} />
          </button>
        </span>
      ))}
      {canUpload && count < maxImages && (
        <label
          className={`inline-flex ${box} cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 ${busy ? "cursor-not-allowed opacity-60" : ""}`}
          title="Add photos of this variant"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className={large ? "h-5 w-5" : "h-3.5 w-3.5"} />}
          <span className="sr-only">Add photos of this variant</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              onUpload(e.target.files)
              e.target.value = ""
            }}
          />
        </label>
      )}
      {large && <span className="text-[11px] text-slate-500">{count}/{maxImages}</span>}
    </div>
  )
}

/**
 * Props:
 * - `productChannels`: the product's channel toggles { quick, shop }.
 * - `approvedChannels`: channels the product's seller may sell in (default both).
 *   Only channels that are on for the product AND approved get stock / override fields.
 * - `uploadImage(file) => Promise<url>`: how this panel uploads a photo. Without it,
 *   existing variant photos are shown and can be removed, but not added.
 * - `showOtherPrice`: adds the optional "other platform price" per variant.
 */
export default function VariantMatrixEditor({
  categoryId,
  variants = [],
  onChange,
  productChannels = { quick: true, shop: true },
  approvedChannels = CHANNELS,
  uploadImage,
  showOtherPrice = false,
  maxImages = MAX_VARIANT_IMAGES,
}) {
  const activeChannels = CHANNELS.filter((c) => productChannels?.[c] && approvedChannels.includes(c))
  const [attrLoading, setAttrLoading] = useState(false)
  const [attributeSet, setAttributeSet] = useState(null)
  const [setAttributes, setSetAttributes] = useState([])
  // { [attributeName]: Set of picked values } for set-based options.
  const [picked, setPicked] = useState({})
  // Free-form options when the category has no attribute set: [{ name, values: "S, M, L" }].
  const [freeOptions, setFreeOptions] = useState([{ name: "", values: "" }])
  const [defaults, setDefaults] = useState({ price: "", mrp: "", stock_quick: "", stock_shop: "", low_quick: "", low_shop: "" })
  const [uploadingId, setUploadingId] = useState(null)
  // Uploads finish after the user may have edited other rows; always merge into the latest list.
  const variantsRef = useRef(variants)
  variantsRef.current = variants

  useEffect(() => {
    let cancelled = false
    setAttributeSet(null)
    setSetAttributes([])
    if (!categoryId) return undefined
    setAttrLoading(true)
    catalogAPI
      .getCategoryAttributes(categoryId)
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data || {}
        setAttributeSet(data.attributeSet || null)
        setSetAttributes(Array.isArray(data.attributes) ? data.attributes : [])
      })
      .catch(() => {
        if (!cancelled) setSetAttributes([])
      })
      .finally(() => {
        if (!cancelled) setAttrLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [categoryId])

  // Pre-select the values the existing variants already use (also when the
  // variants arrive after the category's options, as on a loaded edit form).
  const hasVariants = variants.length > 0
  useEffect(() => {
    const next = {}
    for (const v of variants) {
      for (const a of v.attributes || []) {
        next[a.name] = next[a.name] || new Set()
        next[a.name].add(a.value)
      }
    }
    setPicked((prev) => (Object.keys(prev).length ? prev : next))
    if (!setAttributes.length && Object.keys(next).length) {
      setFreeOptions((prev) =>
        prev.some((o) => o.name.trim())
          ? prev
          : Object.entries(next).map(([name, values]) => ({ name, values: [...values].join(", ") })),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAttributes, hasVariants])

  const optionLists = useMemo(() => {
    if (setAttributes.length) {
      return setAttributes
        .map((a) => ({
          name: a.name,
          values: (a.values || []).map((v) => v.value).filter((v) => picked[a.name]?.has(v)),
        }))
        .filter((o) => o.values.length)
    }
    return freeOptions
      .map((o) => ({
        name: o.name.trim(),
        values: [...new Set(o.values.split(",").map((v) => v.trim()).filter(Boolean))],
      }))
      .filter((o) => o.name && o.values.length)
  }, [setAttributes, picked, freeOptions])

  const combinationCount = optionLists.length ? optionLists.reduce((n, o) => n * o.values.length, 1) : 0

  const togglePick = (name, value) => {
    setPicked((prev) => {
      const set = new Set(prev[name] || [])
      if (set.has(value)) set.delete(value)
      else set.add(value)
      return { ...prev, [name]: set }
    })
  }

  const generate = () => {
    if (!optionLists.length) {
      toast.error("Pick at least one value for an option first")
      return
    }
    if (combinationCount > 200) {
      toast.error("That is more than 200 combinations. Pick fewer values.")
      return
    }
    const existing = new Map(variants.filter((v) => v.attributes?.length).map((v) => [attributeKey(v.attributes), v]))
    const combos = cartesian(optionLists.map((o) => o.values.map((value) => ({ name: o.name, value }))))
    const next = combos.map((attributes) => {
      const found = existing.get(attributeKey(attributes))
      if (found) return { ...found, attributes }
      return createVariantDraft({
        attributes,
        price: defaults.price || undefined,
        mrp: defaults.mrp,
        stock: { quick: defaults.stock_quick, shop: defaults.stock_shop },
        lowStockThreshold: { quick: defaults.low_quick, shop: defaults.low_shop },
      })
    })
    const manual = variants.filter((v) => !v.attributes?.length)
    const dropped = variants.length - manual.length - next.filter((v) => existing.has(attributeKey(v.attributes))).length
    onChange([...next, ...manual])
    toast.success(
      `${combos.length} combination${combos.length === 1 ? "" : "s"} ready${dropped > 0 ? `, ${dropped} old one${dropped === 1 ? "" : "s"} removed` : ""}`,
    )
  }

  const update = (id, field, value) => onChange(variants.map((v) => (v.id === id ? { ...v, [field]: value } : v)))
  /** Sets one channel's value inside a { quick, shop } field. */
  const updateChannel = (id, field, channel, value) =>
    onChange(variants.map((v) => (v.id === id ? { ...v, [field]: { ...(v[field] || {}), [channel]: value } } : v)))
  const remove = (id) => onChange(variants.filter((v) => v.id !== id))
  const addManual = () => onChange([...variants, createVariantDraft()])
  const applyDefaultsToAll = () =>
    onChange(
      variants.map((v) => ({
        ...v,
        ...(defaults.price !== "" ? { price: defaults.price } : {}),
        ...(defaults.mrp !== "" ? { mrp: defaults.mrp } : {}),
        stock: {
          quick: defaults.stock_quick !== "" ? defaults.stock_quick : v.stock?.quick ?? "",
          shop: defaults.stock_shop !== "" ? defaults.stock_shop : v.stock?.shop ?? "",
        },
        lowStockThreshold: {
          quick: defaults.low_quick !== "" ? defaults.low_quick : v.lowStockThreshold?.quick ?? "",
          shop: defaults.low_shop !== "" ? defaults.low_shop : v.lowStockThreshold?.shop ?? "",
        },
      })),
    )

  const uploadImages = async (id, files) => {
    if (typeof uploadImage !== "function") return
    const current = variantsRef.current.find((v) => v.id === id)?.images || []
    const room = maxImages - current.length
    let list = Array.from(files || [])
    if (!list.length) return
    if (room <= 0) {
      toast.error(`A variant can have up to ${maxImages} photos`)
      return
    }
    if (list.length > room) {
      toast.error(`Only ${room} more photo${room === 1 ? "" : "s"} can be added to this variant`)
      list = list.slice(0, room)
    }
    setUploadingId(id)
    try {
      const urls = (await Promise.all(list.map((file) => uploadImage(file)))).filter(Boolean)
      if (!urls.length) throw new Error("Image upload failed")
      const latest = variantsRef.current
      onChange(
        latest.map((v) =>
          v.id === id ? { ...v, images: [...new Set([...(v.images || []), ...urls])].slice(0, maxImages) } : v,
        ),
      )
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Image upload failed")
    } finally {
      setUploadingId(null)
    }
  }

  const imagesCell = (v, large) => (
    <ImagesCell
      variant={v}
      large={large}
      maxImages={maxImages}
      canUpload={typeof uploadImage === "function"}
      uploading={uploadingId === v.id}
      busy={uploadingId !== null}
      onRemove={(url) => update(v.id, "images", (v.images || []).filter((u) => u !== url))}
      onUpload={(files) => uploadImages(v.id, files)}
    />
  )

  const attributeChips = (v) =>
    v.attributes?.length ? (
      <div className="mb-1 flex flex-wrap gap-1">
        {v.attributes.map((a) => (
          <span key={a.name} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
            {a.name}: {a.value}
          </span>
        ))}
      </div>
    ) : null

  const namePlaceholder = (v) => (v.attributes?.length ? v.attributes.map((a) => a.value).join(" / ") : "Name (e.g. 500 g)")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Variants</p>
          <p className="text-xs text-slate-500">
            {attrLoading
              ? "Loading category options..."
              : attributeSet
                ? `Options from attribute set "${attributeSet.name}".`
                : categoryId
                  ? "This category has no attribute set, so options are free text."
                  : "Pick a category to use its attribute set, or type options below."}
          </p>
        </div>
        <button
          type="button"
          onClick={addManual}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <Plus className="h-3.5 w-3.5" />
          Add single variant
        </button>
      </div>

      {/* Options */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
        {attrLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : setAttributes.length ? (
          setAttributes.map((attr) => (
            <div key={attr._id || attr.name}>
              <p className="mb-1 text-xs font-semibold text-slate-700">{attr.name}</p>
              <div className="flex flex-wrap gap-1.5">
                {(attr.values || []).map((v) => {
                  const on = picked[attr.name]?.has(v.value)
                  return (
                    <button
                      key={v.value}
                      type="button"
                      aria-pressed={!!on}
                      onClick={() => togglePick(attr.name, v.value)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                        on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {v.hex ? <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: v.hex }} /> : null}
                      {v.value}
                    </button>
                  )
                })}
                {!(attr.values || []).length && <span className="text-xs text-slate-400">No values listed</span>}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-2">
            {freeOptions.map((opt, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2 sm:grid-cols-[140px_1fr_auto]">
                <input
                  className={inputCls}
                  placeholder="Option (e.g. Size)"
                  aria-label="Option name"
                  value={opt.name}
                  onChange={(e) =>
                    setFreeOptions((prev) => prev.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)))
                  }
                />
                <input
                  className={inputCls}
                  placeholder="Values, comma separated (e.g. S, M, L)"
                  aria-label="Option values, comma separated"
                  value={opt.values}
                  onChange={(e) =>
                    setFreeOptions((prev) => prev.map((o, j) => (j === i ? { ...o, values: e.target.value } : o)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setFreeOptions((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ name: "", values: "" }]))}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label="Remove option"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setFreeOptions((prev) => [...prev, { name: "", values: "" }])}
              className="text-xs font-semibold text-blue-600"
            >
              + Add option
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["price", "Default price"],
            ["mrp", "Default MRP"],
            ...activeChannels.flatMap((c) => [
              [`stock_${c}`, `Default ${CHANNEL_LABEL[c]} stock`],
              [`low_${c}`, `Default ${CHANNEL_LABEL[c]} low alert`],
            ]),
          ].map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">{label}</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                className={inputCls}
                value={defaults[key]}
                onChange={(e) => setDefaults((d) => ({ ...d, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={!combinationCount}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Generate {combinationCount ? `${combinationCount} combination${combinationCount === 1 ? "" : "s"}` : "combinations"}
          </button>
          {variants.length > 0 && (
            <button
              type="button"
              onClick={applyDefaultsToAll}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Apply defaults to all rows
            </button>
          )}
        </div>
      </div>

      {/* Matrix */}
      {variants.length ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          {/* Phones: one card per variant. */}
          <ul className="divide-y divide-slate-200 md:hidden">
            {variants.map((v) => (
              <li key={v.id} className={`space-y-2.5 p-3 ${v.isActive ? "" : "bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">{attributeChips(v)}</div>
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    className="-mr-1 -mt-1 rounded-md p-2 text-rose-600 hover:bg-rose-50"
                    aria-label="Remove variant"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Name</label>
                  <input
                    className={inputCls}
                    placeholder={namePlaceholder(v)}
                    value={v.name}
                    onChange={(e) => update(v.id, "name", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">Price *</label>
                    <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={v.price} onChange={(e) => update(v.id, "price", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">MRP</label>
                    <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={v.mrp} onChange={(e) => update(v.id, "mrp", e.target.value)} />
                  </div>
                  {showOtherPrice && (
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-600">Other platform price</label>
                      <input type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={v.otherPrice} onChange={(e) => update(v.id, "otherPrice", e.target.value)} />
                    </div>
                  )}
                  <div className={showOtherPrice ? "" : "col-span-2"}>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">SKU</label>
                    <input className={inputCls} value={v.sku} onChange={(e) => update(v.id, "sku", e.target.value)} />
                  </div>
                </div>
                {activeChannels.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                    {activeChannels.map((c) => (
                      <div key={c} className="rounded-md border border-slate-200 p-2">
                        <ChannelCell variant={v} channel={c} labelled onChannel={(field, ch, value) => updateChannel(v.id, field, ch, value)} />
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <p className="mb-1 text-[11px] font-medium text-slate-600">Photos of this variant</p>
                  {imagesCell(v, true)}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" className="h-4 w-4" checked={v.isActive} onChange={(e) => update(v.id, "isActive", e.target.checked)} />
                  Active (customers can buy it)
                </label>
              </li>
            ))}
          </ul>

          {/* Wider screens: one row per variant. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-2 py-2 text-left">Variant</th>
                  <th className="px-2 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-left">Price *</th>
                  <th className="px-2 py-2 text-left">MRP</th>
                  {showOtherPrice && <th className="px-2 py-2 text-left">Other price</th>}
                  {activeChannels.map((c) => (
                    <th key={c} className="px-2 py-2 text-left">{CHANNEL_LABEL[c]}: sell / stock / low</th>
                  ))}
                  <th className="px-2 py-2 text-center">Active</th>
                  <th className="px-2 py-2 text-left">Images</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map((v) => (
                  <tr key={v.id} className={v.isActive ? "" : "bg-slate-50 text-slate-400"}>
                    <td className="px-2 py-2 align-top min-w-[150px]">
                      {attributeChips(v)}
                      <input
                        className={inputCls}
                        placeholder={namePlaceholder(v)}
                        aria-label="Variant name"
                        value={v.name}
                        onChange={(e) => update(v.id, "name", e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-2 align-top w-28">
                      <input className={inputCls} aria-label="SKU" value={v.sku} onChange={(e) => update(v.id, "sku", e.target.value)} />
                    </td>
                    <td className="px-2 py-2 align-top w-24">
                      <input type="number" min="0" step="0.01" className={inputCls} aria-label="Price" value={v.price} onChange={(e) => update(v.id, "price", e.target.value)} />
                    </td>
                    <td className="px-2 py-2 align-top w-24">
                      <input type="number" min="0" step="0.01" className={inputCls} aria-label="MRP" value={v.mrp} onChange={(e) => update(v.id, "mrp", e.target.value)} />
                    </td>
                    {showOtherPrice && (
                      <td className="px-2 py-2 align-top w-24">
                        <input type="number" min="0" step="0.01" className={inputCls} aria-label="Other platform price" value={v.otherPrice} onChange={(e) => update(v.id, "otherPrice", e.target.value)} />
                      </td>
                    )}
                    {activeChannels.map((c) => (
                      <td key={c} className="px-2 py-2 align-top w-40">
                        <ChannelCell variant={v} channel={c} onChannel={(field, ch, value) => updateChannel(v.id, field, ch, value)} />
                      </td>
                    ))}
                    <td className="px-2 py-2 align-top text-center">
                      <input type="checkbox" aria-label="Active" checked={v.isActive} onChange={(e) => update(v.id, "isActive", e.target.checked)} />
                    </td>
                    <td className="px-2 py-2 align-top min-w-[140px]">{imagesCell(v, false)}</td>
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => remove(v.id)}
                        className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                        aria-label="Remove variant"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            Each channel has its own stock. Empty stock means the variant draws on the product&apos;s stock for that channel. Empty MRP falls back to the product&apos;s MRP. Variant photos show first when a customer picks that variant.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No variants added. This product will use the single base price.</p>
      )}
    </div>
  )
}
