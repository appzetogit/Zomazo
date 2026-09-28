import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

// FSSAI licence and registration numbers are 14 digits.
const FSSAI_NUMBER = /^\d{14}$/

const toDateInput = (value) => {
  if (!value) return ""
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

export default function FssaiUpdate() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [number, setNumber] = useState("")
  const [expiry, setExpiry] = useState("")
  const [existingDocument, setExistingDocument] = useState("")
  const [uploadedFile, setUploadedFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant || {}
        if (cancelled) return
        setNumber(String(data.fssaiNumber || "").trim())
        setExpiry(toDateInput(data.fssaiExpiry))
        const doc = data.fssaiImage
        setExistingDocument(String(typeof doc === "string" ? doc : doc?.url || "").trim())
      } catch {
        // Empty form is still usable; the save reports any real problem.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleFileSelect = (file) => {
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File too large. Max 5MB allowed.")
        return
      }
      setUploadedFile(file)
      setErrors((prev) => ({ ...prev, document: null }))
    }
  }

  const handleFileClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const validate = () => {
    const e = {}
    if (!FSSAI_NUMBER.test(number.trim())) e.number = "Enter the 14-digit FSSAI number"
    if (!expiry) e.expiry = "Enter the date the licence is valid up to"
    else if (new Date(`${expiry}T23:59:59`) < new Date()) e.expiry = "This date has passed. Upload your renewed licence."
    if (!uploadedFile && !existingDocument) e.document = "Upload a copy of the licence"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      let documentUrl = existingDocument
      if (uploadedFile) {
        const formData = new FormData()
        formData.append("file", uploadedFile)
        formData.append("folder", "fssai")
        const res = await restaurantAPI.uploadAttachment(formData)
        documentUrl = res?.data?.data?.url || ""
        if (!documentUrl) throw new Error("Upload failed. Please try again.")
      }
      await restaurantAPI.updateProfile({
        fssaiNumber: number.trim(),
        fssaiExpiry: expiry,
        fssaiImage: documentUrl,
      })
      toast.success("FSSAI licence saved and sent for verification")
      navigate("/restaurant/fssai", { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Could not save the licence")
    } finally {
      setSaving(false)
    }
  }

  const inputCls = (field) =>
    `w-full border rounded-md px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-black focus:border-black ${errors[field] ? "border-red-400" : "border-gray-300"}`

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-gray-200">
        <button
          onClick={goBack}
          className="p-2 rounded-full hover:bg-gray-100"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-900" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">Update FSSAI</h1>
      </div>

      {loading ? (
        <div className="flex-1 py-16 flex flex-col items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
      <form onSubmit={handleSubmit} id="fssai-form" className="flex-1 px-4 pt-4 pb-28 space-y-4 max-w-2xl w-full mx-auto">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          Changing licence details sends your profile to the admin for re-verification.
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            FSSAI registration number
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={14}
            value={number}
            onChange={(e) => { setNumber(e.target.value.replace(/\D/g, "")); setErrors((p) => ({ ...p, number: null })) }}
            placeholder="eg. 19138110019201"
            className={inputCls("number")}
          />
          {errors.number && <p className="text-xs text-red-600 mt-1">{errors.number}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Valid up to
          </label>
          <input
            type="date"
            value={expiry}
            onChange={(e) => { setExpiry(e.target.value); setErrors((p) => ({ ...p, expiry: null })) }}
            className={inputCls("expiry")}
            style={{ colorScheme: "light" }}
          />
          {errors.expiry && <p className="text-xs text-red-600 mt-1">{errors.expiry}</p>}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Upload your FSSAI license
          </label>
          <div
            onClick={handleFileClick}
            className={`w-full rounded-xl border border-dashed bg-gray-50 px-4 py-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-gray-100 transition-colors ${errors.document ? "border-red-400" : "border-gray-300"}`}
          >
            {uploadedFile ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">{uploadedFile.name}</p>
                <p className="text-xs text-gray-500">Click to change</p>
              </div>
            ) : existingDocument ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-900">Current licence on file</p>
                <p className="text-xs text-gray-500">Click to replace it</p>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-900 mb-1">
                  Upload your FSSAI license
                </p>
                <p className="text-xs text-gray-500">
                  A clear photo or scan, jpeg or png (up to 5MB)
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              accept="image/*"
            />
          </div>
          {errors.document && <p className="text-xs text-red-600">{errors.document}</p>}
        </div>
      </form>
      )}

      {/* Bottom button */}
      <div className="px-4 pb-6 pt-2 border-t border-gray-200 bg-white">
        <button
          type="submit"
          form="fssai-form"
          className="w-full py-3 rounded-full text-sm font-medium transition-colors bg-black text-white hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-500 inline-flex items-center justify-center gap-2"
          disabled={loading || saving}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? "Saving..." : "Confirm"}
        </button>
      </div>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleFileSelect}
        title="Upload FSSAI License"
        description="Choose how to upload your FSSAI license"
        fileNamePrefix="fssai-license"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}
