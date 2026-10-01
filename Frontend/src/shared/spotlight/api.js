import apiClient from "@/services/api/axios.js"

/*
 * Partner ads and the newsletter list, both platform-wide (Backend core/spotlight,
 * core/mailingList). The paths avoid "ad" and "banner": ad blockers abort
 * requests that contain them, and the screen then shows nothing.
 */
const admin = { contextModule: "admin" }

export const spotlightAdminAPI = {
  list: (params) => apiClient.get("/platform/spotlight", { params, ...admin }),
  review: (id, body) => apiClient.patch(`/platform/spotlight/${encodeURIComponent(id)}/review`, body, admin),
  update: (id, body) => apiClient.patch(`/platform/spotlight/${encodeURIComponent(id)}`, body, admin),
}

export const mailListAdminAPI = {
  list: (params) => apiClient.get("/platform/mailing-list", { params, ...admin }),
  exportCsv: (params) => apiClient.get("/platform/mailing-list/export.csv", { params, responseType: "blob", ...admin }),
}

/** Public: the newsletter form on any customer page. */
export const subscribeToNewsletter = (email, source) =>
  apiClient.post("/platform/mailing-list/subscribe", { email, source }, { contextModule: "user" })

export const listOf = (res) => res?.data?.data?.items || []
export const errorOf = (err, fallback) => err?.response?.data?.message || fallback

export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-")
export const dateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "")

export const STATE_STYLE = {
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
  running: "bg-green-100 text-green-700",
  scheduled: "bg-blue-100 text-blue-700",
  expired: "bg-slate-200 text-slate-600",
  paused: "bg-orange-100 text-orange-700",
}

export const KIND_LABEL = { banner: "Banner", listing: "Promoted listing" }
