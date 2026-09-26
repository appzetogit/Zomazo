import { useState, useMemo, useRef, useEffect, startTransition, useDeferredValue } from "react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { channelAvailability } from "@store/utils/channelStock"
import { useParams, Link, useNavigate } from "react-router-dom"
import { createPortal } from "react-dom"
import useIsDesktop, { useStorefrontLayout } from "@store/components/user/desktop/useIsDesktop"
import MobileListing from "@store/components/user/mobile/MobileListing"
import { DesktopProductListing } from "@store/components/user/desktop/ListingDesktop"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Star, Clock, Search, SlidersHorizontal, ChevronDown, Bookmark, BadgePercent, MapPin, ArrowDownUp, Timer, IndianRupee, UtensilsCrossed, ShieldCheck, X, Loader2, Grid2x2 } from "lucide-react"
import { Card, CardContent } from "@store/components/ui/card"
import { Button } from "@store/components/ui/button"
import { Input } from "@store/components/ui/input"
import {
  CategoryChipRowSkeleton,
  LoadingSkeletonRegion,
  SellerGridSkeleton,
} from "@store/components/ui/loading-skeletons"

// Import shared food images - prevents duplication
import { productImages } from "@store/constants/images"
import api from "@store/api"
import { sellerAPI, adminAPI } from "@store/api"
import { API_BASE_URL } from "@store/api/config"
import { useProfile } from "@store/context/ProfileContext"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { useDelayedLoading } from "@store/hooks/useDelayedLoading"
import { getSellerAvailabilityStatus } from "@store/utils/sellerAvailability"

const debugError = (...args) => {}

// Filter options
const filterOptions = [
  { id: 'under-30-mins', label: 'Under 30 mins' },
  { id: 'price-match', label: 'Price Match', hasIcon: true },
  { id: 'flat-50-off', label: 'Flat 50% OFF', hasIcon: true },
  { id: 'rating-4-plus', label: 'Rating 4.0+' },
]

// Mock data removed - using backend data only

const CATEGORY_PAGE_FILTERS_STORAGE_KEY = "store-category-page-filters-v1"



