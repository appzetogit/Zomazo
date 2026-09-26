import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, Trash2, Loader2, Eye, Pencil, Plus, Save, ChevronDown, ChevronLeft, ChevronRight, FileUp, Download, X, Upload } from "lucide-react"
import { adminAPI, uploadAPI } from "@store/api"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@store/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@store/components/ui/popover"
import { getProductDisplayOtherPrice, getProductDisplayPrice, getProductVariants } from "@store/utils/productVariants"
import { canCurrentAdminAction } from "@store/utils/adminRbac"
import VariantMatrixEditor, { CHANNELS, CHANNEL_LABEL, createVariantDraft, perChannelDraft, perChannelPayload, toVariantPayload } from "@store/components/shared/products/VariantMatrixEditor"
import { getApprovedChannels } from "@store/components/admin/sellers/SellerChannels"
import { useAdminPanel } from "@store/components/admin/useAdminPanel"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const getEntityId = (value) => {
  if (!value) return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object") {
    return String(value._id || value.id || value.sellerId || "")
  }
  return ""
}

const getSellerName = (value) => {
  if (!value || typeof value !== "object") return ""
  return String(value.name || value.sellerName || "")
}

const createProductForm = () => ({
  sellerId: "",
  categoryId: "",
  categoryName: "",
  name: "",
  price: "",
  otherPrice: "",
  variants: [],
  description: "",
  image: "",
  foodType: "",
  isAvailable: true,
  preparationTime: "",
  // CHANNELS_CONTRACT.md: per-channel listing, stock (empty = not counted) and low-stock alert.
  channels: { quick: true, shop: true },
  stock: { quick: "", shop: "" },
  lowStockThreshold: { quick: "", shop: "" },
})

const stockLabel = (n) => (n === null || n === undefined || n === "" ? "Not counted" : String(n))


