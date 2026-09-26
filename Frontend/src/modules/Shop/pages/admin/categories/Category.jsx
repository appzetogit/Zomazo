import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import {
  BadgeCheck,
  Download,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { adminAPI, attributeAdminAPI, uploadAPI } from "@store/api"
import { API_BASE_URL } from "@store/api/config"
import { toast } from "sonner"
import { canCurrentAdminAction } from "@store/utils/adminRbac"

const defaultFormData = {
  name: "",
  image: "",
  status: true,
  type: "",
  zoneId: "global",
  commissionPercent: "",
  parentId: "",
  attributeSetId: "",
  requiresFssai: false,
}

const refId = (value) => String(value?._id || value?.id || value || "").trim()

const commissionText = (value) =>
  value === null || value === undefined || value === "" ? "Inherit" : `${Number(value)}%`

const approvalBadgeClass = (status) => {
  const value = String(status || "pending").toLowerCase()
  if (value === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200"
  if (value === "rejected") return "bg-rose-50 text-rose-700 border-rose-200"
  return "bg-amber-50 text-amber-700 border-amber-200"
}

const zoneLabel = (zone) => {
  if (!zone) return "Global"
  if (typeof zone === "string") {
    const value = zone.trim()
    if (/^[a-f0-9]{24}$/i.test(value)) return `Zone ID ${value.slice(-6)}`
    return value
  }
  return zone?.name || zone?.zoneName || zone?.serviceLocation || "Zone"
}

const resolveCategoryId = (category) => String(category?._id || category?.id || "").trim()

export default function Category() {
  const [searchQuery, setSearchQuery] = useState("")
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [formData, setFormData] = useState(defaultFormData)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef(null)
  // Every category (unfiltered) for the parent picker and parent names in the list.
  const [allCategories, setAllCategories] = useState([])
  const [attributeSets, setAttributeSets] = useState([])
  const ensureActionAccess = (action) => {
    if (canCurrentAdminAction(action)) return true
    toast.error("Insufficient permissions for this action")
    return false
  }

  useEffect(() => {
    const adminToken = localStorage.getItem("admin_accessToken")
    if (!adminToken) {
      toast.error("Please login to access categories")
      setLoading(false)
      return
    }
    fetchCategories()
  }, [])

  useEffect(() => {
    let cancelled = false
    setZonesLoading(true)
    adminAPI
      .getZones({ limit: 1000 })
      .then((res) => {
        const list =
          res?.data?.data?.zones ||
          res?.data?.data?.data?.zones ||
          res?.data?.data ||
          []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const fetchAllCategories = () =>
    adminAPI
      .getCategories({ limit: 1000 })
      .then((res) => {
        const list = res?.data?.data?.categories || res?.data?.categories || []
        setAllCategories(Array.isArray(list) ? list : [])
      })
      .catch(() => setAllCategories([]))

  useEffect(() => {
    fetchAllCategories()
    attributeAdminAPI
      .listSets()
      .then((res) => {
        const body = res?.data?.data
        const list = Array.isArray(body) ? body : body?.attributeSets || body?.sets || []
        setAttributeSets(Array.isArray(list) ? list : [])
      })
      .catch(() => setAttributeSets([]))
  }, [])

  const categoryNameById = useMemo(
    () => new Map(allCategories.map((c) => [resolveCategoryId(c), c?.name || ""])),
    [allCategories]
  )
  const attributeSetNameById = useMemo(
    () => new Map(attributeSets.map((set) => [refId(set), set?.name || ""])),
    [attributeSets]
  )

  // Two levels only: a parent must be top level, and a category that already
  // has subcategories cannot get a parent itself.
  const editingId = resolveCategoryId(editingCategory)
  const parentOptions = useMemo(
    () => allCategories.filter((c) => !c?.parentId && resolveCategoryId(c) !== editingId),
    [allCategories, editingId]
  )
  const editingHasChildren = Boolean(
    editingId && allCategories.some((c) => refId(c?.parentId) === editingId)
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchCategories()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery, showPendingOnly])

  const filteredCategories = useMemo(() => {
    const query = String(searchQuery || "").trim().toLowerCase()
    if (!query) return categories
    return categories.filter((category) => {
      const creator = category?.createdBySeller?.name || category?.seller?.name || ""
      return (
        String(category?.name || "").toLowerCase().includes(query) ||
        String(creator || "").toLowerCase().includes(query) ||
        String(category?.id || "").toLowerCase().includes(query)
      )
    })
  }, [categories, searchQuery])

  const fetchCategories = async () => {
    try {
      setLoading(true)
      const params = {}
      if (searchQuery) params.search = searchQuery
      if (showPendingOnly) params.approvalStatus = "pending"

      const response = await adminAPI.getCategories(params)
      const list = response?.data?.data?.categories || response?.data?.categories || []
      setCategories(Array.isArray(list) ? list : [])
    } catch (error) {
      if (error?.response?.status === 401) {
        toast.error("Authentication required. Please login again.")
      } else if (error?.response?.status === 403) {
        toast.error("Access denied. You do not have permission.")
      } else if (error?.response?.status === 404) {
        toast.error("Categories endpoint not found. Please check backend server.")
      } else if (error?.code === "ERR_NETWORK" || error?.message === "Network Error") {
        toast.error("Cannot connect to server. Please check if backend is running on " + API_BASE_URL.replace("/api", ""))
      } else {
        toast.error(error?.response?.data?.message || "Failed to load categories")
      }
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  const resetModal = () => {
    setIsModalOpen(false)
    setEditingCategory(null)
    setFormData(defaultFormData)
    setSelectedImageFile(null)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleAddNew = () => {
    if (!ensureActionAccess("create")) return
    setEditingCategory(null)
    setFormData(defaultFormData)
    setSelectedImageFile(null)
    setImagePreview(null)
    setIsModalOpen(true)
  }

  const handleEdit = (category) => {
    if (!ensureActionAccess("edit")) return
    setEditingCategory(category)
    const zoneIdValue =
      typeof category?.zoneId === "string"
        ? category.zoneId
        : category?.zoneId?._id || category?.zoneId?.id || "global"

    setFormData({
      name: category?.name || "",
      image: category?.image || "",
      status: category?.status !== false,
      type: category?.type || "",
      zoneId: zoneIdValue || "global",
      commissionPercent:
        category?.commissionPercent === null || category?.commissionPercent === undefined
          ? ""
          : String(category.commissionPercent),
      parentId: refId(category?.parentId),
      attributeSetId: refId(category?.attributeSetId),
      requiresFssai: category?.requiresFssai === true,
    })
    setSelectedImageFile(null)
    setImagePreview(category?.image || null)
    setIsModalOpen(true)
  }

  const handleImageSelect = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, or WEBP.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5MB limit.")
      return
    }

    setSelectedImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleToggleStatus = async (id) => {
    if (!ensureActionAccess("edit")) return
    try {
      const response = await adminAPI.toggleCategoryStatus(String(id))
      if (response?.data?.success) {
        toast.success("Category status updated successfully")
        fetchCategories()
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update category status")
    }
  }

  const handleApprove = async (id) => {
    if (!ensureActionAccess("edit")) return
    try {
      const response = await adminAPI.approveCategory(String(id))
      if (response?.data?.success) {
        toast.success("Category approved successfully")
        fetchCategories()
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to approve category")
    }
  }

  const handleReject = async (category) => {
    if (!ensureActionAccess("edit")) return
    const reason = window.prompt(`Reject "${category?.name}" with a reason:`)
    if (reason == null) return
    if (!String(reason).trim()) {
      toast.error("Rejection reason is required")
      return
    }

    try {
      const response = await adminAPI.rejectCategory(String(category?.id || category?._id), reason)
      if (response?.data?.success) {
        toast.success("Category rejected successfully")
        fetchCategories()
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to reject category")
    }
  }

  const handleMakeGlobal = async (category) => {
    if (!ensureActionAccess("edit")) return
    if (!window.confirm(`Make "${category?.name}" global for every seller?`)) return

    try {
      const response = await adminAPI.makeCategoryGlobal(String(category?.id || category?._id))
      if (response?.data?.success) {
        toast.success("Category is now global")
        fetchCategories()
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to make category global")
    }
  }

  const handleDelete = async (id) => {
    if (!ensureActionAccess("delete")) return
    const categoryName =
      categories.find((category) => resolveCategoryId(category) === String(id))?.name || "this category"
    if (!window.confirm(`Delete "${categoryName}"? This action cannot be undone.`)) return

    try {
      const response = await adminAPI.deleteCategory(String(id))
      if (response?.data?.success) {
        toast.success("Category deleted successfully")
        fetchCategories()
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          "Failed to delete category"
      )
    }
  }

  const handleExportPDF = async () => {
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ])
      const doc = new jsPDF()
      doc.setFontSize(18)
      doc.setTextColor(30, 30, 30)
      doc.text("Category List", 14, 20)
      doc.setFontSize(10)
      doc.setTextColor(100, 100, 100)
      doc.text(`Generated on: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 14, 28)

      const tableData = filteredCategories.map((category, index) => [
        index + 1,
        category?.name || "N/A",
        category?.isGlobal ? "Global" : "Private",
        zoneLabel(category?.zoneId),
        category?.approvalStatus || "pending",
      ])

      autoTable(doc, {
        startY: 35,
        head: [["SL", "Category", "Visibility", "Zone", "Approval"]],
        body: tableData,
        theme: "striped",
        headStyles: {
          fillColor: [59, 130, 246],
          textColor: 255,
          fontStyle: "bold",
          fontSize: 10,
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [30, 30, 30],
        },
      })

      doc.save(`Categories_${new Date().toISOString().split("T")[0]}.pdf`)
      toast.success("PDF exported successfully!")
    } catch {
      toast.error("Failed to export PDF")
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!ensureActionAccess(editingCategory ? "edit" : "create")) return

    try {
      setUploadingImage(true)
      let imageUrl = String(formData.image || "").trim()

      if (selectedImageFile) {
        const uploadRes = await uploadAPI.uploadMedia(selectedImageFile, { folder: "categories" })
        const payload = uploadRes?.data?.data || uploadRes?.data
        imageUrl = payload?.url || imageUrl
      }

      const commissionValue = String(formData.commissionPercent ?? "").trim()
      if (commissionValue !== "") {
        const n = Number(commissionValue)
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          toast.error("Commission must be between 0 and 100")
          return
        }
      }

      const payload = {
        name: String(formData.name || "").trim(),
        type: String(formData.type || "").trim(),
        status: Boolean(formData.status),
        image: imageUrl || undefined,
        zoneId: formData.zoneId || "global",
        // Empty clears it: the category then inherits from its parent (or has none).
        commissionPercent: commissionValue === "" ? null : Number(commissionValue),
        // Empty = top level.
        parentId: formData.parentId || "",
        // Empty = inherit from the parent (or none).
        attributeSetId: formData.attributeSetId || null,
        requiresFssai: Boolean(formData.requiresFssai),
      }

      if (editingCategory) {
        const response = await adminAPI.updateCategory(editingCategory.id, payload)
        if (response?.data?.success) toast.success("Category updated successfully")
      } else {
        const response = await adminAPI.createCategory(payload)
        if (response?.data?.success) toast.success("Category created successfully")
      }

      resetModal()
      fetchCategories()
      fetchAllCategories()
    } catch (error) {
      if (error?.code === "ERR_NETWORK" || error?.message === "Network Error") {
        toast.error("Cannot connect to server. Please check if backend is running on " + API_BASE_URL.replace("/api", ""))
      } else {
        toast.error(error?.response?.data?.message || "Failed to save category")
      }
    } finally {
      setUploadingImage(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 lg:p-6">
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Categories</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Seller-created categories now move through approval, rejection, and optional globalization before every
              seller can use them.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 p-1">
              <button
                type="button"
                onClick={() => setShowPendingOnly(false)}
                className={`rounded-full px-3 py-2 text-xs font-semibold ${!showPendingOnly ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setShowPendingOnly(true)}
                className={`rounded-full px-3 py-2 text-xs font-semibold ${showPendingOnly ? "bg-amber-600 text-white" : "text-slate-600"}`}
              >
                Pending
              </button>
            </div>

            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search categories"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-slate-900"
              />
            </div>

            <button
              onClick={handleExportPDF}
              disabled={filteredCategories.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export
            </button>

            <button
              onClick={handleAddNew}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Add Category
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-[25%] px-5 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Category</th>
                <th className="w-[17%] px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Owner</th>
                <th className="w-[12%] px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Zone</th>
                <th className="w-[8%] px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Commission</th>
                <th className="w-[10%] px-4 py-4 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="w-[13%] px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Approval</th>
                <th className="w-[20%] px-5 py-4 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
                    <p className="mt-2 text-sm text-slate-500">Loading categories...</p>
                  </td>
                </tr>
              ) : filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <p className="text-lg font-semibold text-slate-700">No categories found</p>
                    <p className="mt-1 text-sm text-slate-500">Try a different search or create a new category.</p>
                  </td>
                </tr>
              ) : (
                filteredCategories.map((category) => {
                  const categoryId = resolveCategoryId(category)
                  const creatorName = category?.createdBySeller?.name || category?.seller?.name || "Admin"
                  const approvalStatus = category?.approvalStatus || "pending"
                  const isSellerCategory = Boolean(category?.createdBySellerId || category?.sellerId)
                  const zoneText = zoneLabel(category?.zoneId)

                  return (
                    <tr key={categoryId || `category-${category?.name || "item"}`} className="align-top hover:bg-slate-50/80">
                      <td className="px-5 py-5">
                        <div className="flex items-start gap-3">
                          <div className="h-11 w-11 overflow-hidden rounded-2xl bg-slate-100">
                            {category?.image ? (
                              <img src={category.image} alt={category.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-500">
                                {String(category?.name || "C").slice(0, 1).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-lg font-semibold leading-6 text-slate-900">{category?.name || "-"}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>{category?.type || "No type"}</span>
                              <span className="text-slate-300">•</span>
                              <span>Items linked: {category?.itemCount || 0}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span>
                                {category?.parentId
                                  ? `Under: ${categoryNameById.get(refId(category.parentId)) || "Unknown parent"}`
                                  : "Top level"}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span>
                                Attributes:{" "}
                                {category?.attributeSetId
                                  ? attributeSetNameById.get(refId(category.attributeSetId)) || "Unknown set"
                                  : category?.parentId
                                    ? "Inherit"
                                    : "None"}
                              </span>
                              {category?.requiresFssai && (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                  FSSAI
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-5 text-sm text-slate-600">
                        <div className="space-y-1">
                          <p className="font-medium leading-6 text-slate-800">{creatorName}</p>
                          <p className="text-xs text-slate-400">
                            {category?.isGlobal ? "Global category" : "Private to creator"}
                          </p>
                          {category?.isGlobal && isSellerCategory && (
                            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">
                              <Globe className="mr-1 h-3.5 w-3.5" />
                              Shared
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="max-w-[180px]">
                          <p className="truncate text-sm font-medium text-slate-700" title={zoneText}>
                            {zoneText}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-5 text-sm font-medium text-slate-700">
                        <span className={category?.commissionPercent == null ? "text-slate-400" : ""}>
                          {commissionText(category?.commissionPercent)}
                        </span>
                      </td>
                      <td className="px-4 py-5 text-center">
                        <button
                          onClick={() => handleToggleStatus(categoryId)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full ${category?.status ? "bg-blue-600" : "bg-slate-300"}`}
                          title={category?.status ? "Deactivate" : "Activate"}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${category?.status ? "translate-x-6" : "translate-x-1"}`} />
                        </button>
                      </td>
                      <td className="px-4 py-5">
                        <div className="space-y-2">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${approvalBadgeClass(approvalStatus)}`}>
                            {approvalStatus === "approved" && <BadgeCheck className="mr-1 h-3.5 w-3.5" />}
                            {approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}
                          </span>
                          {category?.rejectionReason && (
                            <p className="max-w-[180px] text-xs leading-5 text-rose-600">{category.rejectionReason}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-5">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {approvalStatus !== "approved" && (
                              <button
                                onClick={() => handleApprove(categoryId)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                              >
                                Approve
                              </button>
                            )}
                            {isSellerCategory && approvalStatus !== "rejected" && (
                              <button
                                onClick={() => handleReject(category)}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                              >
                                Reject
                              </button>
                            )}
                            {isSellerCategory && !category?.isGlobal && approvalStatus === "approved" && (
                              <button
                                onClick={() => handleMakeGlobal(category)}
                                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                              >
                                Make Global
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleEdit(category)}
                              className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(categoryId)}
                              className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isModalOpen && (
              <div className="fixed inset-0 z-[200]">
                <div className="absolute inset-0 bg-black/50" onClick={resetModal} />
                <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl max-h-[min(720px,calc(100vh-32px))]"
                  >
                    <div className="flex items-center justify-between border-b px-6 py-4">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">{editingCategory ? "Edit Category" : "Add Category"}</h2>
                        <p className="text-xs text-slate-500">
                          Admin categories are approved immediately. Seller-created categories can also be updated here.
                        </p>
                      </div>
                      <button onClick={resetModal} className="rounded-lg p-1 hover:bg-slate-100">
                        <X className="h-5 w-5 text-slate-500" />
                      </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Zone</label>
                          <select
                            value={formData.zoneId}
                            onChange={(event) => setFormData((prev) => ({ ...prev, zoneId: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-900"
                          >
                            <option value="global">Global (all zones)</option>
                            {zonesLoading && <option value="" disabled>Loading zones...</option>}
                            {zones.map((zone) => {
                              const id = String(zone?._id || zone?.id || "")
                              const label = zone?.name || zone?.zoneName || zone?.serviceLocation || id
                              return (
                                <option key={id} value={id}>
                                  {label}
                                </option>
                              )
                            })}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Category Type</label>
                          <input
                            type="text"
                            value={formData.type}
                            onChange={(event) => setFormData((prev) => ({ ...prev, type: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
                            placeholder="Examples: Starters, Desserts, Drinks"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Category Name</label>
                          <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
                            placeholder="Enter category name"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Parent category</label>
                          <select
                            value={formData.parentId}
                            disabled={editingHasChildren}
                            onChange={(event) => setFormData((prev) => ({ ...prev, parentId: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-900 disabled:bg-slate-50"
                          >
                            <option value="">None (top level)</option>
                            {parentOptions.map((c) => (
                              <option key={resolveCategoryId(c)} value={resolveCategoryId(c)}>
                                {c?.name || resolveCategoryId(c)}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-slate-500">
                            {editingHasChildren
                              ? "This category has subcategories, so it stays top level."
                              : "Categories go two levels deep: only top-level categories can be parents."}
                          </p>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Attribute set</label>
                          <select
                            value={formData.attributeSetId}
                            onChange={(event) => setFormData((prev) => ({ ...prev, attributeSetId: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-slate-900"
                          >
                            <option value="">{formData.parentId ? "Inherit from parent" : "None"}</option>
                            {attributeSets.map((set) => (
                              <option key={refId(set)} value={refId(set)}>
                                {set?.name || refId(set)}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-slate-500">
                            The attributes (size, colour and so on) that products in this category vary by.
                          </p>
                        </div>

                        <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={formData.requiresFssai}
                            onChange={(event) => setFormData((prev) => ({ ...prev, requiresFssai: event.target.checked }))}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Requires FSSAI licence
                        </label>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Commission %</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={formData.commissionPercent}
                            onChange={(event) => setFormData((prev) => ({ ...prev, commissionPercent: event.target.value }))}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-slate-900"
                            placeholder="Leave empty to inherit from parent (or none)"
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            Platform commission on items in this category. Used when the seller has no commission rule of its own.
                          </p>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Category Image</label>
                          <div className="space-y-3">
                            {(imagePreview || formData.image) && (
                              <div className="relative h-32 w-32 overflow-hidden rounded-2xl border border-slate-300">
                                <img
                                  src={imagePreview || formData.image}
                                  alt="Category preview"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                onChange={handleImageSelect}
                                className="hidden"
                                id="category-image-upload"
                              />
                              <label
                                htmlFor="category-image-upload"
                                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700"
                              >
                                <Upload className="h-4 w-4" />
                                {imagePreview ? "Change Image" : "Upload Image"}
                              </label>
                              {uploadingImage && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                            </div>
                          </div>
                        </div>

                        <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={formData.status}
                            onChange={(event) => setFormData((prev) => ({ ...prev, status: event.target.checked }))}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Active Status
                        </label>
                      </div>

                      <div className="flex items-center gap-3 border-t bg-white px-6 py-4">
                        <button
                          type="button"
                          onClick={resetModal}
                          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-slate-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-white"
                        >
                          {editingCategory ? "Update" : "Create"}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
