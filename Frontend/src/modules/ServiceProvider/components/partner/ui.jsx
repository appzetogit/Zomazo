import { NavLink, useNavigate } from "react-router-dom"
import { ArrowLeft, Inbox, Loader2 } from "lucide-react"

/*
 * The small kit both service-partner apps (vendor at /services/vendor, worker at
 * /services/worker) are built from. They are two apps for two people, but the same
 * phone-sized screens, so the pieces live here once instead of drifting apart.
 */

export const inr = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return "₹0"
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

export const fmtDate = (value) => {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export const fmtDateTime = (value) => {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

// The SP backend answers errors as { message } and validation failures as
// { errors: [{ msg }] }; show whichever says the most.
export const errorMessage = (error, fallback = "Something went wrong") => {
  const data = error?.response?.data
  if (data?.errors?.length) return data.errors.map((e) => e.msg).filter(Boolean).join(", ") || data.message || fallback
  return data?.message || data?.error || error?.message || fallback
}

export const addressLine = (address) => {
  if (!address) return ""
  if (typeof address === "string") return address
  return [address.addressLine1, address.addressLine2, address.landmark, address.city, address.pincode]
    .filter(Boolean)
    .join(", ") || address.fullAddress || ""
}

/*
 * Booking statuses as the backend writes them (utils/constants.js BOOKING_STATUS),
 * plus the few legacy spellings the vendor list query still accepts.
 */
const STATUS = {
  searching: ["Finding partner", "bg-amber-100 text-amber-800"],
  requested: ["New request", "bg-amber-100 text-amber-800"],
  awaiting_payment: ["Awaiting payment", "bg-amber-100 text-amber-800"],
  pending: ["Pending", "bg-amber-100 text-amber-800"],
  confirmed: ["Confirmed", "bg-sky-100 text-sky-800"],
  accepted: ["Accepted", "bg-sky-100 text-sky-800"],
  assigned: ["Assigned", "bg-indigo-100 text-indigo-800"],
  journey_started: ["On the way", "bg-violet-100 text-violet-800"],
  visited: ["Reached", "bg-violet-100 text-violet-800"],
  in_progress: ["In progress", "bg-violet-100 text-violet-800"],
  work_done: ["Work done", "bg-teal-100 text-teal-800"],
  completed: ["Completed", "bg-emerald-100 text-emerald-800"],
  cancelled: ["Cancelled", "bg-rose-100 text-rose-800"],
  rejected: ["Rejected", "bg-rose-100 text-rose-800"],
  no_vendors: ["Expired", "bg-slate-200 text-slate-700"],
}

export const statusLabel = (status) => STATUS[status]?.[0] || String(status || "-").replace(/_/g, " ")

export function StatusBadge({ status, className = "" }) {
  const tone = STATUS[status]?.[1] || "bg-slate-100 text-slate-700"
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone} ${className}`}>
      {statusLabel(status)}
    </span>
  )
}

export function Spinner({ label = "Loading" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function Empty({ title, hint, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-slate-400" />
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  )
}

export function Card({ children, className = "", ...rest }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  )
}

const VARIANTS = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-200",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-200",
  danger: "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-200",
  ghost: "text-emerald-700 hover:bg-emerald-50 focus-visible:ring-emerald-100",
}

export function Button({ variant = "primary", loading = false, disabled, className = "", children, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"

export function Stat({ label, value, tone = "text-slate-900" }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone}`}>{value}</p>
    </Card>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === t.value ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-600"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The app frame: a sticky title bar and, on the main screens, a bottom tab bar
 * sized for a thumb. Screens deeper than a tab pass `back` instead of `nav`.
 */
export function Shell({ title, subtitle, back, right, nav, children }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-4">
          {back && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}
              className="-ml-2 rounded-full p-2 text-slate-600 hover:bg-slate-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold">{title}</h1>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </div>
      </header>
      <main className={`mx-auto max-w-md space-y-4 px-4 py-4 ${nav ? "pb-24" : "pb-10"}`}>{children}</main>
      {nav && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white">
          <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map(({ to, label, icon: Icon, end, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? "text-emerald-700" : "text-slate-500"}`
                }
              >
                <Icon className="h-5 w-5" />
                {label}
                {badge > 0 && (
                  <span className="absolute right-1/4 top-1 min-w-[1.1rem] rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-4 text-white">
                    {badge}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

/**
 * Read a picked image as a data: URL, scaled down first.
 *
 * The SP registration and worker endpoints take documents inline as data: URLs and
 * upload them to Cloudinary server side, so the file travels inside the JSON body.
 * A phone photo is several MB; scaling to ~1400px keeps the body well under the
 * API's JSON limit while leaving an ID card readable.
 */
export const imageToDataUrl = (file, maxDim = 1400, quality = 0.75) =>
  new Promise((resolve, reject) => {
    if (!file) return resolve(null)
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read the file"))
    reader.onload = () => {
      const src = reader.result
      if (!String(file.type).startsWith("image/")) return resolve(src)
      const img = new Image()
      img.onerror = () => resolve(src)
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", quality))
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })

export function PhotoField({ label, value, onChange, required }) {
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (file) onChange(await imageToDataUrl(file))
  }
  return (
    <Field label={`${label}${required ? " *" : ""}`}>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt={label} className="h-16 w-24 rounded-lg border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
            No photo
          </div>
        )}
        <label className="cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {value ? "Change" : "Upload"}
          <input type="file" accept="image/*" className="hidden" onChange={pick} />
        </label>
      </div>
    </Field>
  )
}
