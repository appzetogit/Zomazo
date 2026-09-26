/**
 * Write or edit the signed-in customer's review of one product. The server
 * decides eligibility (a delivered order containing it); this only shows the
 * form when it says yes. Photos go through the shared upload endpoint first.
 */
import { useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@store/components/ui/dialog"
import { userAPI, uploadAPI } from "@store/api"
import { StarInput } from "./StarRating"

const MAX_PHOTOS = 5
const errorMessage = (e, fallback) => e?.response?.data?.message || e?.message || fallback

export default function ReviewFormDialog({ open, onOpenChange, productId, productName, onSaved }) {
  const [loading, setLoading] = useState(false)
  const [eligibility, setEligibility] = useState(null)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [images, setImages] = useState([])
  const [variantId, setVariantId] = useState("")
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!open || !productId) return
    let cancelled = false
    setLoading(true)
    userAPI.getReviewEligibility(productId)
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data || null
        setEligibility(data)
        const r = data?.review
        setRating(r?.rating || 0)
        setTitle(r?.title || "")
        setText(r?.text || "")
        setImages(Array.isArray(r?.images) ? r.images : [])
        setVariantId(r?.variantId || "")
      })
      .catch((e) => !cancelled && setEligibility({ eligible: false, message: errorMessage(e, "Could not check if you can review this") }))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [open, productId])

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, MAX_PHOTOS - images.length)
    if (!files.length) return
    setUploading(true)
    try {
      const urls = []
      for (const file of files) {
        const res = await uploadAPI.uploadMedia(file, { folder: "reviews" })
        const url = res?.data?.data?.url
        if (url) urls.push(url)
      }
      setImages((prev) => [...prev, ...urls].slice(0, MAX_PHOTOS))
    } catch (e) {
      toast.error(errorMessage(e, "Photo upload failed"))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!rating) {
      toast.error("Choose a star rating")
      return
    }
    setSaving(true)
    try {
      const res = await userAPI.saveProductReview(productId, { rating, title: title.trim(), text: text.trim(), images, variantId: variantId || undefined })
      toast.success(eligibility?.review ? "Review updated" : "Thanks for your review")
      onSaved?.(res?.data?.data?.review)
      onOpenChange?.(false)
    } catch (err) {
      toast.error(errorMessage(err, "Could not save your review"))
    } finally {
      setSaving(false)
    }
  }

  const editing = Boolean(eligibility?.review)
  const variants = eligibility?.variants || []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white p-5 text-gray-900">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit your review" : "Write a review"}</DialogTitle>
          {productName ? <DialogDescription className="line-clamp-2 text-gray-600">{productName}</DialogDescription> : null}
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-500" aria-label="Loading" /></div>
        ) : !eligibility?.eligible ? (
          <p className="py-6 text-sm text-gray-600">{eligibility?.message || "You can't review this product yet."}</p>
        ) : (
          <form onSubmit={submit} className="mt-2 space-y-4">
            <div>
              <p className="mb-1 text-sm font-semibold">Overall rating</p>
              <StarInput value={rating} onChange={setRating} />
            </div>

            {variants.length > 1 ? (
              <label className="block text-sm">
                <span className="mb-1 block font-semibold">Option you received</span>
                <select
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-wh-brand"
                >
                  <option value="">Not specified</option>
                  {variants.map((v) => <option key={v.variantId} value={v.variantId}>{v.variantName || "Option"}</option>)}
                </select>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Headline <span className="font-normal text-gray-500">(optional)</span></span>
              <input
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's most important to know?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-wh-brand"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-semibold">Review <span className="font-normal text-gray-500">(optional)</span></span>
              <textarea
                value={text}
                maxLength={2000}
                rows={4}
                onChange={(e) => setText(e.target.value)}
                placeholder="What did you like or dislike?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-wh-brand"
              />
            </label>

            <div>
              <p className="mb-1 text-sm font-semibold">Photos <span className="font-normal text-gray-500">(up to {MAX_PHOTOS})</span></p>
              <div className="flex flex-wrap gap-2">
                {images.map((url) => (
                  <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {images.length < MAX_PHOTOS ? (
                  <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-400 text-gray-500 focus-within:outline-2 focus-within:outline-wh-brand">
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-5 w-5" aria-hidden="true" />}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={uploading}
                      onChange={(e) => addPhotos(e.target.files)}
                      className="sr-only"
                      aria-label="Add photos"
                    />
                  </label>
                ) : null}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || uploading}
              className="inline-flex h-10 w-full items-center justify-center rounded-full border border-[#FCD200] bg-wh-cta text-sm font-medium text-wh-text hover:bg-wh-cta-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Update review" : "Submit review"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