const PRODUCT_FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
      <rect width="80" height="80" rx="12" fill="#F1F5F9"/>
      <circle cx="40" cy="30" r="12" fill="#CBD5E1"/>
      <rect x="20" y="48" width="40" height="8" rx="4" fill="#CBD5E1"/>
    </svg>`
  )

export default function ProductsList() {
  const { channel } = useAdminPanel()
  // sellerId -> seller.channels, used to limit the product channel toggles.
  const [sellerChannelsById, setSellerChannelsById] = useState({})
  // Deep links (e.g. from Low Stock): ?sellerId=&search=&productId=&edit=1
  const [initialParams] = useState(() => new URLSearchParams(window.location.search))
  const [searchQuery, setSearchQuery] = useState(() => initialParams.get("search") || "")
  const [selectedSeller, setSelectedSeller] = useState(() => initialParams.get("sellerId") || "all")
  const [products, setProducts] = useState([])
  const [sellersForFilter, setSellersForFilter] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showProductFormModal, setShowProductFormModal] = useState(false)
  const [productFormMode, setProductFormMode] = useState("add")
  const [productForm, setProductForm] = useState(createProductForm())
  const [editingProduct, setEditingProduct] = useState(null)
  const [submittingProduct, setSubmittingProduct] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [categorySearch, setCategorySearch] = useState("")
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState("")

  /**
   * The dish's images, primary first.
   *
   * Already-saved images and newly picked files live in the same list so the
   * ordering the admin sees is the ordering that gets saved. An entry is either
   * `{url}` (already uploaded) or `{file}` (pending upload) — only the latter costs
   * an upload request on save, so re-saving a dish does not re-upload everything.
   */
  const [productImages, setProductImages] = useState([])

  const addImageFiles = (files) => {
    setProductImages((prev) => [
      ...prev,
      ...files.map((file, i) => ({
        key: `new-${Date.now()}-${i}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }

  const removeImageAt = (index) => {
    setProductImages((prev) => {
      const target = prev[index]
      // Release the blob URL, otherwise every removed pick leaks until reload.
      if (target?.file && target.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const makePrimaryImage = (index) => {
    setProductImages((prev) => {
      if (index <= 0 || index >= prev.length) return prev
      const next = [...prev]
      const [picked] = next.splice(index, 1)
      return [picked, ...next]
    })
  }
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalProducts, setTotalProducts] = useState(0)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(() => initialParams.get("search") || "")
  const [imageVersion, setImageVersion] = useState(Date.now())
  const [sellerFilterSearch, setSellerFilterSearch] = useState("")
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false)
  const [bulkUploadFile, setBulkUploadFile] = useState(null)
  const [bulkUploadResults, setBulkUploadResults] = useState(null)
  const [isBulkUploading, setIsBulkUploading] = useState(false)
  const [bulkUploadSellerId, setBulkUploadSellerId] = useState("")
  const [bulkUploadSellerSearch, setBulkUploadSellerSearch] = useState("")
  const [selectedProductIds, setSelectedProductIds] = useState(() => new Set())
  const [selectAllForSeller, setSelectAllForSeller] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const ensureActionAccess = (action) => {
    if (canCurrentAdminAction(action)) return true
    toast.error("Insufficient permissions for this action")
    return false
  }

  const withImageVersion = (url) => {
    if (!url || typeof url !== "string") return PRODUCT_FALLBACK_IMAGE
    return `${url}${url.includes("?") ? "&" : "?"}v=${imageVersion}`
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim())
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [searchQuery])

  const fetchSellersForFilter = useCallback(async () => {
    try {
      const sellersResponse = await adminAPI.getSellers({ limit: 1000 })
      const list =
        sellersResponse?.data?.data?.sellers ||
        sellersResponse?.data?.sellers ||
        []

      const sellersMap = new Map()
      const channelsById = {}
      ;(Array.isArray(list) ? list : []).forEach((seller) => {
        const id = getEntityId(seller)
        if (id && seller?.channels) channelsById[id] = seller.channels
        const sellerId = getEntityId(seller)
        if (!sellerId || sellersMap.has(sellerId)) return
        sellersMap.set(sellerId, {
          id: sellerId,
          name: getSellerName(seller) || "Unknown Seller",
        })
      })

      setSellerChannelsById(channelsById)
      setSellersForFilter(
        Array.from(sellersMap.values()).sort((a, b) => a.name.localeCompare(b.name))
      )
    } catch (error) {
      debugError("Error fetching sellers:", error)
      setSellersForFilter([])
    }
  }, [])

  useEffect(() => {
    fetchSellersForFilter()
  }, [fetchSellersForFilter])

  const fetchAllProducts = useCallback(async () => {
    try {
      setLoading(true)

      // Panel scope: /admin/quick lists channels.quick = true, /admin/shop channels.shop = true.
      const params = { page: currentPage, limit: pageSize, channel }
      if (selectedSeller !== "all") params.sellerId = selectedSeller
      if (debouncedSearchQuery) params.search = debouncedSearchQuery

      const productsRes = await adminAPI.getProducts(params)
      const list = productsRes?.data?.data?.products || []
      const total = Number(productsRes?.data?.data?.total ?? productsRes?.data?.total ?? 0)
      const normalizedProducts = Array.isArray(list)
        ? list.map((f) => ({
            id: String(f.id || f._id || ""),
            _id: f._id || f.id,
            name: f.name || "Unnamed Item",
            image: f.image || PRODUCT_FALLBACK_IMAGE,
            status: f.isAvailable !== false && String(f.approvalStatus || "").toLowerCase() !== "rejected",
            sellerId: getEntityId(f.sellerId || f.seller?._id || f.seller),
            sellerName:
              f.sellerName ||
              getSellerName(f.seller) ||
              "Unknown Seller",
            categoryId: String(f.categoryId || ""),
            categoryName: f.categoryName || "",
            price: getProductDisplayPrice(f),
            otherPrice: getProductDisplayOtherPrice(f),
            variants: getProductVariants(f),
            // Full variant records (sku, attributes, stock...) for the variant editor.
            rawVariants: Array.isArray(f.variants) ? f.variants : Array.isArray(f.variations) ? f.variations : [],
            foodType: f.foodType === "Veg" || f.foodType === "Non-Veg" ? f.foodType : "",
            approvalStatus: f.approvalStatus || "approved",
            description: f.description || "",
            preparationTime: f.preparationTime || "",
            isAvailable: f.isAvailable !== false,
            channels: { quick: f.channels?.quick !== false, shop: f.channels?.shop !== false },
            stock: { quick: f.stock?.quick ?? null, shop: f.stock?.shop ?? null },
            lowStockThreshold: { quick: f.lowStockThreshold?.quick ?? null, shop: f.lowStockThreshold?.shop ?? null },
            availableIn: f.availableIn || null,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          }))
        : []

      setProducts(normalizedProducts)
      setTotalProducts(Number.isFinite(total) ? total : normalizedProducts.length)
      setImageVersion(Date.now())
      setSellersForFilter((prev) => {
        const sellersMap = new Map((Array.isArray(prev) ? prev : []).map((seller) => [seller.id, seller]))
        normalizedProducts.forEach((food) => {
          const sellerId = getEntityId(food.sellerId)
          if (!sellerId || sellersMap.has(sellerId)) return
          sellersMap.set(sellerId, {
            id: sellerId,
            name: food.sellerName || "Unknown Seller",
          })
        })
        return Array.from(sellersMap.values()).sort((a, b) => a.name.localeCompare(b.name))
      })
    } catch (error) {
      debugError("Error fetching products:", error)
      toast.error("Failed to load products")
      setProducts([])
      setTotalProducts(0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, selectedSeller, debouncedSearchQuery, channel])

  useEffect(() => {
    fetchAllProducts()
  }, [fetchAllProducts])

  const [searchParams] = useSearchParams()
  const productIdFromUrl = searchParams.get("productId")
  const editFromUrl = searchParams.get("edit") === "1"
  const openedFromUrlRef = useRef("")

  useEffect(() => {
    if (productIdFromUrl && products.length > 0 && openedFromUrlRef.current !== productIdFromUrl) {
      const food = products.find(f => f.id === productIdFromUrl || f._id === productIdFromUrl)
      if (food) {
        openedFromUrlRef.current = productIdFromUrl
        if (editFromUrl) openEditProductModal(food)
        else handleViewDetails(food)
      }
    }
  }, [productIdFromUrl, editFromUrl, products])

  // Format ID to FOOD format (e.g., FOOD519399)
  const formatProductId = (id) => {
    if (!id) return "FOOD000000"
    
    const idString = String(id)
    // Extract last 6 digits from the ID
    // Handle formats like "1768285554154-0.703896654519399" or "item-1768285554154-0.703896654519399"
    const parts = idString.split(/[-.]/)
    let lastDigits = ""
    
    // Get the last part and extract digits
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1]
      // Extract only digits from the last part
      const digits = lastPart.match(/\d+/g)
      if (digits && digits.length > 0) {
        // Get last 6 digits from all digits found
        const allDigits = digits.join("")
        lastDigits = allDigits.slice(-6).padStart(6, "0")
      }
    }
    
    // If no digits found, use a hash of the ID
    if (!lastDigits) {
      const hash = idString.split("").reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
    }
    
    return `PRD${lastDigits}`
  }

  const totalPages = useMemo(() => {
    if (totalProducts === 0) return 1
    return Math.ceil(totalProducts / pageSize)
  }, [totalProducts, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedSeller, pageSize])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const sellerOptions = useMemo(() => {
    return sellersForFilter
  }, [sellersForFilter])

  const filteredSellerOptions = useMemo(() => {
    const query = sellerFilterSearch.trim().toLowerCase()
    if (!query) return sellerOptions
    return sellerOptions.filter((seller) =>
      seller.name.toLowerCase().includes(query)
    )
  }, [sellerOptions, sellerFilterSearch])

  const filteredBulkUploadSellers = useMemo(() => {
    const query = bulkUploadSellerSearch.trim().toLowerCase()
    if (!query) return sellerOptions
    return sellerOptions.filter((seller) =>
      seller.name.toLowerCase().includes(query)
    )
  }, [sellerOptions, bulkUploadSellerSearch])

  const isSellerSelected = selectedSeller !== "all"
  const pageProductIds = useMemo(() => products.map((food) => food.id), [products])
  const allPageSelected =
    pageProductIds.length > 0 &&
    pageProductIds.every((id) => selectAllForSeller || selectedProductIds.has(id))
  const somePageSelected =
    !selectAllForSeller &&
    pageProductIds.some((id) => selectedProductIds.has(id))
  const selectedDeleteCount = selectAllForSeller ? totalProducts : selectedProductIds.size

  useEffect(() => {
    setSelectedProductIds(new Set())
    setSelectAllForSeller(false)
  }, [selectedSeller, debouncedSearchQuery])

  useEffect(() => {
    if (!selectAllForSeller) return
    setSelectedProductIds(new Set())
  }, [currentPage, selectAllForSeller])

  /** Channels the seller is approved for. Unknown (no channels in the list response) = let the server decide. */
  const allowedChannelsFor = (sellerId) => {
    const ch = sellerChannelsById[String(sellerId || "")]
    return ch ? getApprovedChannels({ channels: ch }) : CHANNELS
  }
  const clampChannels = (channels, sellerId) => {
    const allowed = allowedChannelsFor(sellerId)
    return { quick: !!channels?.quick && allowed.includes("quick"), shop: !!channels?.shop && allowed.includes("shop") }
  }

  /** Variant photos go to the same folder as product photos. */
  const uploadAdminVariantImage = async (file) => {
    const res = await uploadAPI.uploadMedia(file, { folder: "products" })
    return res?.data?.data?.url || res?.data?.url || ""
  }

  const openAddProductModal = () => {
    if (!ensureActionAccess("create")) return
    setProductFormMode("add")
    setEditingProduct(null)
    setProductForm({
      ...createProductForm(),
      sellerId: selectedSeller !== "all" ? selectedSeller : "",
    })
    setSelectedImageFile(null)
    setImagePreviewUrl("")
    setProductImages([])
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowProductFormModal(true)
  }

  const openEditProductModal = (food) => {
    if (!ensureActionAccess("edit")) return
    setProductFormMode("edit")
    setEditingProduct(food)
    setProductForm({
      sellerId: String(food.sellerId || ""),
      categoryId: String(food.categoryId || ""),
      categoryName: String(food.categoryName || ""),
      name: String(food.name || ""),
      price: String(food.price || ""),
      otherPrice: String(food.otherPrice || ""),
      variants: (food.rawVariants?.length ? food.rawVariants : getProductVariants(food)).map(createVariantDraft),
      description: String(food.description || ""),
      image: String(food.image || ""),
      foodType: food.foodType === "Veg" || food.foodType === "Non-Veg" ? food.foodType : "",
      isAvailable: food.isAvailable !== false,
      preparationTime: String(food.preparationTime || ""),
      channels: { quick: food.channels?.quick !== false, shop: food.channels?.shop !== false },
      stock: perChannelDraft(food.stock),
      lowStockThreshold: perChannelDraft(food.lowStockThreshold),
    })
    setSelectedImageFile(null)
    setImagePreviewUrl(String(food.image || ""))
    // Prefer the gallery, but fall back to the single image so dishes saved
    // before galleries existed still open with their photo attached rather than
    // appearing to have none — saving would otherwise silently clear it.
    setProductImages(
      (Array.isArray(food.images) && food.images.length
        ? food.images
        : (food.image ? [food.image] : [])
      )
        .map((url) => String(url || "").trim())
        .filter(Boolean)
        .map((url, i) => ({ key: `saved-${i}-${url}`, url, previewUrl: url })),
    )
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowProductFormModal(true)
  }

  useEffect(() => {
    if (!showProductFormModal) {
      setCategoryOptions([])
      return
    }

    let cancelled = false

    const loadCategoryOptions = async () => {
      try {
        const res = await adminAPI.getCategories({ limit: 1000 })
        const list = res?.data?.data?.categories || []
        const options = Array.isArray(list)
          ? list
              .map((c) => ({ id: String(c.id || c._id || c.name), name: String(c.name || "").trim() }))
              .filter((c) => c.name)
          : []
        if (!cancelled) setCategoryOptions(options)
      } catch (error) {
        if (!cancelled) {
          setCategoryOptions([])
        }
      }
    }

    loadCategoryOptions()

    return () => {
      cancelled = true
    }
  }, [showProductFormModal])

  const handleVariantsChange = (variants) => {
    if (!ensureActionAccess(productFormMode === "edit" ? "edit" : "create")) return
    setProductForm((prev) => ({ ...prev, variants }))
  }

  const handleProductFormSubmit = async () => {
    if (!ensureActionAccess(productFormMode === "edit" ? "edit" : "create")) return
    if (!productForm.sellerId) {
      toast.error("Please select a seller")
      return
    }
    if (!String(productForm.categoryName || "").trim()) {
      toast.error("Please select or enter a category")
      return
    }
    if (!productForm.name.trim()) {
      toast.error("Product name is required")
      return
    }

    const allowed = allowedChannelsFor(productForm.sellerId)
    const productChannels = { quick: !!productForm.channels?.quick && allowed.includes("quick"), shop: !!productForm.channels?.shop && allowed.includes("shop") }
    if (!productChannels.quick && !productChannels.shop) {
      toast.error(allowed.length ? "Enable at least one channel" : "This seller is not approved for any channel yet")
      return
    }
    const [stockError, stockPayload] = perChannelPayload(productForm.stock, "stock")
    if (stockError) {
      toast.error(stockError)
      return
    }
    const [lowError, lowPayload] = perChannelPayload(productForm.lowStockThreshold, "low-stock alert")
    if (lowError) {
      toast.error(lowError)
      return
    }

    const [variantError, variantPayload] = toVariantPayload(Array.isArray(productForm.variants) ? productForm.variants : [])
    if (variantError) {
      toast.error(variantError)
      return
    }

    const hasVariants = variantPayload.length > 0
    const parsedPrice = Number(productForm.price)
    const parsedOtherPrice = Number(productForm.otherPrice) || 0

    if (!hasVariants && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      toast.error("Base price must be greater than 0")
      return
    }

    if (!hasVariants && parsedOtherPrice > 0 && parsedOtherPrice <= parsedPrice) {
      toast.error("Other platform price should be greater than selling price")
      return
    }

    try {
      setSubmittingProduct(true)

      // Upload only the entries that are new files; already-saved URLs pass
      // straight through, so re-saving a dish does not re-upload its whole
      // gallery. Order is preserved because each slot is resolved in place.
      const uploadedUrls = await Promise.all(
        productImages.map(async (img) => {
          if (img.url) return img.url
          const uploadResponse = await uploadAPI.uploadMedia(img.file, {
            folder: "products",
          })
          return (
            uploadResponse?.data?.data?.url ||
            uploadResponse?.data?.url ||
            ""
          )
        }),
      )

      const imageUrls = uploadedUrls.map((u) => String(u || "").trim()).filter(Boolean)

      // A failed upload must not silently drop a photo the admin can see in the
      // form — they would save, see fewer images, and have no idea why.
      if (imageUrls.length !== productImages.length) {
        toast.error("Some images failed to upload. Please try again.")
        return
      }

      const imageUrl = imageUrls[0] || ""

      const payload = {
        sellerId: productForm.sellerId,
        categoryId: productForm.categoryId || undefined,
        categoryName: String(productForm.categoryName || "").trim(),
        name: productForm.name.trim(),
        price: hasVariants ? undefined : parsedPrice,
        otherPrice: hasVariants ? 0 : parsedOtherPrice,
        variants: variantPayload,
        description: productForm.description.trim(),
        image: imageUrl,
        images: imageUrls,
        foodType: productForm.foodType === "Veg" || productForm.foodType === "Non-Veg" ? productForm.foodType : null,
        isAvailable: productForm.isAvailable !== false,
        preparationTime: String(productForm.preparationTime || "").trim(),
        channels: productChannels,
        stock: stockPayload,
        lowStockThreshold: lowPayload,
      }

      if (productFormMode === "edit") {
        await adminAPI.updateProduct(editingProduct?._id || editingProduct?.id, payload)
      } else {
        await adminAPI.createProduct(payload)
      }
      toast.success(productFormMode === "edit" ? "Product updated successfully" : "Product added successfully")
      setShowProductFormModal(false)
      setEditingProduct(null)
      setProductForm(createProductForm())
      setSelectedImageFile(null)
      setImagePreviewUrl("")
      setProductImages([])
      await fetchAllProducts()
    } catch (error) {
      debugError("Error saving product:", error)
      toast.error(error?.response?.data?.message || "Failed to save product")
    } finally {
      setSubmittingProduct(false)
    }
  }

  const handleDelete = async (id) => {
    if (!ensureActionAccess("delete")) return
    const food = products.find(f => f.id === id)
    if (!food) return

    if (!window.confirm(`Are you sure you want to delete "${food.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      setDeleting(true)
      await adminAPI.deleteProduct(food?._id || food?.id)
      await fetchAllProducts()
      toast.success("Product deleted successfully")
    } catch (error) {
      debugError("Error deleting product:", error)
      toast.error(error?.response?.data?.message || "Failed to delete product")
    } finally {
      setDeleting(false)
    }
  }

  const openBulkUploadModal = () => {
    if (!ensureActionAccess("create")) return
    setBulkUploadSellerId(selectedSeller !== "all" ? selectedSeller : "")
    setBulkUploadSellerSearch("")
    setBulkUploadFile(null)
    setBulkUploadResults(null)
    setIsBulkUploadModalOpen(true)
  }

  const handleDownloadBulkTemplate = async () => {
    try {
      const response = await adminAPI.bulkUploadTemplate()
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", "Bulk_Menu_Template.xlsx")
      document.body.appendChild(link)
      link.click()
      link.remove()
      toast.success("Template downloaded successfully")
    } catch (error) {
      debugError("Error downloading template:", error)
      toast.error("Failed to download template")
    }
  }

  const handleBulkUpload = async () => {
    if (!bulkUploadSellerId) {
      toast.error("Please select a seller first")
      return
    }
    if (!bulkUploadFile) {
      toast.error("Please select an Excel file first")
      return
    }

    try {
      setIsBulkUploading(true)
      const response = await adminAPI.bulkUploadProducts(bulkUploadSellerId, bulkUploadFile)
      if (response.data?.success) {
        const results = response.data.data || {}
        const normalizedErrors = Array.isArray(results.errors)
          ? results.errors
          : Array.isArray(results.details)
            ? results.details
            : []
        const normalizedResults = { ...results, errors: normalizedErrors }
        setBulkUploadResults(normalizedResults)
        toast.info(`Processed ${(normalizedResults.success || 0) + (normalizedResults.failed || 0)} items`)
        if (normalizedResults.success > 0) {
          await fetchAllProducts()
        }
      }
    } catch (error) {
      debugError("Error uploading menu:", error)
      toast.error(error?.response?.data?.message || "Bulk upload failed")
    } finally {
      setIsBulkUploading(false)
    }
  }

  const onBulkFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB limit")
      return
    }
    setBulkUploadFile(file)
  }

  const toggleProductSelection = (productId) => {
    if (selectAllForSeller) {
      setSelectAllForSeller(false)
      setSelectedProductIds(new Set(pageProductIds.filter((id) => id !== productId)))
      return
    }
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectAllForSeller(false)
      setSelectedProductIds(new Set())
      return
    }
    setSelectAllForSeller(false)
    setSelectedProductIds(new Set(pageProductIds))
  }

  const handleSelectAllForSeller = () => {
    setSelectAllForSeller(true)
    setSelectedProductIds(new Set())
  }

  const handleBulkDelete = async () => {
    if (!ensureActionAccess("delete")) return
    if (!isSellerSelected) {
      toast.error("Select a seller to bulk delete items")
      return
    }
    if (selectedDeleteCount === 0) {
      toast.error("Select at least one product")
      return
    }

    const sellerName =
      sellerOptions.find((seller) => seller.id === selectedSeller)?.name ||
      "this seller"

    if (
      !window.confirm(
        `Delete ${selectedDeleteCount} product(s) from ${sellerName}? This cannot be undone.`
      )
    ) {
      return
    }

    try {
      setIsBulkDeleting(true)
      const response = await adminAPI.bulkDeleteProducts({
        sellerId: selectedSeller,
        selectAll: selectAllForSeller,
        productIds: selectAllForSeller ? [] : Array.from(selectedProductIds),
        search: selectAllForSeller ? debouncedSearchQuery : undefined,
      })
      const deletedCount = response?.data?.data?.deletedCount ?? selectedDeleteCount
      toast.success(`Deleted ${deletedCount} product(s)`)
      setSelectedProductIds(new Set())
      setSelectAllForSeller(false)
      await fetchAllProducts()
    } catch (error) {
      debugError("Error bulk deleting products:", error)
      toast.error(error?.response?.data?.message || "Failed to delete selected products")
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const handleViewDetails = (food) => {
    setSelectedProduct(food)
    setShowDetailModal(true)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      {/* Header Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-0.5">
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Product List</h2>
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
              {totalProducts}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={openAddProductModal}
              className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
            <button
              type="button"
              onClick={openBulkUploadModal}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 inline-flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              <span>Bulk Upload</span>
            </button>
            {isSellerSelected && selectedDeleteCount > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>Delete Selected ({selectedDeleteCount})</span>
              </button>
            )}
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <input
                type="text"
                placeholder="Ex : Products"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <div className="flex flex-col gap-2 min-w-[240px]">
              <input
                type="text"
                placeholder="Search seller..."
                value={sellerFilterSearch}
                onChange={(e) => setSellerFilterSearch(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <select
                value={selectedSeller}
                onChange={(e) => setSelectedSeller(e.target.value)}
                className="px-4 py-2.5 min-w-[240px] text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              >
                <option value="all">All Sellers</option>
                {filteredSellerOptions.map((seller) => (
                  <option key={seller.id} value={seller.id}>
                    {seller.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {isSellerSelected && allPageSelected && totalProducts > products.length && !selectAllForSeller && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 text-sm text-blue-800 flex flex-wrap items-center gap-2">
            <span>All {products.length} items on this page are selected.</span>
            <button
              type="button"
              onClick={handleSelectAllForSeller}
              className="font-semibold underline hover:text-blue-900"
            >
              Select all {totalProducts} items for this seller
              {debouncedSearchQuery ? " matching your search" : ""}
            </button>
          </div>
        )}
        {isSellerSelected && selectAllForSeller && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 text-sm text-blue-800 flex flex-wrap items-center gap-2">
            <span>All {totalProducts} items are selected for bulk delete.</span>
            <button
              type="button"
              onClick={() => {
                setSelectAllForSeller(false)
                setSelectedProductIds(new Set())
              }}
              className="font-semibold underline hover:text-blue-900"
            >
              Clear selection
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {isSellerSelected && (
                  <th className="px-4 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = somePageSelected && !allPageSelected
                      }}
                      onChange={toggleSelectAllPage}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all on page"
                    />
                  </th>
                )}
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  SL
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Image
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Seller
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Channels
                </th>
                {CHANNELS.map((c) => (
                  <th key={c} className={`px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider ${c === channel ? "text-blue-700" : "text-slate-700"}`}>
                    {CHANNEL_LABEL[c]} stock
                  </th>
                ))}
                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={isSellerSelected ? 10 : 9} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm text-slate-500">Loading products...</p>
                    </div>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={isSellerSelected ? 10 : 9} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No products match your search or seller filter</p>
                    </div>
                  </td>
                </tr>
              ) : (
                products.map((food, index) => (
                  <tr
                    key={food.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    {isSellerSelected && (
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectAllForSeller || selectedProductIds.has(food.id)}
                          onChange={() => toggleProductSelection(food.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          aria-label={`Select ${food.name}`}
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-700">{(currentPage - 1) * pageSize + index + 1}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center">
                        <img
                          src={withImageVersion(food.image)}
                          alt={food.name}
                          className="w-full h-full object-cover"
                          key={`${food.id}-${imageVersion}`}
                          loading="lazy"
                          onError={(e) => {
                            e.target.src = PRODUCT_FALLBACK_IMAGE
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{food.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.sellerName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.categoryName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1">
                        {CHANNELS.filter((c) => food.channels?.[c]).map((c) => (
                          <span
                            key={c}
                            title={food.availableIn && !food.availableIn[c] ? `Not available in ${CHANNEL_LABEL[c]} right now` : undefined}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              food.availableIn && !food.availableIn[c] ? "bg-slate-100 text-slate-500 line-through" : c === "quick" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
                            }`}
                          >
                            {CHANNEL_LABEL[c]}
                          </span>
                        ))}
                      </div>
                    </td>
                    {CHANNELS.map((c) => {
                      const qty = food.stock?.[c]
                      const low = food.lowStockThreshold?.[c]
                      const isLow = qty !== null && qty !== undefined && low !== null && low !== undefined && Number(qty) <= Number(low)
                      return (
                        <td key={c} className="px-6 py-4 whitespace-nowrap">
                          {food.channels?.[c] ? (
                            <span className={`text-sm ${isLow ? "font-semibold text-rose-600" : "text-slate-800"}`}>{stockLabel(qty)}</span>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewDetails(food)}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditProductModal(food)}
                          className="p-1.5 rounded text-amber-600 hover:bg-amber-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(food.id)}
                          disabled={deleting}
                          className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                        >
                          {deleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && totalProducts > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
            <div className="text-sm text-slate-600">
              Showing{" "}
              <span className="font-semibold text-slate-800">{(currentPage - 1) * pageSize + 1}</span>
              {" "}to{" "}
              <span className="font-semibold text-slate-800">
                {Math.min((currentPage - 1) * pageSize + products.length, totalProducts)}
              </span>
              {" "}of{" "}
              <span className="font-semibold text-slate-800">{totalProducts}</span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2.5 py-1.5 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>

              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>

              <span className="px-3 py-1.5 text-sm font-medium text-slate-700">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">Product Details</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <img
                          src={withImageVersion(selectedProduct.image)}
                          alt={selectedProduct.name}
                          className="w-20 h-20 rounded-xl object-cover border border-slate-200"
                  onError={(e) => {
                    e.target.src = PRODUCT_FALLBACK_IMAGE
                  }}
                />
                <div>
                  <p className="text-lg font-semibold text-slate-900">{selectedProduct.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">ID #{formatProductId(selectedProduct.id)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p><span className="font-semibold text-slate-700">Seller:</span> <span className="text-slate-900">{selectedProduct.sellerName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Price:</span> <span className="text-slate-900">{selectedProduct.variants?.length ? `Starting from \u20B9${selectedProduct.price}` : `\u20B9${selectedProduct.price}`}</span></p>
                <p><span className="font-semibold text-slate-700">Category:</span> <span className="text-slate-900">{selectedProduct.categoryName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Veg / Non-veg:</span> <span className="text-slate-900">{selectedProduct.foodType || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Approval:</span> <span className="text-slate-900 capitalize">{selectedProduct.approvalStatus || "-"}</span></p>
              </div>
              {selectedProduct.variants?.length ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Variants</p>
                  <div className="space-y-2">
                    {selectedProduct.variants.map((variant) => (
                      <div key={variant.id || variant._id} className="flex items-center justify-between text-sm text-slate-700">
                        <span>{variant.name}</span>
                        <span className="font-semibold text-slate-900">{"\u20B9"}{variant.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedProduct.description && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-800">Description:</span> {selectedProduct.description}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showProductFormModal}
        onOpenChange={(open) => {
          setShowProductFormModal(open)
          if (!open) {
            setEditingProduct(null)
            setProductForm(createProductForm())
            setCategoryOptions([])
            setCategorySearch("")
            setCategoryPopoverOpen(false)
            setSelectedImageFile(null)
            setImagePreviewUrl("")
            setProductImages([])
          }
        }}
      >
        <DialogContent className="max-w-5xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {productFormMode === "edit" ? "Edit Product" : "Add Product"}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Seller</label>
                <select
                  value={productForm.sellerId}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, sellerId: e.target.value, categoryId: "", categoryName: "", channels: clampChannels({ quick: true, shop: true }, e.target.value) }))}
                  disabled={productFormMode === "edit"}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100"
                >
                  <option value="">Select seller</option>
                  {sellerOptions.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {seller.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-left flex items-center justify-between"
                    >
                      <span className={productForm.categoryName ? "text-slate-900" : "text-slate-400"}>
                        {productForm.categoryName || "Select category"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white mb-2"
                      placeholder="Search category..."
                      autoFocus
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {categoryOptions
                        .filter((c) => {
                          const q = String(categorySearch || "").trim().toLowerCase()
                          if (!q) return true
                          return String(c.name || "").toLowerCase().includes(q)
                        })
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setProductForm((prev) => ({ ...prev, categoryId: c.id, categoryName: c.name }))
                              setCategoryPopoverOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-slate-100 ${
                              String(productForm.categoryName || "") === String(c.name) ? "bg-slate-100 font-medium" : ""
                            }`}
                          >
                            {c.name}
                          </button>
                        ))}
                      {categoryOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500">No categories found</div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={productForm.name}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Base Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.price}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, price: e.target.value }))}
                  disabled={(productForm.variants || []).length > 0}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                />
                {(productForm.variants || []).length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">Variants are active, so customers will see the lowest variant price as the starting price.</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other Platform Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.otherPrice}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, otherPrice: e.target.value }))}
                  disabled={(productForm.variants || []).length > 0}
                  placeholder="Optional"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                />
                <p className="mt-1 text-xs text-slate-500">Shown with strikethrough when higher than selling price.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Veg / Non-veg</label>
                <select
                  value={productForm.foodType}
                  onChange={(e) => setProductForm((prev) => ({ ...prev, foodType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">Not applicable</option>
                  <option value="Veg">Veg</option>
                  <option value="Non-Veg">Non-Veg</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Upload Images</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    if (files.length) addImageFiles(files)
                    // Reset so picking the same file again still fires onChange —
                    // otherwise removing an image and re-adding it does nothing.
                    e.target.value = ""
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  First image is the one shown in listings and search. Drag is not needed —
                  use “Make primary”.
                </p>
              </div>
              {productImages.length ? (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Images ({productImages.length})
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {productImages.map((img, index) => (
                      <div
                        key={img.key}
                        className={`relative w-28 rounded-lg overflow-hidden border bg-slate-50 ${
                          index === 0 ? "border-emerald-500 border-2" : "border-slate-200"
                        }`}
                      >
                        <div className="w-28 h-28">
                          <img
                            src={img.previewUrl}
                            alt={`Product ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        {index === 0 ? (
                          <span className="absolute top-1 left-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Primary
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeImageAt(index)}
                          title="Remove"
                          className="absolute top-1 right-1 rounded bg-black/60 p-1 text-white hover:bg-black/80"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        {index !== 0 ? (
                          <button
                            type="button"
                            onClick={() => makePrimaryImage(index)}
                            className="w-full bg-slate-100 py-1 text-[11px] text-slate-700 hover:bg-slate-200"
                          >
                            Make primary
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-6 pt-7">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={productForm.isAvailable}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, isAvailable: e.target.checked }))}
                  />
                  Available
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={4}
                value={productForm.description}
                onChange={(e) => setProductForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white resize-none"
              />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Channels and stock</p>
                <p className="text-xs text-slate-500">
                  Only channels the seller is approved for can be enabled. Empty stock means not counted (always in stock).
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CHANNELS.map((c) => {
                  const allowed = allowedChannelsFor(productForm.sellerId).includes(c)
                  const on = !!productForm.channels?.[c] && allowed
                  return (
                    <div key={c} className={`rounded-lg border p-3 bg-white ${allowed ? "border-slate-200" : "border-dashed border-slate-300 opacity-60"}`}>
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!allowed}
                          onChange={(e) => setProductForm((prev) => ({ ...prev, channels: { ...(prev.channels || {}), [c]: e.target.checked } }))}
                        />
                        Sell in {CHANNEL_LABEL[c]}
                        {!allowed && <span className="text-[11px] font-normal text-slate-500">(seller not approved)</span>}
                      </label>
                      {on && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">{CHANNEL_LABEL[c]} stock</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="Not counted"
                              value={productForm.stock?.[c] ?? ""}
                              onChange={(e) => setProductForm((prev) => ({ ...prev, stock: { ...(prev.stock || {}), [c]: e.target.value } }))}
                              className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">Low-stock alert</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={productForm.lowStockThreshold?.[c] ?? ""}
                              onChange={(e) => setProductForm((prev) => ({ ...prev, lowStockThreshold: { ...(prev.lowStockThreshold || {}), [c]: e.target.value } }))}
                              className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <VariantMatrixEditor
                categoryId={productForm.categoryId}
                variants={productForm.variants || []}
                onChange={handleVariantsChange}
                productChannels={clampChannels(productForm.channels, productForm.sellerId)}
                approvedChannels={allowedChannelsFor(productForm.sellerId)}
                uploadImage={uploadAdminVariantImage}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleProductFormSubmit}
                disabled={submittingProduct}
                className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {submittingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{submittingProduct ? "Saving..." : productFormMode === "edit" ? "Update Product" : "Add Product"}</span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isBulkUploadModalOpen} onOpenChange={(open) => {
        if (!isBulkUploading) setIsBulkUploadModalOpen(open)
      }}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">Bulk Menu Upload</DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {!bulkUploadResults ? (
              <>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-4">
                  <div className="bg-blue-100 p-2 rounded-lg shrink-0">
                    <Download className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Step 1: Download Template</p>
                    <p className="text-xs text-slate-600 mt-1">Use the Excel template to add products in bulk.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Optional columns: Sell in Quick / Sell in Shop (Yes/No) and Quick / Shop stock. Blank keeps the current value; Yes only works for channels the seller is approved for.
                    </p>
                    <button
                      type="button"
                      onClick={handleDownloadBulkTemplate}
                      className="mt-3 px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100"
                    >
                      Download Template
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">Step 2: Select Seller</label>
                  <input
                    type="text"
                    placeholder="Search seller..."
                    value={bulkUploadSellerSearch}
                    onChange={(e) => setBulkUploadSellerSearch(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                  <select
                    value={bulkUploadSellerId}
                    onChange={(e) => setBulkUploadSellerId(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    <option value="">Choose a seller</option>
                    {filteredBulkUploadSellers.map((seller) => (
                      <option key={seller.id} value={seller.id}>
                        {seller.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-slate-900">Step 3: Upload Excel File</label>
                  <label
                    className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                      bulkUploadFile ? "border-emerald-400 bg-emerald-50" : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/30"
                    }`}
                  >
                    <FileUp className={`w-8 h-8 mb-2 ${bulkUploadFile ? "text-emerald-500" : "text-slate-400"}`} />
                    <span className="text-sm text-slate-600 px-4 text-center">
                      {bulkUploadFile ? bulkUploadFile.name : "Click to select Excel file (.xlsx)"}
                    </span>
                    <input type="file" accept=".xlsx,.xls" onChange={onBulkFileChange} className="hidden" />
                  </label>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsBulkUploadModalOpen(false)}
                    disabled={isBulkUploading}
                    className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkUpload}
                    disabled={!bulkUploadSellerId || !bulkUploadFile || isBulkUploading}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-2"
                  >
                    {isBulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{isBulkUploading ? "Uploading..." : "Start Bulk Upload"}</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-700">{bulkUploadResults.success || 0}</div>
                    <div className="text-sm text-emerald-600">Successful</div>
                  </div>
                  <div className="rounded-xl bg-rose-50 border border-rose-100 p-4 text-center">
                    <div className="text-2xl font-bold text-rose-700">{bulkUploadResults.failed || 0}</div>
                    <div className="text-sm text-rose-600">Failed</div>
                  </div>
                </div>

                {bulkUploadResults.errors?.length > 0 && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-700">
                      Errors
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                      {bulkUploadResults.errors.map((err, idx) => (
                        <div key={`${err.row}-${idx}`} className="px-4 py-2 text-sm text-slate-700">
                          <span className="font-medium">Row {err.row}:</span> {err.item ? `${err.item} - ` : ""}{err.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsBulkUploadModalOpen(false)
                      setBulkUploadFile(null)
                      setBulkUploadResults(null)
                    }}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