export default function CategoryPage() {
  const { isQuick, fulfilmentMode, storePath } = useStoreMode()
  const { category } = useParams()
  const isDesktop = useStorefrontLayout()
  const onWideScreen = useIsDesktop()
  const navigate = useNavigate()
  const { vegMode } = useProfile()
  const { effectiveLocation: location, zoneId, isOutOfService } = useDeliveryLocation()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState(category?.toLowerCase() || 'all')
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [favorites, setFavorites] = useState(new Set())
  const [sortBy, setSortBy] = useState(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [activeFilterTab, setActiveFilterTab] = useState('sort')
  const [activeScrollSection, setActiveScrollSection] = useState('sort')
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false)
  const filterSectionRefs = useRef({})
  const rightContentRef = useRef(null)
  const categoryScrollRef = useRef(null)
  const hasRestoredCategoryFiltersRef = useRef(false)

  // State for categories from admin
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)

  const [sellersData, setSellersData] = useState([])
  const [loadingSellers, setLoadingSellers] = useState(true)
  const [loadingCategoryProducts, setLoadingCategoryProducts] = useState(false)
  const [categoryProductsData, setCategoryProductsData] = useState([])
  const [categoryKeywords, setCategoryKeywords] = useState({})
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())

  useEffect(() => {
    const tickAvailability = () => {
      if (typeof document !== "undefined" && document.hidden) return
      setAvailabilityTick(Date.now());
    }

    const intervalId = setInterval(tickAvailability, 60000);
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setAvailabilityTick(Date.now());
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, []);

  const showCategorySkeleton = useDelayedLoading(loadingCategories)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const BACKEND_ORIGIN = useMemo(() => API_BASE_URL.replace(/\/api\/?$/, ""), [])
  const slugify = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const normalizeCategoryToken = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  const matchesCategoryText = (value, keywords) => {
    const normalizedValue = normalizeCategoryToken(value)
    if (!normalizedValue) return false

    return keywords.some((keyword) => {
      const normalizedKeyword = normalizeCategoryToken(keyword)
      if (!normalizedKeyword) return false
      return (
        normalizedValue === normalizedKeyword ||
        normalizedValue.includes(normalizedKeyword) ||
        slugify(normalizedValue) === slugify(normalizedKeyword)
      )
    })
  }
  const uniqueBySeller = (list) => {
    const seen = new Set()
    return list.filter((row) => {
      // Use distinct keys for dishes vs sellers to prevent collisions
      const key = row.dishId ? `dish-${row.dishId}` : (row.sellerId || row.id || `raw-${slugify(row.name)}`)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  useEffect(() => {
    let cancelled = false
    const categorySlug = String(selectedCategory || category || "all").toLowerCase()

    // The quick store needs a delivery zone; the shop ships anywhere.
    if ((isQuick && !zoneId) || categorySlug === "all") {
      setCategoryProductsData([])
      setLoadingCategoryProducts(false)
      return () => {
        cancelled = true
      }
    }

    setLoadingCategoryProducts(true)
    void (async () => {
      try {
        const response = await sellerAPI.getPublicProducts({
          zoneId: isQuick ? zoneId : undefined,
          fulfilmentMode,
          categorySlug,
          limit: 1000,
        })
        const products = response?.data?.data?.products || []
        if (!cancelled) {
          setCategoryProductsData(Array.isArray(products) ? products : [])
        }
      } catch {
        if (!cancelled) setCategoryProductsData([])
      } finally {
        if (!cancelled) setLoadingCategoryProducts(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [zoneId, selectedCategory, category, isQuick, fulfilmentMode])

  const getCategoryFallbackDishesFromApprovedProducts = (categoryId, sellers, products = categoryProductsData) => {
    const keywords = getCategoryKeywords(categoryId)
    if (keywords.length === 0 || !Array.isArray(products) || products.length === 0) {
      return []
    }

    const sellersById = new Map()
    const sellersByName = new Map()
      ; (Array.isArray(sellers) ? sellers : []).forEach((seller) => {
        const idCandidates = [
          seller?.sellerId,
          seller?.id,
          seller?.mongoId,
        ]
          .filter(Boolean)
          .map((value) => String(value).trim())

        idCandidates.forEach((value) => {
          if (!sellersById.has(value)) {
            sellersById.set(value, seller)
          }
        })

        const normalizedName = String(seller?.name || "").trim().toLowerCase()
        if (normalizedName && !sellersByName.has(normalizedName)) {
          sellersByName.set(normalizedName, seller)
        }
      })

    return products
      .filter((food) => {
        if (!channelAvailability(food, isQuick ? "quick" : "shop").inStock) return false
        if (String(food?.approvalStatus || "").toLowerCase() !== "approved") return false

        const categoryName = String(food?.categoryName || food?.category || "").toLowerCase()
        const productName = String(food?.name || "").toLowerCase()
        return (
          matchesCategoryText(categoryName, keywords) ||
          matchesCategoryText(productName, keywords)
        )
      })
      .map((food, index) => {
        const sellerId = String(food?.sellerId || "").trim()
        const sellerName = String(food?.sellerName || "").trim()
        const matchedSeller =
          sellersById.get(sellerId) ||
          sellersByName.get(sellerName.toLowerCase()) ||
          null

        const fallbackSellerName = sellerName || "Seller"
        const fallbackSlug = slugify(fallbackSellerName)
        const fallbackImage = normalizeImageUrl(food?.image)

        return {
          ...(matchedSeller || {}),
          id: `${sellerId || fallbackSlug || "seller"}-${String(food?.id || food?._id || index)}`,
          sellerId: sellerId || matchedSeller?.sellerId || matchedSeller?.id || null,
          mongoId: matchedSeller?.mongoId || matchedSeller?.id || null,
          slug: matchedSeller?.slug || fallbackSlug,
          name: matchedSeller?.name || fallbackSellerName,
          image: matchedSeller?.image || fallbackImage,
          images: Array.isArray(matchedSeller?.images) && matchedSeller.images.length > 0
            ? matchedSeller.images
            : (fallbackImage ? [fallbackImage] : []),
          rating: matchedSeller?.rating || null,
          deliveryTime: matchedSeller?.deliveryTime || null,
          distance: matchedSeller?.distance || null,
          offer: matchedSeller?.offer || null,
          featuredDish: matchedSeller?.featuredDish || food?.name || null,
          featuredPrice: matchedSeller?.featuredPrice || Number(food?.price || 0),
          menu: matchedSeller?.menu || null,
          dishId: String(food?.id || food?._id || `${sellerId}-${index}`),
          categoryDish: food,
          categoryDishName: food?.name || "Unnamed Item",
          categoryDishPrice: Number(food?.price || 0),
          categoryDishImage: fallbackImage,
          categoryDishFoodType: food?.foodType || null,
        }
      })
  }

  const normalizeImageUrl = (value) => {
    if (!value) return ""

    const raw =
      typeof value === "string"
        ? value
        : typeof value === "object"
          ? (value.url || value.secure_url || value.imageUrl || value.image || value.src || value.path || "")
          : ""

    if (typeof raw !== "string") return ""
    const trimmed = raw.trim()
    if (!trimmed) return ""
    if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed

    const appProtocol = typeof window !== "undefined" ? window.location?.protocol : ""
    const appHost = typeof window !== "undefined" ? window.location?.hostname : ""
    let normalized = trimmed
      .replace(/\\/g, "/")
      .replace(/^(https?):\/(?!\/)/i, "$1://")
      .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1")

    if (/^\/\//.test(normalized)) {
      normalized = `${appProtocol || "https:"}${normalized}`
    }

    const hasSignedParams = (url) =>
      /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(url)

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const parsed = new URL(normalized, window.location.origin)
        if (
          appHost &&
          appHost !== "localhost" &&
          appHost !== "127.0.0.1" &&
          /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
        ) {
          try {
            const backendUrl = new URL(BACKEND_ORIGIN)
            parsed.protocol = backendUrl.protocol
            parsed.hostname = backendUrl.hostname
            parsed.port = backendUrl.port
          } catch {
            parsed.protocol = window.location.protocol
            parsed.hostname = window.location.hostname
            if (window.location.port) parsed.port = window.location.port
          }
        }
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:"
        }
        const finalUrl = parsed.toString()
        return hasSignedParams(finalUrl) ? finalUrl : encodeURI(finalUrl)
      } catch {
        return normalized
      }
    }

    const absolutePath = normalized.startsWith("/")
      ? `${BACKEND_ORIGIN}${normalized}`
      : `${BACKEND_ORIGIN}/${normalized.replace(/^\.?\/*/, "")}`

    try {
      const parsed = new URL(absolutePath, window.location.origin)
      if (appProtocol === "https:" && parsed.protocol === "http:") {
        parsed.protocol = "https:"
      }
      const finalUrl = parsed.toString()
      return hasSignedParams(finalUrl) ? finalUrl : encodeURI(finalUrl)
    } catch {
      return absolutePath
    }
  }

  const currentFilterStorageKey = useMemo(
    () => slugify(selectedCategory || category || "all") || "all",
    [selectedCategory, category]
  )

  const parseFirstNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const match = String(value || "").match(/(\d+(?:\.\d+)?)/)
    return match ? Number(match[1]) : null
  }

  const getComparableDeliveryTime = (row) => parseFirstNumber(row?.deliveryTime)

  const getComparableDistance = (row) => {
    const raw = String(row?.distance || "").trim().toLowerCase()
    if (!raw) return null

    const parsed = parseFirstNumber(raw)
    if (parsed == null) return null
    if (raw.includes("m") && !raw.includes("km")) {
      return parsed / 1000
    }
    return parsed
  }

  const getComparablePrice = (row) => {
    const raw = row?.categoryDishPrice ?? row?.featuredPrice ?? null
    const parsed = typeof raw === "number" ? raw : parseFirstNumber(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  const getComparableRating = (row) => {
    const parsed = typeof row?.rating === "number" ? row.rating : parseFirstNumber(row?.rating)
    return Number.isFinite(parsed) ? parsed : null
  }

  const matchesOfferText = (value, pattern) => pattern.test(String(value || ""))

  const applyFiltersAndSorting = (rows) => {
    let nextRows = Array.isArray(rows) ? [...rows] : []

    if (activeFilters.has('under-30-mins')) {
      nextRows = nextRows.filter((row) => {
        const time = getComparableDeliveryTime(row)
        return time != null && time <= 30
      })
    }

    if (activeFilters.has('delivery-under-45')) {
      nextRows = nextRows.filter((row) => {
        const time = getComparableDeliveryTime(row)
        return time != null && time <= 45
      })
    }

    if (activeFilters.has('rating-35-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 3.5
      })
    }

    if (activeFilters.has('rating-4-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 4.0
      })
    }

    if (activeFilters.has('rating-45-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 4.5
      })
    }

    if (activeFilters.has('distance-under-1km')) {
      nextRows = nextRows.filter((row) => {
        const distance = getComparableDistance(row)
        return distance != null && distance <= 1
      })
    }

    if (activeFilters.has('distance-under-2km')) {
      nextRows = nextRows.filter((row) => {
        const distance = getComparableDistance(row)
        return distance != null && distance <= 2
      })
    }

    if (activeFilters.has('price-under-200')) {
      nextRows = nextRows.filter((row) => {
        const price = getComparablePrice(row)
        return price != null && price <= 200
      })
    }


    if (activeFilters.has('price-under-500')) {
      nextRows = nextRows.filter((row) => {
        const price = getComparablePrice(row)
        return price != null && price <= 500
      })
    }

    if (activeFilters.has('flat-50-off')) {
      nextRows = nextRows.filter((row) => matchesOfferText(row?.offer, /50\s*%/i))
    }

    if (activeFilters.has('price-match')) {
      nextRows = nextRows.filter((row) =>
        matchesOfferText(row?.offer, /price\s*match/i) ||
        matchesOfferText(row?.priceRange, /price\s*match/i) ||
        matchesOfferText(row?.categoryDish?.description, /price\s*match/i)
      )
    }

    if (deferredSearchQuery.trim()) {
      const query = deferredSearchQuery.toLowerCase()
      nextRows = nextRows.filter((row) =>
        row.name?.toLowerCase().includes(query) ||
        row.featuredDish?.toLowerCase().includes(query) ||
        row.categoryDishName?.toLowerCase().includes(query)
      )
    }

    if (sortBy) {
      nextRows.sort((left, right) => {
        if (sortBy === 'price-low' || sortBy === 'price-high') {
          const leftPrice = getComparablePrice(left)
          const rightPrice = getComparablePrice(right)
          if (leftPrice == null && rightPrice == null) return 0
          if (leftPrice == null) return 1
          if (rightPrice == null) return -1
          return sortBy === 'price-low' ? leftPrice - rightPrice : rightPrice - leftPrice
        }

        if (sortBy === 'rating-high' || sortBy === 'rating-low') {
          const leftRating = getComparableRating(left)
          const rightRating = getComparableRating(right)
          if (leftRating == null && rightRating == null) return 0
          if (leftRating == null) return 1
          if (rightRating == null) return -1
          return sortBy === 'rating-high' ? rightRating - leftRating : leftRating - rightRating
        }

        return 0
      })
    }

    return uniqueBySeller(nextRows)
  }

  // Fetch categories from admin API
  useEffect(() => {
    let isCancelled = false;

    const fetchCategories = async () => {
      try {
        setLoadingCategories(true)
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {})

        if (isCancelled) return;

        if (response.data && response.data.success && response.data.data && response.data.data.categories) {
          const categoriesArray = response.data.data.categories

          // Transform API categories to match expected format
          const transformedCategories = [
            { id: 'all', name: "All", image: null, slug: 'all' },
            ...categoriesArray.map((cat) => ({
              id: cat.slug || cat.id,
              name: cat.name,
              image: cat.image || productImages[0],
              slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'),
              type: cat.type,
            }))
          ]

          setCategories(transformedCategories)

          // Generate category keywords dynamically from category names
          const keywordsMap = {}
          categoriesArray.forEach((cat) => {
            const categoryId = cat.slug || cat.id
            const categoryName = cat.name.toLowerCase()

            // Generate keywords from category name
            const words = categoryName.split(/[\s-]+/).filter(w => w.length > 0)
            keywordsMap[categoryId] = [categoryName, ...words]
          })

          setCategoryKeywords(keywordsMap)
        } else {
          // Keep default "All" category on error
          setCategories([{ id: 'all', name: "All", image: null, slug: 'all' }])
        }
      } catch (error) {
        if (isCancelled) return;
        debugError('Error fetching categories:', error)
        // Keep default "All" category on error
        setCategories([{ id: 'all', name: "All", image: null, slug: 'all' }])
      } finally {
        if (!isCancelled) setLoadingCategories(false)
      }
    }

    fetchCategories()

    return () => {
      isCancelled = true;
    }
  }, [zoneId])

  // Helper function to check if menu has dishes matching category keywords
  const getCategoryKeywords = (categoryId) => {
    const raw = String(categoryId || "").trim().toLowerCase()
    const fromAdmin = categoryKeywords[raw]
    let keywords = []
    if (Array.isArray(fromAdmin) && fromAdmin.length > 0) {
      keywords = [...fromAdmin]
    } else {
      // Fallback: derive keywords from the slug in URL (e.g. "samosha" -> ["samosha"])
      // This prevents "no data" when admin categories don't include the slug.
      const parts = raw.split(/[\s-]+/).filter(Boolean)
      keywords = parts.length > 0 ? Array.from(new Set([raw, ...parts])) : []
    }

    // Add common variations/misspellings (e.g. "samosha" vs "samosa")
    if (keywords.includes('samosha') || keywords.includes('samosa')) {
      if (!keywords.includes('samosa')) keywords.push('samosa')
      if (!keywords.includes('samosha')) keywords.push('samosha')
    }

    return keywords
  }

  // Fetch sellers from API
  useEffect(() => {
    const fetchSellers = async () => {
      try {
        setLoadingSellers(true)
        // Strict zone check: if no zoneId, don't fetch/show anything
        if (!zoneId) {
          setSellersData([])
          setLoadingSellers(false)
          return
        }
        
        const params = { zoneId }
        const response = await sellerAPI.getSellers(params)

        if (response.data && response.data.success && response.data.data && response.data.data.sellers) {
          const sellersArray = response.data.data.sellers

          // Helper function to check if value is a default/mock value
          const isDefaultValue = (value, fieldName) => {
            if (!value) return false

            const defaultOffers = [
              "Flat ₹50 OFF above ₹199",
              "Flat 50% OFF",
              "Flat ₹40 OFF above ₹149"
            ]
            const defaultDeliveryTimes = ["25-30 mins", "20-25 mins", "30-35 mins"]
            const defaultDistances = ["1.2 km", "1 km", "0.8 km"]
            const defaultFeaturedPrice = 249

            if (fieldName === 'offer' && defaultOffers.includes(value)) return true
            if (fieldName === 'deliveryTime' && defaultDeliveryTimes.includes(value)) return true
            if (fieldName === 'distance' && defaultDistances.includes(value)) return true
            if (fieldName === 'featuredPrice' && value === defaultFeaturedPrice) return true

            return false
          }

          // Transform sellers - filter out default values
          const sellersWithIds = sellersArray
            .filter((seller) => {
              const displayName = String(seller.sellerName || seller.name || "").trim()
              const hasName = displayName.length > 0
              return hasName
            })
            .map((seller) => {
              let deliveryTime = seller.estimatedDeliveryTime || null
              let distance = seller.distance || null
              let offer = seller.offer || null

              if (isDefaultValue(deliveryTime, 'deliveryTime')) deliveryTime = null
              if (isDefaultValue(distance, 'distance')) distance = null
              if (isDefaultValue(offer, 'offer')) offer = null

              const coverImages = seller.coverImages && seller.coverImages.length > 0
                ? seller.coverImages.map(img => normalizeImageUrl(img.url || img)).filter(Boolean)
                : []

              const fallbackImages = seller.menuImages && seller.menuImages.length > 0
                ? seller.menuImages.map(img => normalizeImageUrl(img.url || img)).filter(Boolean)
                : []

              const allImages = coverImages.length > 0
                ? coverImages
                : (fallbackImages.length > 0
                  ? fallbackImages
                  : (seller.profileImage?.url ? [normalizeImageUrl(seller.profileImage.url)] : []))

              const image = allImages[0] || normalizeImageUrl(seller.coverImage || seller.profileImage?.url || seller.profileImage) || ""

              return {
                id: seller._id || seller.id,
                sellerId: seller.sellerId || seller.id,
                mongoId: seller._id || seller.id,
                slug: seller.slug || slugify(seller.sellerName || seller.name || ""),
                name: seller.sellerName || seller.name || "Unknown Seller",
                image: image,
                images: allImages,
                rating: Number(seller.rating || seller.avgRating || 0) || 4.5,
                deliveryTime: deliveryTime || (seller.estimatedDeliveryTimeMinutes ? `${seller.estimatedDeliveryTimeMinutes} mins` : "25-30 mins"),
                distance: distance || (seller.distance ? (typeof seller.distance === 'number' ? `${seller.distance.toFixed(1)} km` : seller.distance) : "1.2 km"),
                priceRange: seller.priceRange || "$$",
                offer: offer || "Flat 50% OFF",
                featuredDish: seller.featuredDish || "Special Item",
                featuredPrice: Number(seller.featuredPrice || 249),
                // Critical timing fields for availability utility
                isActive: seller.isActive,
                isAcceptingOrders: seller.isAcceptingOrders,
                outletTimings: seller.outletTimings,
                openDays: seller.openDays,
                deliveryTimings: seller.deliveryTimings,
                openingTime: seller.openingTime,
                closingTime: seller.closingTime,
                // Zone info for strict frontend filtering
                zoneId: seller.zoneId || seller.zone?._id || seller.zone || null,
              }
            })

          startTransition(() => {
            setSellersData(sellersWithIds)
          })
        } else {
          setSellersData([])
        }
      } catch (error) {
        console.error("Error fetching sellers:", error)
        setSellersData([])
      } finally {
        setLoadingSellers(false)
      }
    }

    fetchSellers()
  }, [zoneId, isOutOfService])

  // Update selected category when URL changes
  useEffect(() => {
    if (category && categories && categories.length > 0) {
      const categorySlug = category.toLowerCase()
      const matchedCategory = categories.find(cat =>
        cat.slug === categorySlug ||
        cat.id === categorySlug ||
        cat.name.toLowerCase().replace(/\s+/g, '-') === categorySlug
      )
      if (matchedCategory) {
        setSelectedCategory(matchedCategory.slug || matchedCategory.id)
      } else {
        setSelectedCategory(categorySlug)
      }
    } else if (category) {
      setSelectedCategory(category.toLowerCase())
    }
  }, [category, categories])

  useEffect(() => {
    if (typeof window === "undefined" || !currentFilterStorageKey) return

    hasRestoredCategoryFiltersRef.current = false

    try {
      const raw = window.localStorage.getItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY)
      if (!raw) return

      const stored = JSON.parse(raw)
      const categoryState = stored?.[currentFilterStorageKey]
      if (!categoryState || typeof categoryState !== "object") return

      setSortBy(categoryState.sortBy || null)
      setActiveFilters(new Set(Array.isArray(categoryState.activeFilters) ? categoryState.activeFilters : []))
    } catch {
      setSortBy(null)
      setActiveFilters(new Set())
    } finally {
      hasRestoredCategoryFiltersRef.current = true
    }
  }, [currentFilterStorageKey])

  useEffect(() => {
    if (typeof window === "undefined" || !currentFilterStorageKey) return
    if (!hasRestoredCategoryFiltersRef.current) return

    try {
      const raw = window.localStorage.getItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY)
      const stored = raw ? JSON.parse(raw) : {}
      stored[currentFilterStorageKey] = {
        sortBy,
        activeFilters: Array.from(activeFilters),
      }
      window.localStorage.setItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Ignore storage failures and keep in-memory filters working.
    }
  }, [currentFilterStorageKey, sortBy, activeFilters])

  useEffect(() => {
    const rail = categoryScrollRef.current
    if (!rail) return

    const selectedButton = rail.querySelector("[data-category-selected='true']")
    if (!selectedButton || typeof selectedButton.scrollIntoView !== "function") return

    selectedButton.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    })
  }, [selectedCategory, categories])

  const toggleFilter = (filterId) => {
    setActiveFilters(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filterId)) {
        newSet.delete(filterId)
      } else {
        newSet.add(filterId)
      }
      return newSet
    })
    // Show loading when filter is toggled
    setIsLoadingFilterResults(true)
    setTimeout(() => {
      setIsLoadingFilterResults(false)
    }, 500)
  }

  // Scroll tracking effect for filter modal
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: '-20% 0px -70% 0px',
      threshold: 0
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute('data-section-id')
          if (sectionId) {
            setActiveScrollSection(sectionId)
            setActiveFilterTab(sectionId)
          }
        }
      })
    }, observerOptions)

    Object.values(filterSectionRefs.current).forEach(ref => {
      if (ref) observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [isFilterOpen])

  const toggleFavorite = (id) => {
    setFavorites(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  // Filter sellers based on active filters and selected category
  // If category is selected, expand sellers into dish cards (one card per matching dish)
  const filteredRecommended = useMemo(() => {
    const sourceData = sellersData.length > 0 ? sellersData : []
    let filtered = [...sourceData]

    // Filter by category — expand sellers into dish cards from public products API
    if (selectedCategory && selectedCategory !== 'all') {
      const categoryDishes = getCategoryFallbackDishesFromApprovedProducts(selectedCategory, sourceData)
      filtered = vegMode
        ? categoryDishes.filter((dish) => dish.categoryDishFoodType === "Veg")
        : categoryDishes
    }

    // Strict zone filter: double check that seller belongs to current zone
    filtered = filtered.filter(row => {
      const sellerZoneId = row.zoneId || null;
      if (zoneId && sellerZoneId && String(sellerZoneId) !== String(zoneId)) {
        return false;
      }
      return true;
    })

    // Filter by availability
    filtered = filtered.filter(row => {
      const availability = getSellerAvailabilityStatus(row, new Date(availabilityTick));
      return availability.isOpen;
    })

    return applyFiltersAndSorting(filtered)
  }, [selectedCategory, activeFilters, deferredSearchQuery, sellersData, categoryKeywords, vegMode, categoryProductsData, sortBy, availabilityTick, zoneId])

  const filteredAllSellers = useMemo(() => {
    const sourceData = sellersData.length > 0 ? sellersData : []
    let filtered = [...sourceData]

    // Filter by category — expand sellers into dish cards from public products API
    if (selectedCategory && selectedCategory !== 'all') {
      const categoryDishes = getCategoryFallbackDishesFromApprovedProducts(selectedCategory, sourceData)
      filtered = vegMode
        ? categoryDishes.filter((dish) => dish.categoryDishFoodType === "Veg")
        : categoryDishes
    }

    // Strict zone filter: double check that seller belongs to current zone
    filtered = filtered.filter(row => {
      const sellerZoneId = row.zoneId || null;
      if (zoneId && sellerZoneId && String(sellerZoneId) !== String(zoneId)) {
        return false;
      }
      return true;
    })

    // Filter by availability
    filtered = filtered.filter(row => {
      const availability = getSellerAvailabilityStatus(row, new Date(availabilityTick));
      return availability.isOpen;
    })

    return applyFiltersAndSorting(filtered)
  }, [selectedCategory, activeFilters, deferredSearchQuery, sellersData, categoryKeywords, vegMode, categoryProductsData, sortBy, availabilityTick, zoneId])

  const showSellerSkeleton = useDelayedLoading(
    isLoadingFilterResults || loadingSellers || (loadingCategoryProducts && selectedCategory !== 'all' && filteredRecommended.length === 0),
    { delay: 140, minDuration: 360 }
  )

  const handleCategorySelect = (category) => {
    const categorySlug = category.slug || category.id
    setSelectedCategory(categorySlug)
    // Update URL to reflect category change
    if (categorySlug === 'all') {
      navigate('/user/category/all')
    } else {
      navigate(storePath(`/category/${categorySlug}`))
    }
  }

  // Check if should show grayscale (user out of service)
  const shouldShowGrayscale = isOutOfService
  const isCategoryView = selectedCategory && selectedCategory !== 'all'

  // Desktop (lg+): filter rail, results bar and product grid; mobile below is unchanged.
  if (isDesktop) {
    // Phones: the listing from the mobile mockup (screen 2).
    if (!onWideScreen) return <MobileListing categorySlug={String(category || "all").toLowerCase()} />
    return (
      <DesktopProductListing
        categorySlug={String(category || "all").toLowerCase()}
        onSelectCategory={(cat) => navigate(storePath(`/category/${cat ? cat.slug : "all"}`))}
        zoneId={isQuick ? zoneId : undefined}
      />
    )
  }

  return (
    <div className={`min-h-screen bg-white dark:bg-[#0a0a0a] ${shouldShowGrayscale ? 'grayscale opacity-75' : ''}`}>
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur supports-[backdrop-filter]:bg-white/90 shadow-sm">
        <div className="max-w-7xl mx-auto">
          {/* Search Bar with Back Button */}
          <div className="flex items-center gap-2 px-3 md:px-6 py-3 border-b border-gray-100 dark:border-gray-800">
            <button
              onClick={() => navigate('/user')}
              className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </button>

            <div className="flex-1 relative max-w-2xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search products or stores..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 h-11 md:h-12 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1a1a1a] focus:bg-white dark:focus:bg-[#2a2a2a] focus:border-gray-500 dark:focus:border-gray-600 text-sm md:text-base dark:text-white placeholder:text-gray-600 dark:placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Browse Category Section */}
          <div
            ref={categoryScrollRef}
            className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-4 md:px-6 py-3 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {showCategorySkeleton ? (
              <CategoryChipRowSkeleton className="py-3" />
            ) : (
              categories && categories.length > 0 ? categories.map((cat) => {
                const categorySlug = cat.slug || cat.id
                const isSelected = selectedCategory === categorySlug || selectedCategory === cat.id
                const isAllCategory = categorySlug === "all" || cat.id === "all"
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategorySelect(cat)}
                    data-category-selected={isSelected ? "true" : "false"}
                    className={`flex flex-col items-center gap-1.5 flex-shrink-0 pb-2 transition-all ${isSelected ? 'border-b-2 border-wh-brand' : ''
                      }`}
                  >
                    {isAllCategory ? (
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full border-2 transition-all flex items-center justify-center ${isSelected ? 'border-wh-brand shadow-lg bg-[#FFF2EB] dark:bg-wh-brand/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#222222]'}`}>
                        <Grid2x2 className={`h-6 w-6 md:h-7 md:w-7 ${isSelected ? 'text-wh-brand-ink' : 'text-gray-500 dark:text-gray-400'}`} />
                      </div>
                    ) : cat.image ? (
                      <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-2 transition-all ${isSelected ? 'border-wh-brand shadow-lg' : 'border-transparent'
                        }`}>
                        <img
                          src={cat.image}
                          alt={cat.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // If the backend image is missing/broken, show initials instead of fake assets.
                            e.target.style.display = 'none'
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className={`w-16 h-16 md:w-20 md:h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center border-2 transition-all ${isSelected ? 'border-wh-brand shadow-lg bg-[#FFF2EB] dark:bg-wh-brand/20' : 'border-transparent'
                          }`}
                        aria-label={`${cat.name} category`}
                      >
                        <span className="text-sm md:text-base font-semibold text-gray-600 dark:text-gray-300">
                          {String(cat.name || "?").trim().slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <span className={`text-xs md:text-sm font-medium whitespace-nowrap ${isSelected ? 'text-wh-brand-ink dark:text-wh-brand' : 'text-gray-600 dark:text-gray-400'
                      }`}>
                      {cat.name}
                    </span>
                  </button>
                )
              }) : (
                <div className="flex items-center justify-center py-4">
                  <span className="text-sm text-gray-600 dark:text-gray-400">No categories available</span>
                </div>
              )
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row md:flex-wrap gap-2 px-4 md:px-6 py-3">
            {/* Row 1 */}
            <div
              className="flex items-center gap-2 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-1 md:pb-0"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              <Button
                variant="outline"
                onClick={() => setIsFilterOpen(true)}
                className="h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 md:h-4 md:w-4" />
                <span className="text-xs md:text-sm font-bold text-black dark:text-white">Filters</span>
              </Button>
              {[
                { id: 'under-30-mins', label: 'Under 30 mins' },
                { id: 'delivery-under-45', label: 'Under 45 mins' },
                { id: 'rating-4-plus', label: 'Rating 4.0+' },
                { id: 'rating-45-plus', label: 'Rating 4.5+' },
              ].map((filter) => {
                const isActive = activeFilters.has(filter.id)
                return (
                  <Button
                    key={filter.id}
                    variant="outline"
                    onClick={() => toggleFilter(filter.id)}
                    className={`h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${isActive
                      ? 'bg-wh-brand text-wh-text border border-wh-brand hover:bg-wh-brand-600'
                      : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    <span className={`text-xs md:text-sm text-black dark:text-white font-bold ${isActive ? 'text-white' : 'text-black dark:text-white'}`}>{filter.label}</span>
                  </Button>
                )
              })}
            </div>

            {/* Row 2 */}
            <div
              className="flex items-center gap-2 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-1 md:pb-0"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {[
                { id: 'distance-under-1km', label: 'Under 1km', icon: MapPin },
                { id: 'distance-under-2km', label: 'Under 2km', icon: MapPin },
                { id: 'flat-50-off', label: 'Flat 50% OFF' },
                            ].map((filter) => {
                const Icon = filter.icon
                const isActive = activeFilters.has(filter.id)
                return (
                  <Button
                    key={filter.id}
                    variant="outline"
                    onClick={() => toggleFilter(filter.id)}
                    className={`h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${isActive
                      ? 'bg-wh-brand text-wh-text border border-wh-brand hover:bg-wh-brand-600'
                      : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    {Icon && <Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${isActive ? 'text-white' : 'text-gray-900 dark:text-white'}`} />}
                    <span className={`text-xs md:text-sm font-bold ${isActive ? 'text-white' : 'text-black dark:text-white'}`}>{filter.label}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 space-y-6 md:space-y-8 lg:space-y-10">
        <div className="max-w-7xl mx-auto">
          {/* RECOMMENDED FOR YOU Section - Hide when "All" category is selected */}
          {filteredRecommended.length > 0 && selectedCategory !== 'all' && (
            <section>
              <h2 className="text-xs sm:text-sm md:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-4 md:mb-6">
                RECOMMENDED FOR YOU
              </h2>

              {/* Small Seller Cards - Grid - Show all dishes when category is selected */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
                {(isCategoryView
                  ? filteredRecommended
                  : filteredRecommended.slice(0, 6)
                ).map((seller) => {
                  return (
                    <Link
                      key={seller.id}
                      to={storePath(`/sellers/${seller.name.toLowerCase().replace(/\s+/g, '-')}`)}
                      className="block"
                    >
                      <div className={`group ${shouldShowGrayscale ? 'grayscale opacity-75' : ''}`}>
                        {/* Image Container */}
                        <div className="relative aspect-square rounded-xl md:rounded-2xl overflow-hidden mb-2">
                          {/* Use category dish image if available, otherwise seller image */}
                          {seller.categoryDishImage ? (
                            <img
                              src={seller.categoryDishImage}
                              alt={seller.categoryDishName || seller.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                // Fallback to seller image if dish image fails
                                if (seller.image) {
                                  e.target.src = seller.image
                                } else {
                                  // Show emoji placeholder
                                  e.target.style.display = 'none'
                                  const placeholder = document.createElement('div')
                                  placeholder.className = 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl'
                                  placeholder.textContent = '???'
                                  e.target.parentElement.appendChild(placeholder)
                                }
                              }}
                            />
                          ) : seller.image ? (
                            <img
                              src={seller.image}
                              alt={seller.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                // Show emoji placeholder
                                e.target.style.display = 'none'
                                const placeholder = document.createElement('div')
                                placeholder.className = 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl'
                                placeholder.textContent = '???'
                                e.target.parentElement.appendChild(placeholder)
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl">
                              ???
                            </div>
                          )}

                          {/* Offer Badge */}
                          {seller.offer && (
                            <div className="absolute top-1.5 left-1.5 bg-gradient-to-r from-wh-brand to-wh-brand-600 text-white text-[10px] md:text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm">
                              {seller.offer}
                            </div>
                          )}

                          {/* Rating Badge (NOW ON IMAGE, bottom-left with white border) */}
                          <div
                            className="absolute bottom-0 left-0 border-[4px] rounded-md border-white text-wh-text text-[11px] md:text-xs font-bold px-1.5 py-0.5 flex items-center gap-0.5"
                            style={{
                              backgroundColor: "var(--module-theme-color, #FD920B)",
                              boxShadow: "0 6px 14px rgba(var(--module-theme-rgb,253,146,11),0.35)",
                            }}
                          >
                            {seller.rating}
                            <Star className="h-2.5 w-2.5 md:h-3 md:w-3 fill-wh-text" />
                          </div>
                        </div>

                        <h3 className="font-semibold text-gray-900 dark:text-white text-xs md:text-sm line-clamp-1">
                          {isCategoryView ? (seller.categoryDishName || seller.featuredDish || seller.name) : seller.name}
                        </h3>
                        {isCategoryView && (
                          <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                            {seller.name}
                          </p>
                        )}
                        {seller.deliveryTime && (
                          <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-[10px] md:text-xs">
                            <Clock className="h-2.5 w-2.5 md:h-3 md:w-3" />
                            <span>{seller.deliveryTime}</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* ALL SELLERS Section */}
          <section className="relative">
            <h2 className="text-xs sm:text-sm md:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-4 md:mb-6">
              ALL SELLERS
            </h2>

            {/* Loading Overlay */}
            {showSellerSkeleton && (
              <div className="absolute inset-0 z-10 rounded-lg bg-white/92 backdrop-blur-sm dark:bg-[#1a1a1a]/92">
                <LoadingSkeletonRegion label="Loading sellers" className="h-full p-1 sm:p-2">
                  <SellerGridSkeleton count={4} compact />
                </LoadingSkeletonRegion>
              </div>
            )}

            {/* Large Seller Cards */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 lg:gap-6 xl:gap-7 items-stretch ${showSellerSkeleton ? 'opacity-50' : 'opacity-100'} transition-opacity duration-300`}>
              {filteredAllSellers.map((seller) => {
                const sellerSlug = seller.name.toLowerCase().replace(/\s+/g, "-")
                const isFavorite = favorites.has(seller.id)

                return (
                  <Link key={seller.id} to={storePath(`/sellers/${sellerSlug}`)} className="h-full flex">
                    <Card className={`overflow-hidden cursor-pointer gap-0 border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] shadow-md hover:shadow-xl transition-all duration-300 py-0 rounded-md h-full flex flex-col w-full ${shouldShowGrayscale ? 'grayscale opacity-75' : ''
                      }`}>
                      {/* Image Section */}
                      <div className="relative h-44 sm:h-52 md:h-60 lg:h-64 xl:h-72 w-full overflow-hidden rounded-t-md flex-shrink-0">
                        {/* Use category dish image if available, otherwise seller image */}
                        {seller.categoryDishImage ? (
                          <img
                            src={seller.categoryDishImage}
                            alt={seller.categoryDishName || seller.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            onError={(e) => {
                              // Fallback to seller image if dish image fails
                              if (seller.image) {
                                e.target.src = seller.image
                              } else {
                                // Show emoji placeholder
                                e.target.style.display = 'none'
                                const placeholder = document.createElement('div')
                                placeholder.className = 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl'
                                placeholder.textContent = '???'
                                e.target.parentElement.appendChild(placeholder)
                              }
                            }}
                          />
                        ) : seller.image ? (
                          <img
                            src={seller.image}
                            alt={seller.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            onError={(e) => {
                              // Show emoji placeholder
                              e.target.style.display = 'none'
                              const placeholder = document.createElement('div')
                              placeholder.className = 'w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl'
                              placeholder.textContent = '???'
                              e.target.parentElement.appendChild(placeholder)
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-6xl">
                            ???
                          </div>
                        )}

                        {/* Category Dish Badge - Top Left (shows category dish if available, otherwise featured dish) */}
                        {(isCategoryView ? seller.categoryDishPrice : (seller.categoryDishName || seller.featuredDish)) && (
                          <div className="absolute top-3 left-3">
                            <div className="bg-gray-800/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm md:text-base font-medium">
                              {isCategoryView
                                ? `₹${seller.categoryDishPrice || seller.featuredPrice || 0}`
                                : `${seller.categoryDishName || seller.featuredDish} • ₹${seller.categoryDishPrice || seller.featuredPrice}`}
                            </div>
                          </div>
                        )}

                        {/* Ad Badge */}
                        {seller.isAd && (
                          <div className="absolute top-3 right-14 bg-black/50 text-white text-[10px] md:text-xs px-2 py-0.5 rounded">
                            Ad
                          </div>
                        )}

                        {/* Bookmark Icon - Top Right */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-3 right-3 h-9 w-9 md:h-10 md:w-10 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-[#2a2a2a] transition-colors"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleFavorite(seller.id)
                          }}
                        >
                          <Bookmark className={`h-5 w-5 md:h-6 md:w-6 ${isFavorite ? "fill-gray-800 dark:fill-gray-200 text-gray-800 dark:text-gray-200" : "text-gray-600 dark:text-gray-400"}`} strokeWidth={2} />
                        </Button>
                      </div>

                      {/* Content Section */}
                      <CardContent className="p-3 sm:p-4 md:p-5 lg:p-6 gap-0 flex-1 flex flex-col">
                        {/* Seller Name & Rating */}
                        <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-md md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white line-clamp-1 lg:line-clamp-2">
                              {isCategoryView ? (seller.categoryDishName || seller.featuredDish || seller.name) : seller.name}
                            </h3>
                            {isCategoryView && (
                              <p className="mt-1 text-sm md:text-base text-gray-500 dark:text-gray-400 line-clamp-1">
                                {seller.name}
                              </p>
                            )}
                          </div>
                          <div
                            className="flex-shrink-0 text-wh-text px-2 md:px-3 lg:px-4 py-1 lg:py-1.5 rounded-lg flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--module-theme-color, #FD920B)",
                              boxShadow: "0 8px 16px rgba(var(--module-theme-rgb,253,146,11),0.28)",
                            }}
                          >
                            <span className="text-sm md:text-base lg:text-lg font-bold">{seller.rating}</span>
                            <Star className="h-3 w-3 md:h-4 md:w-4 lg:h-5 lg:w-5 fill-wh-text text-wh-text" />
                          </div>
                        </div>

                        {/* Delivery Time & Distance */}
                        {(seller.deliveryTime || seller.distance) && (
                          <div className="flex items-center gap-1 text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400 mb-2 lg:mb-3">
                            {seller.deliveryTime && (
                              <>
                                <Clock className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" strokeWidth={1.5} />
                                <span className="font-medium">{seller.deliveryTime}</span>
                              </>
                            )}
                            {seller.deliveryTime && seller.distance && <span className="mx-1">|</span>}
                            {seller.distance && (
                              <span className="font-medium">{seller.distance}</span>
                            )}
                          </div>
                        )}

                        {/* Offer Badge */}
                        {seller.offer && (
                          <div className="flex items-center gap-2 text-sm md:text-base lg:text-lg mt-auto">
                            <BadgePercent className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 text-wh-brand-ink" strokeWidth={2} />
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{seller.offer}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>

            {/* Empty State */}
            {filteredAllSellers.length === 0 && (
              <div className="text-center py-12 md:py-16">
                <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
                  {searchQuery
                    ? `No sellers found for "${searchQuery}"`
                    : "No sellers found with selected filters"}
                </p>
                <Button
                  variant="outline"
                  className="mt-4 md:mt-6"
                  onClick={() => {
                    setIsLoadingFilterResults(true)
                    setActiveFilters(new Set())
                    setSearchQuery("")
                    setSortBy(null)
                    setTimeout(() => setIsLoadingFilterResults(false), 500)
                  }}
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isFilterOpen && (
              <div className="fixed inset-0 z-[100]">
                {/* Backdrop */}
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setIsFilterOpen(false)}
                />

                {/* Modal Content */}
                <div className="absolute bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-4xl bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl max-h-[85vh] md:max-h-[90vh] flex flex-col animate-[slideUp_0.3s_ease-out]">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Filters and sorting</h2>
                    <button
                      onClick={() => {
                        setIsLoadingFilterResults(true)
                        setActiveFilters(new Set())
                        setSortBy(null)
                        setTimeout(() => setIsLoadingFilterResults(false), 500)
                      }}
                      className="text-wh-brand-ink font-medium text-sm md:text-base hover:underline"
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 overflow-hidden">
                    {/* Left Sidebar - Tabs */}
                    <div className="w-24 sm:w-28 md:w-32 bg-gray-50 dark:bg-[#0a0a0a] border-r border-gray-200 dark:border-gray-800 flex flex-col">
                      {[
                        { id: 'sort', label: 'Sort By', icon: ArrowDownUp },
                        { id: 'time', label: 'Time', icon: Timer },
                        { id: 'rating', label: 'Rating', icon: Star },
                        { id: 'distance', label: 'Distance', icon: MapPin },
                        { id: 'price', label: 'Dish Price', icon: IndianRupee },
                        { id: 'offers', label: 'Offers', icon: BadgePercent },
                        { id: 'trust', label: 'Trust', icon: ShieldCheck },
                      ].map((tab) => {
                        const Icon = tab.icon
                        const isActive = activeScrollSection === tab.id || activeFilterTab === tab.id
                        return (
                          <button
                            key={tab.id}
                            onClick={() => {
                              setActiveFilterTab(tab.id)
                              const section = filterSectionRefs.current[tab.id]
                              if (section) {
                                section.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }
                            }}
                            className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive ? 'bg-white dark:bg-[#1a1a1a] text-wh-brand-ink' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                              }`}
                          >
                            {isActive && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-wh-brand rounded-r" />
                            )}
                            <Icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.5} />
                            <span className="text-xs md:text-sm font-medium leading-tight">{tab.label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Right Content Area - Scrollable */}
                    <div ref={rightContentRef} className="flex-1 overflow-y-auto p-4 md:p-6">
                      {/* Sort By Tab */}
                      <div
                        ref={el => filterSectionRefs.current['sort'] = el}
                        data-section-id="sort"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Sort by</h3>
                        <div className="flex flex-col gap-3">
                          {[
                            { id: null, label: 'Relevance' },
                            { id: 'price-low', label: 'Price: Low to High' },
                            { id: 'price-high', label: 'Price: High to Low' },
                            { id: 'rating-high', label: 'Rating: High to Low' },
                            { id: 'rating-low', label: 'Rating: Low to High' },
                          ].map((option) => (
                            <button
                              key={option.id || 'relevance'}
                              onClick={() => setSortBy(option.id)}
                              className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${sortBy === option.id
                                ? 'border-wh-brand bg-[#FFF2EB] dark:bg-wh-brand/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-wh-brand'
                                }`}
                            >
                              <span className={`text-sm md:text-base font-medium ${sortBy === option.id ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                {option.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Time Tab */}
                      <div
                        ref={el => filterSectionRefs.current['time'] = el}
                        data-section-id="time"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Estimated Time</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('under-30-mins')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('under-30-mins')
                              ? 'border-wh-brand bg-[#FFF2EB] dark:bg-wh-brand/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-wh-brand'
                              }`}
                          >
                            <Timer className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('under-30-mins') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('under-30-mins') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under 30 mins</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('delivery-under-45')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('delivery-under-45')
                              ? 'border-wh-brand bg-[#FFF2EB] dark:bg-wh-brand/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-wh-brand'
                              }`}
                          >
                            <Timer className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('delivery-under-45') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('delivery-under-45') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under 45 mins</span>
                          </button>
                        </div>
                      </div>

                      {/* Rating Tab */}
                      <div
                        ref={el => filterSectionRefs.current['rating'] = el}
                        data-section-id="rating"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Seller Rating</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('rating-35-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-35-plus')
                              ? 'border-wh-brand bg-[#FFF2EB] dark:bg-wh-brand/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-wh-brand'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-35-plus') ? 'text-wh-brand-ink fill-wh-brand' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-35-plus') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Rated 3.5+</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('rating-4-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-4-plus')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-4-plus') ? 'text-wh-brand-ink fill-wh-brand' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-4-plus') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.0+</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('rating-45-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-45-plus')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-45-plus') ? 'text-wh-brand-ink fill-wh-brand' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-45-plus') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.5+</span>
                          </button>
                        </div>
                      </div>

                      {/* Distance Tab */}
                      <div
                        ref={el => filterSectionRefs.current['distance'] = el}
                        data-section-id="distance"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Distance</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('distance-under-1km')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('distance-under-1km')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <MapPin className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('distance-under-1km') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('distance-under-1km') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under 1 km</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('distance-under-2km')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('distance-under-2km')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <MapPin className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('distance-under-2km') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('distance-under-2km') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under 2 km</span>
                          </button>
                        </div>
                      </div>

                      {/* Price Tab */}
                      <div
                        ref={el => filterSectionRefs.current['price'] = el}
                        data-section-id="price"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Price</h3>
                        <div className="flex flex-col gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('price-under-200')}
                            className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-200')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-under-200') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹200</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('price-under-500')}
                            className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-500')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-under-500') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹500</span>
                          </button>
                        </div>
                      </div>

                      {/* Offers Tab */}
                      <div
                        ref={el => filterSectionRefs.current['offers'] = el}
                        data-section-id="offers"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Offers</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('flat-50-off')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('flat-50-off')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <BadgePercent className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('flat-50-off') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('flat-50-off') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Flat 50% OFF</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('price-match')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('price-match')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <BadgePercent className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('price-match') ? 'text-wh-brand-ink' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-match') ? 'text-wh-brand-ink' : 'text-gray-700 dark:text-gray-300'}`}>Price Match</span>
                          </button>
                        </div>
                      </div>

                      {/* Trust Markers Tab */}
                      {activeFilterTab === 'trust' && (
                        <div className="space-y-4">
                          <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">Trust Markers</h3>
                          <div className="flex flex-col gap-3 md:gap-4">
                            <button className="px-4 md:px-5 py-3 md:py-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-wh-brand text-left transition-colors">
                              <span className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">Top Rated</span>
                            </button>
                            <button className="px-4 md:px-5 py-3 md:py-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-wh-brand text-left transition-colors">
                              <span className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">Trusted by 1000+ users</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center gap-4 px-4 md:px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="flex-1 py-3 md:py-4 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm md:text-base"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setIsLoadingFilterResults(true)
                        setIsFilterOpen(false)
                        // Simulate loading for 500ms
                        setTimeout(() => {
                          setIsLoadingFilterResults(false)
                        }, 500)
                      }}
                      className={`flex-1 py-3 md:py-4 font-semibold rounded-xl transition-colors text-sm md:text-base ${activeFilters.size > 0 || sortBy
                        ? 'bg-wh-brand text-wh-text hover:bg-wh-brand-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}
                    >
                      {activeFilters.size > 0 || sortBy
                        ? 'Show results'
                        : 'Show results'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      <style>{`
        @keyframes slideUp {
          0% {
            transform: translateY(100%);
          }
          100% {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
