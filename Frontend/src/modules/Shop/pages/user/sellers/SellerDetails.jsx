import { useStoreMode } from "@store/context/StoreModeContext"
import { channelAvailability, stockLabel } from "@store/utils/channelStock"
import { useState, useEffect, useRef, Component, useMemo } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { sellerAPI, orderAPI } from "@store/api"
import { API_BASE_URL } from "@store/api/config"
import { toast } from "sonner"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { getUserSellerDistance, normalizeSellerLocation } from "@store/utils/geo"
import { fetchDrivingDistanceKm, formatDistanceLabel } from "@store/utils/roadDistance"
import {
  ArrowLeft,
  Search,
  MoreVertical,
  MapPin,
  Clock,
  Tag,
  ChevronDown,
  Star,
  SlidersHorizontal,
  Utensils,
  Flame,
  Bookmark,
  Share2,
  Plus,
  Minus,
  X,
  RotateCcw,
  Zap,
  Check,
  Lock,
  Percent,
  Eye,
  Users,
  AlertCircle,
  Copy,
  MessageCircle,
  Send,
  Mail,
} from "lucide-react"
import { Button } from "@store/components/ui/button"
import { Badge } from "@store/components/ui/badge"
import { Checkbox } from "@store/components/ui/checkbox"
import AnimatedPage from "@store/components/user/AnimatedPage"
import { useCart } from "@store/context/CartContext"
import { useProfile } from "@store/context/ProfileContext"
import AddToCartAnimation from "@store/components/user/AddToCartAnimation"
import VariantSelector from "@store/components/user/VariantSelector"
import ProductPriceDisplay from "@store/components/user/ProductPriceDisplay"
import { getCompanyNameAsync } from "@store/utils/businessSettings"
import { isModuleAuthenticated } from "@store/utils/auth"
import { getSellerAvailabilityStatus } from "@store/utils/sellerAvailability"
import useAppBackNavigation from "@store/hooks/useAppBackNavigation"
import {
  buildCartLineId,
  getDefaultProductVariant,
  getProductDiscountPercent,
  getProductDisplayOtherPrice,
  getProductDisplayPrice,
  getProductVariants,
  hasProductVariants,
} from "@store/utils/productVariants"
import fssaiLogo from "@store/assets/fssai.png"
import { SellerDetailSkeleton } from "@store/components/ui/loading-skeletons"
import { useStorefrontLayout } from "@store/components/user/desktop/useIsDesktop"
import StoreDesktop from "@store/components/user/desktop/StoreDesktop"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}



const PRODUCT_IMAGE_FALLBACK = "https://picsum.photos/seed/food-fallback/800/600"
const RUPEE_SYMBOL = "\u20B9"
const SELLER_DETAILS_FILTERS_STORAGE_KEY = "store-seller-details-filters"

const resolveSellerImageUrl = (image) => {
  if (!image) return null
  if (typeof image === "string") {
    const trimmed = image.trim()
    return trimmed || null
  }
  return image?.url || image?.src || null
}

const buildHeroImages = (seller) => {
  if (!seller) return [PRODUCT_IMAGE_FALLBACK]
  const images = []
  const pushUnique = (value) => {
    const url = resolveSellerImageUrl(value)
    if (url && !images.includes(url)) images.push(url)
  }
  if (Array.isArray(seller.coverImages)) seller.coverImages.forEach(pushUnique)
  pushUnique(seller.profileImage)
  const mainImage = resolveSellerImageUrl(seller.image)
  if (mainImage && !images.includes(mainImage)) pushUnique(mainImage)
  return images.length > 0 ? images : [PRODUCT_IMAGE_FALLBACK]
}

function SellerDetailsContent() {
  const { fulfilmentMode, storePath } = useStoreMode()
  const isDesktop = useStorefrontLayout()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  // Drop sticky listing distance once — old 6.9 cache was locking details.
  useEffect(() => {
    try {
      sessionStorage.removeItem("store_last_opened_seller_distance")
    } catch (_) {}
  }, [])
  const [searchParams] = useSearchParams()
  const targetDishId = useMemo(() => String(searchParams.get('dish') || '').trim(), [searchParams])
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart, itemCount } = useCart()
  const { vegMode, addDishFavorite, removeDishFavorite, isDishFavorite, getDishFavorites, getFavorites, addFavorite, removeFavorite, isFavorite } = useProfile()
  const {
    effectiveLocation: userLocation,
    zoneId,
    zone,
    zoneLoading: loadingZone,
    isOutOfService,
  } = useDeliveryLocation()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [quantities, setQuantities] = useState({})
  const [showManageCollections, setShowManageCollections] = useState(false)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [showLocationSheet, setShowLocationSheet] = useState(false)
  const [showScheduleSheet, setShowScheduleSheet] = useState(false)
  const [showOffersSheet, setShowOffersSheet] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null)
  const [expandedCoupons, setExpandedCoupons] = useState(new Set())
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())
  const [showMenuOptionsSheet, setShowMenuOptionsSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [expandedAddButtons, setExpandedAddButtons] = useState(new Set())
  const [expandedSections, setExpandedSections] = useState(new Set([0])) // Default: Recommended section is expanded
  const [highlightedDishId, setHighlightedDishId] = useState(null)
  const [loadingMenuItems, setLoadingMenuItems] = useState(true)
  const [selectedMenuCategory, setSelectedMenuCategory] = useState("all")
  const dishCardRefs = useRef({})

  const getLineItemIdForDish = (item, variant = null) =>
    buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

  const getVariantForDish = (item, preferredVariantId = "") => {
    const variants = getProductVariants(item)
    if (variants.length === 0) return null
    return variants.find((variant) => String(variant.id) === String(preferredVariantId || "")) || variants[0]
  }

  const getDishQuantity = (item, preferredVariantId = "") => {
    const variant = getVariantForDish(item, preferredVariantId)
    const lineItemId = getLineItemIdForDish(item, variant)
    return quantities[lineItemId] || 0
  }

  const isVegDish = (item) => {
    if (!item || typeof item !== "object") return false
    if (item.isVeg === true) return true
    const foodType = String(item.foodType || "").trim().toLowerCase()
    return foodType === "veg" || foodType === "vegetarian"
  }

  const isNonVegDish = (item) => {
    if (!item || typeof item !== "object") return false
    if (item.isVeg === false) return true
    const foodType = String(item.foodType || "").trim().toLowerCase()
    return foodType === "non-veg" || foodType === "nonveg"
  }

  // Initialize filters from localStorage if available
  const [filters, setFilters] = useState(() => {
    if (typeof window === "undefined" || !slug) {
      return {
        sortBy: null,
        vegNonVeg: null,
        highlyReordered: false,
        spicy: false,
      }
    }
    try {
      const raw = window.localStorage.getItem(SELLER_DETAILS_FILTERS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const savedFilters = parsed?.[slug]
        if (savedFilters && typeof savedFilters === "object") {
          return {
            sortBy:
              savedFilters.sortBy === "low-to-high" || savedFilters.sortBy === "high-to-low"
                ? savedFilters.sortBy
                : null,
            vegNonVeg:
              savedFilters.vegNonVeg === "veg" || savedFilters.vegNonVeg === "non-veg"
                ? savedFilters.vegNonVeg
                : null,
            highlyReordered: savedFilters.highlyReordered === true,
            spicy: savedFilters.spicy === true,
          }
        }
      }
    } catch (error) {
      debugWarn("Failed to initialize seller filters from localStorage:", error)
    }
    return {
      sortBy: null,
      vegNonVeg: null,
      highlyReordered: false,
      spicy: false,
    }
  })

  // Seller data state
  const [seller, setSeller] = useState(null)
  const [loadingSeller, setLoadingSeller] = useState(true)
  const [sellerError, setSellerError] = useState(null)
  const fetchedSellerRef = useRef(false) // Track if seller has been fetched for current slug
  const fetchedSlugRef = useRef(null)

  useEffect(() => {
    const tickAvailability = () => {
      if (typeof document !== "undefined" && document.hidden) return
      setAvailabilityTick(Date.now())
    }

    const intervalId = setInterval(tickAvailability, 60000)
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setAvailabilityTick(Date.now())
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    setSelectedMenuCategory("all")
  }, [slug])

  // Fetch seller data from API
  useEffect(() => {
    const fetchSeller = async () => {
      if (!slug) return

      // Prevent re-fetching for the same slug. Mobile location/zone updates can
      // trigger transient refetch failures that clear already-rendered content.
      if (fetchedSellerRef.current && fetchedSlugRef.current === slug && seller) {
        return
      }

      try {
        // Keep the existing page visible on background retries.
        setLoadingSeller(!fetchedSellerRef.current && !seller)
        setSellerError(null)

        debugLog('Fetching seller with slug:', slug)
        let response = null
        let apiSeller = null

        // Seller API (works for both ObjectId and slug)
        if (!apiSeller) {
          try {
            // First, try to get seller directly by slug/ID (no zoneId needed)
            try {
              response = await sellerAPI.getSellerById(slug)
              if (response?.data?.success && response?.data?.data) {
                apiSeller = response.data.data
                debugLog('? Found seller in seller API by slug/ID:', apiSeller)
              }
            } catch (directLookupError) {
              // If direct lookup fails, try searching by name.
              // Fallback without zoneId so missing live location never blocks this page.
              debugLog('? Direct lookup failed, trying search by name...')

                const searchVariants = zoneId
                  ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                  : [{ limit: 100, _ts: Date.now() }]

                for (const searchParams of searchVariants) {
                  try {
                    const searchResponse = await sellerAPI.getSellers(searchParams, { noCache: true })
                    const sellers = searchResponse?.data?.data?.sellers || searchResponse?.data?.data || []

                    // Try to find by slug match or name match
                    const sellerName = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                    const matchingSeller = sellers.find(r =>
                      r.slug === slug ||
                      r.name?.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase() ||
                      r.name?.toLowerCase() === sellerName.toLowerCase()
                    )

                    if (matchingSeller) {
                      // Get full seller details by ID
                      const fullResponse = await sellerAPI.getSellerById(matchingSeller._id || matchingSeller.sellerId)
                      if (fullResponse.data && fullResponse.data.success && fullResponse.data.data) {
                        apiSeller = fullResponse.data.data
                        debugLog('? Found seller in seller API by name search:', apiSeller)
                        break
                      }
                    }
                  } catch (searchError) {
                    debugWarn('? Search fallback failed for params:', searchParams, searchError?.message)
                  }
                }
            }
          } catch (sellerError) {
            debugError('? Seller not found in seller API either:', sellerError)
          }
        }

        if (apiSeller) {
          debugLog('? Fetched seller from API:', apiSeller)
          debugLog('? Seller data keys:', Object.keys(apiSeller))
          debugLog('? Seller name field:', apiSeller?.name)
          debugLog('? Seller sellerId:', apiSeller?.sellerId)
          debugLog('? Seller _id:', apiSeller?._id)
          debugLog('? Seller.seller:', apiSeller?.seller)

          // Some responses nest the seller data under `seller`
          const actualSeller = apiSeller?.seller || apiSeller

          // Helper function to format address with zone and pin code
          const formatSellerAddress = (locationObj) => {
            if (!locationObj) return "Location"

            // If location is a string, return it as is
            if (typeof locationObj === 'string') {
              return locationObj
            }

            // PRIORITY 1: Use formattedAddress if it's complete and has pin code
            // formattedAddress usually has the most complete information from Google Maps
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const formattedAddr = locationObj.formattedAddress.trim()
                // Check if it contains a pin code (6 digit number)
                const hasPinCode = /\b\d{6}\b/.test(formattedAddr)
                // If it has pin code, it's complete - use it directly
                if (hasPinCode) {
                  // Clean up the address - remove Google Plus Code if present (e.g., "PV6X+JXX, ")
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
                // If it has multiple parts (3+), it's likely complete
                if (formattedAddr.split(',').length >= 3) {
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
              }
            }

            // PRIORITY 2: Build address from location object components (with zone and pin code)
            // This ensures we always show zone and pin code if available
            const addressParts = []

            // Add addressLine1 if available
            if (locationObj.addressLine1 && locationObj.addressLine1.trim() !== "") {
              addressParts.push(locationObj.addressLine1.trim())
            }

            // Add addressLine2 if available
            if (locationObj.addressLine2 && locationObj.addressLine2.trim() !== "") {
              addressParts.push(locationObj.addressLine2.trim())
            }

            // Add area (zone) if available
            if (locationObj.area && locationObj.area.trim() !== "") {
              addressParts.push(locationObj.area.trim())
            }

            // Add city if available
            if (locationObj.city && locationObj.city.trim() !== "") {
              addressParts.push(locationObj.city.trim())
            }

            // Add state if available
            if (locationObj.state && locationObj.state.trim() !== "") {
              addressParts.push(locationObj.state.trim())
            }

            // Add pin code (priority: pincode > zipCode > postalCode)
            const pinCode = locationObj.pincode || locationObj.zipCode || locationObj.postalCode
            if (pinCode && pinCode.toString().trim() !== "") {
              addressParts.push(pinCode.toString().trim())
            }

            // If we have at least 3 parts (complete address), use it
            if (addressParts.length >= 3) {
              return addressParts.join(', ')
            }

            // If we have at least 2 parts, use it
            if (addressParts.length >= 2) {
              return addressParts.join(', ')
            }

            // PRIORITY 3: Fallback to formattedAddress (even if incomplete)
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const cleanedAddr = locationObj.formattedAddress.trim().replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                return cleanedAddr
              }
            }

            // PRIORITY 4: Fallback to address field
            if (locationObj.address && locationObj.address.trim() !== "") {
              return locationObj.address.trim()
            }

            // PRIORITY 5: Last fallback - use area or city
            return locationObj.area || locationObj.city || "Location"
          }

          // Get location object for address formatting
          const locationObj = actualSeller?.location || apiSeller?.location
          debugLog('? Location Object for formatting:', locationObj)
          debugLog('? formattedAddress field:', locationObj?.formattedAddress)
          const formattedAddress = formatSellerAddress(locationObj)
          debugLog('? Final Formatted Address:', formattedAddress)

          // Same Haversine + coordinate parsing as delivery new-order.
          const locationForDistance = normalizeSellerLocation(locationObj) || locationObj
          const measured = getUserSellerDistance(userLocation?.deliveryAddress || userLocation, locationForDistance)
          const calculatedDistance = measured?.label || null
          if (calculatedDistance) {
            debugLog('? Calculated distance from user to seller:', calculatedDistance, 'km:', measured.km)
          } else {
            debugWarn('? Cannot calculate distance - missing coordinates:', {
              hasUserLocation: !!(userLocation?.latitude || userLocation?.coordinates),
              hasSellerLocation: !!locationObj,
              userLocation,
              locationObj,
            })
          }

          // Resolve display category with broad API compatibility
          const categoryFromArray = (list) => {
            if (!Array.isArray(list) || list.length === 0) return null
            const firstEntry = list[0]
            if (typeof firstEntry === "string") return firstEntry
            if (firstEntry && typeof firstEntry === "object") {
              return firstEntry.name || firstEntry.label || firstEntry.title || null
            }
            return null
          }

          const resolvedTopCategory =
            actualSeller?.topCategory ||
            apiSeller?.topCategory ||
            categoryFromArray(actualSeller?.topCategories) ||
            categoryFromArray(apiSeller?.topCategories) ||
            categoryFromArray(actualSeller?.categories) ||
            categoryFromArray(apiSeller?.categories) ||
            actualSeller?.category ||
            apiSeller?.category ||
            null

          const onboardingStep2 = actualSeller?.onboarding?.step2 || apiSeller?.onboarding?.step2 || {}
          const onboardingStep4 = actualSeller?.onboarding?.step4 || apiSeller?.onboarding?.step4 || {}
          const normalizedProfileImage = actualSeller?.profileImage || apiSeller?.profileImage || onboardingStep2?.profileImageUrl || null
          const normalizedCoverImages =
            Array.isArray(actualSeller?.coverImages) && actualSeller.coverImages.length > 0
              ? actualSeller.coverImages
              : Array.isArray(apiSeller?.coverImages) && apiSeller.coverImages.length > 0
                ? apiSeller.coverImages
                : []
          const normalizedMenuImages =
            Array.isArray(actualSeller?.menuImages) && actualSeller.menuImages.length > 0
              ? actualSeller.menuImages
              : Array.isArray(apiSeller?.menuImages) && apiSeller.menuImages.length > 0
                ? apiSeller.menuImages
                : Array.isArray(onboardingStep2?.menuImageUrls)
                  ? onboardingStep2.menuImageUrls
                  : []
          const normalizedSellerOffers = actualSeller?.sellerOffers || apiSeller?.sellerOffers || {}

          // Transform API data to match expected format with comprehensive fallbacks
          // Handle both nested and flat seller data structures
          const transformedSeller = {
            id: actualSeller?.sellerId || actualSeller?._id || actualSeller?.id || apiSeller?.sellerId || apiSeller?._id || null,
            mongoId: actualSeller?._id || apiSeller?._id || null,
            name:
              actualSeller?.name ||
              actualSeller?.sellerName ||
              apiSeller?.name ||
              apiSeller?.sellerName ||
              "Unknown Seller",
            topCategory: resolvedTopCategory,
            rating: actualSeller?.rating || apiSeller?.rating || actualSeller?.averageRating || apiSeller?.averageRating || 4.5,
            reviews: actualSeller?.totalRatings || apiSeller?.totalRatings || actualSeller?.reviewCount || apiSeller?.reviewCount || actualSeller?.reviews?.length || apiSeller?.reviews?.length || 0,
            deliveryTime: actualSeller?.estimatedDeliveryTime || apiSeller?.estimatedDeliveryTime || actualSeller?.deliveryTime || apiSeller?.deliveryTime || actualSeller?.avgDeliveryTime || apiSeller?.avgDeliveryTime || "25-30 mins",
            distance: calculatedDistance || "—",
            location: formattedAddress,
            locationObject: locationForDistance || locationObj, // Normalized location for distance recalculation
            image: normalizedCoverImages?.[0]?.url
              || normalizedCoverImages?.[0]
              || normalizedProfileImage?.url
              || normalizedProfileImage
              || actualSeller?.image
              || apiSeller?.image
              || null,
            priceRange: actualSeller?.priceRange || apiSeller?.priceRange || onboardingStep4?.priceRange || "$$",
            offers: Array.isArray(actualSeller?.offers) ? actualSeller.offers : (Array.isArray(apiSeller?.offers) ? apiSeller.offers : []), // Will be populated from menu/offers API later
            offerText: actualSeller?.offer || apiSeller?.offer || onboardingStep4?.offer,
            offerCount: actualSeller?.offerCount || apiSeller?.offerCount || 0,
            sellerOffers: {
              goldOffer: {
                title: normalizedSellerOffers?.goldOffer?.title || "Gold exclusive offer",
                description: apiSeller?.sellerOffers?.goldOffer?.description || "Free delivery above ₹99",
                unlockText: normalizedSellerOffers?.goldOffer?.unlockText || "join Gold to unlock",
                buttonText: apiSeller?.sellerOffers?.goldOffer?.buttonText || "Add Gold - ₹1",
              },
              coupons: Array.isArray(normalizedSellerOffers?.coupons)
                ? normalizedSellerOffers.coupons
                : [],
            },
            outlets: Array.isArray(actualSeller?.outlets) ? actualSeller.outlets : (Array.isArray(apiSeller?.outlets) ? apiSeller.outlets : []),
            categories: Array.isArray(actualSeller?.categories) ? actualSeller.categories : (Array.isArray(apiSeller?.categories) ? apiSeller.categories : []),
            menu: Array.isArray(actualSeller?.menu) ? actualSeller.menu : (Array.isArray(apiSeller?.menu) ? apiSeller.menu : []),
            slug: actualSeller?.slug || apiSeller?.slug || actualSeller?.name?.toLowerCase().replace(/\s+/g, '-') || apiSeller?.name?.toLowerCase().replace(/\s+/g, '-') || slug || "unknown",
            sellerId: actualSeller?.sellerId || actualSeller?._id || actualSeller?.id || apiSeller?.sellerId || apiSeller?._id || apiSeller?.id || null,
            // Add other fields with defaults
            featuredDish: actualSeller?.featuredDish || apiSeller?.featuredDish || onboardingStep4?.featuredDish || "Special Item",
            featuredPrice: actualSeller?.featuredPrice || apiSeller?.featuredPrice || onboardingStep4?.featuredPrice || 249,
            // Additional safety fields
            openDays: Array.isArray(actualSeller?.openDays)
              ? actualSeller.openDays
              : (Array.isArray(apiSeller?.openDays) ? apiSeller.openDays : (Array.isArray(onboardingStep2?.openDays) ? onboardingStep2.openDays : [])),
            deliveryTimings: actualSeller?.deliveryTimings || apiSeller?.deliveryTimings || {
              openingTime: actualSeller?.openingTime || apiSeller?.openingTime || onboardingStep2?.deliveryTimings?.openingTime || "09:00",
              closingTime: actualSeller?.closingTime || apiSeller?.closingTime || onboardingStep2?.deliveryTimings?.closingTime || "22:00",
            },
            outletTimings: actualSeller?.outletTimings || apiSeller?.outletTimings || null,
            profileImage: normalizedProfileImage,
            coverImages: normalizedCoverImages,
            menuImages: normalizedMenuImages,
            // Menu sections for display (will be populated from menu API)
            menuSections: [],
            // Onboarding data including FSSAI license
            onboarding: actualSeller?.onboarding || apiSeller?.onboarding || null,
            // Availability fields for grayscale styling
            isActive: actualSeller?.isActive !== false, // Default to true if not specified
            isAcceptingOrders: actualSeller?.isAcceptingOrders !== false, // Default to true if not specified
          }

          debugLog('? Transformed seller:', transformedSeller)
          debugLog('? Seller ID for menu fetch:', transformedSeller.id)

          if (!transformedSeller.id) {
            debugError('? No seller ID found! Cannot fetch menu.')
          }

          setSeller(transformedSeller)
          fetchedSellerRef.current = true // Mark as fetched
          fetchedSlugRef.current = slug

          // Outlet timings are included in the seller API; fetch only as fallback.
          if (!transformedSeller.outletTimings) {
            try {
              const outletSellerId = transformedSeller.mongoId || actualSeller?._id || apiSeller?._id
              if (outletSellerId) {
                const outletResponse = await sellerAPI.getOutletTimingsBySellerId(outletSellerId)
                const outletTimingsData = outletResponse?.data?.data?.outletTimings || outletResponse?.data?.outletTimings
                if (outletTimingsData) {
                  setSeller((prev) => ({ ...prev, outletTimings: outletTimingsData }))
                }
              }
            } catch (outletError) {
              debugWarn("Outlet timings fetch failed, falling back to delivery timings:", outletError?.message)
            }
          }

          // Fetch menu and inventory for this seller
          // If no seller ID, try to find matching seller by name
          let sellerIdForMenu = transformedSeller.id

          if (!sellerIdForMenu) {
            debugWarn('? No seller ID available, searching for seller by name...')
            try {
              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              for (const searchParams of searchVariants) {
                const searchResponse = await sellerAPI.getSellers(searchParams, { noCache: true })
                const sellers = searchResponse?.data?.data?.sellers || searchResponse?.data?.data || []

                // Try to find by exact name match
                const matchingSeller = sellers.find(r =>
                  r.name?.toLowerCase().trim() === transformedSeller.name?.toLowerCase().trim()
                )

                if (matchingSeller) {
                  sellerIdForMenu = matchingSeller._id || matchingSeller.sellerId || matchingSeller.id
                  debugLog('? Found matching seller by name, ID:', sellerIdForMenu)

                  // Update the seller ID in state
                  setSeller(prev => ({
                    ...prev,
                    id: sellerIdForMenu,
                    sellerId: sellerIdForMenu
                  }))
                  break
                }
              }

              if (!sellerIdForMenu) {
                debugWarn('? No matching seller found by name')
              }
            } catch (searchError) {
              debugError('? Error searching for seller:', searchError)
            }
          }

          const normalizedLookupIds = [
            sellerIdForMenu,
            slug,
            transformedSeller.id,
            transformedSeller.sellerId,
            transformedSeller.mongoId,
            apiSeller?.sellerId,
            apiSeller?._id,
            actualSeller?.sellerId,
            actualSeller?._id,
            actualSeller?.slug,
          ]
            .filter(Boolean)
            .map((value) => String(value).trim())
            .filter((value, index, arr) => arr.indexOf(value) === index)

          setLoadingMenuItems(true)
          if (normalizedLookupIds.length > 0) {
            let hasPreviousOrderForSeller = false
            if (isModuleAuthenticated('user')) {
              try {
                const normalize = (value) => (value ? String(value).trim().toLowerCase() : "")
                const targetSellerName = normalize(transformedSeller.name)
                const targetSellerIds = new Set(
                  [
                    ...normalizedLookupIds,
                    transformedSeller.id,
                    transformedSeller.sellerId,
                    apiSeller?.sellerId,
                    apiSeller?._id,
                    actualSeller?.sellerId,
                    actualSeller?._id,
                  ].map(normalize).filter(Boolean)
                )

                const FETCH_LIMIT = 100
                const firstResponse = await orderAPI.getOrders({ limit: FETCH_LIMIT, page: 1 })
                let allOrders = []
                let totalPages = 1

                if (firstResponse?.data?.success && firstResponse?.data?.data?.orders) {
                  allOrders = firstResponse.data.data.orders || []
                  totalPages = firstResponse.data.data?.pagination?.pages || 1
                } else if (firstResponse?.data?.orders) {
                  allOrders = firstResponse.data.orders || []
                  totalPages = firstResponse.data?.pagination?.pages || 1
                } else if (Array.isArray(firstResponse?.data?.data)) {
                  allOrders = firstResponse.data.data || []
                }

                if (totalPages > 1) {
                  const pagePromises = []
                  for (let p = 2; p <= totalPages; p += 1) {
                    pagePromises.push(orderAPI.getOrders({ limit: FETCH_LIMIT, page: p }))
                  }

                  const pageResponses = await Promise.all(pagePromises)
                  const remainingOrders = pageResponses.flatMap((resp) => {
                    if (resp?.data?.success && resp?.data?.data?.orders) return resp.data.data.orders || []
                    if (resp?.data?.orders) return resp.data.orders || []
                    if (Array.isArray(resp?.data?.data)) return resp.data.data || []
                    return []
                  })
                  allOrders = [...allOrders, ...remainingOrders]
                }

                hasPreviousOrderForSeller = allOrders.some((order) => {
                  const orderSellerField = order?.sellerId
                  const candidateIds = [
                    order?.sellerId,
                    orderSellerField?._id,
                    orderSellerField?.id,
                    orderSellerField?.sellerId,
                    order?.seller,
                    order?.seller_id,
                  ].map(normalize).filter(Boolean)

                  if (candidateIds.some((id) => targetSellerIds.has(id))) {
                    return true
                  }

                  const candidateNames = [
                    order?.sellerName,
                    orderSellerField?.name,
                    order?.seller?.name,
                  ].map(normalize).filter(Boolean)

                  return !!targetSellerName && candidateNames.includes(targetSellerName)
                })
              } catch (orderCheckError) {
                debugWarn("Could not verify previous orders for recommendation section:", orderCheckError)
              }
            }

            try {
              debugLog('? Fetching menu for seller ID:', sellerIdForMenu)
              let menuResponse = null
              let resolvedMenuLookupId = null
              for (const lookupId of normalizedLookupIds) {
                try {
                  debugLog('? Fetching menu for seller lookup ID:', lookupId)
                  const response = await sellerAPI.getMenuBySellerId(lookupId, { noCache: true, params: { fulfilmentMode } })
                  if (response?.data?.success) {
                    menuResponse = response
                    resolvedMenuLookupId = lookupId
                    break
                  }
                } catch (lookupError) {
                  if (lookupError?.response?.status !== 404) {
                    throw lookupError
                  }
                }
              }
              if (!menuResponse) {
                throw Object.assign(new Error('Menu not found'), { response: { status: 404 } })
              }
              debugLog('? Menu resolved using lookup ID:', resolvedMenuLookupId)
              if (menuResponse.data && menuResponse.data.success && menuResponse.data.data && menuResponse.data.data.menu) {
                const rawSections = menuResponse.data.data.menu.sections || []
                const toArray = (value) => {
                  if (Array.isArray(value)) return value
                  if (!value || typeof value !== "object") return []
                  return Object.values(value).filter((entry) => entry && typeof entry === "object")
                }
                const normalizeItem = (item = {}) => {
                   const isRecommended = item.isRecommended === true || item.isRecommended === 1 || String(item.isRecommended) === "true"
                   const isSpicy = item.isSpicy === true || item.isSpicy === 1 || String(item.isSpicy) === "true"
                   let foodType = item.foodType || null
                   if (typeof foodType === 'string') {
                     if (foodType.toLowerCase() === 'veg') foodType = 'Veg'
                     else if (foodType.toLowerCase() === 'non-veg' || foodType.toLowerCase() === 'nonveg') foodType = 'Non-Veg'
                   }
                   return {
                     ...item,
                      id: String(item.id || item._id || `${Date.now()}-${Math.random()}`),
                      name: item.name || "Unnamed Item",
                      foodType,
                      price: getProductDisplayPrice(item),
                      variants: getProductVariants(item),
                      variations: getProductVariants(item),
                      isAvailable: channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop")).inStock,
                      stockNote: channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop")).low ? stockLabel(channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop"))) : null,
                      isRecommended,
                      isSpicy,
                     description: typeof item.description === "string" ? item.description : "",
                   }
                 }
                const menuSections = toArray(rawSections).map((section, sectionIndex) => ({
                  ...section,
                  id: String(section.id || section._id || `section-${sectionIndex}`),
                  name: section.name || section.title || "Unnamed Section",
                  items: toArray(section.items).map(normalizeItem),
                  subsections: toArray(section.subsections).map((subsection, subsectionIndex) => ({
                    ...subsection,
                    id: String(subsection.id || subsection._id || `subsection-${sectionIndex}-${subsectionIndex}`),
                    name: subsection.name || "Unnamed Subsection",
                    items: toArray(subsection.items).map(normalizeItem),
                  })),
                }))

                // Collect all recommended items from all sections
                // Only include items that are both recommended (isRecommended === true) AND available (isAvailable !== false)
                const recommendedItems = []
                menuSections.forEach(section => {
                  // Check direct items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.items && Array.isArray(section.items)) {
                    section.items.forEach(item => {
                      // Strict check: isRecommended must be exactly boolean true
                      // This will exclude: false, undefined, null, 0, "", and any other falsy values
                      if (isRecommendedItem(item) && item.isAvailable !== false) {
                        recommendedItems.push(item)
                      }
                    })
                  }
                  // Check subsection items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach(subsection => {
                      if (subsection.items && Array.isArray(subsection.items)) {
                        subsection.items.forEach(item => {
                          // Strict check: isRecommended must be exactly boolean true
                          // This will exclude: false, undefined, null, 0, "", and any other falsy values
                          if (isRecommendedItem(item) && item.isAvailable !== false) {
                            recommendedItems.push(item)
                          }
                        })
                      }
                    })
                  }
                })

                // Debug log to verify recommended items and their isRecommended values
                debugLog('Recommended items collected:', recommendedItems.map(item => ({
                  name: item.name,
                  isRecommended: item.isRecommended,
                  isRecommendedType: typeof item.isRecommended,
                  preparationTime: item.preparationTime
                })))

                // Debug log to check preparationTime in menu sections
                debugLog('Menu sections with preparationTime:', menuSections.map(section => ({
                  sectionName: section.name,
                  items: section.items?.map(item => ({
                    name: item.name,
                    preparationTime: item.preparationTime
                  })) || []
                })))

                // Dynamically inject the specifically searched dish at the very top if targetDishId is present
                let searchedDishSection = null
                if (targetDishId) {
                  const allItemsInMenu = []
                  menuSections.forEach(s => {
                    if (s.items) allItemsInMenu.push(...s.items)
                    if (s.subsections) {
                      s.subsections.forEach(ss => {
                        if (ss.items) allItemsInMenu.push(...ss.items)
                      })
                    }
                  })
                  const matchedItem = allItemsInMenu.find(item => String(item.id || item._id || "").trim() === targetDishId)
                  if (matchedItem) {
                    searchedDishSection = { 
                      name: "Result for your search", 
                      items: [matchedItem], 
                      subsections: [],
                      isSearchResult: true 
                    }
                  }
                }

                let finalMenuSections = [...menuSections]
                if (hasPreviousOrderForSeller) {
                  finalMenuSections = [{ name: "Recommended for you", items: recommendedItems, subsections: [] }, ...finalMenuSections]
                }
                if (searchedDishSection) {
                  finalMenuSections = [searchedDishSection, ...finalMenuSections]
                }

                setSeller(prev => ({
                  ...prev,
                  menuSections: finalMenuSections,
                }))

                // Set first 3 sections (Recommended, Starters, Main Course) as expanded by default
                const defaultExpandedSections = new Set(
                  Array.from({ length: Math.min(3, finalMenuSections.length) }, (_, idx) => idx)
                )
                setExpandedSections(defaultExpandedSections)

                debugLog('Fetched menu sections with recommended items:', finalMenuSections)
              }
            } catch (menuError) {
              if (menuError.response && menuError.response.status === 404) {
                debugLog('? Menu not found for this seller.')
              } else {
                debugError('? Error fetching menu:', menuError)
              }
            } finally {
              setLoadingMenuItems(false)
            }

            try {
              // The store's products for this storefront, grouped into
              // categories: GET /catalog/products?sellerId=&fulfilmentMode=
              // returns { products: [...] } and takes a Mongo id only.
              const productSellerId = normalizedLookupIds.find((value) => /^[a-f0-9]{24}$/i.test(value))
              if (productSellerId) {
                const response = await sellerAPI.getPublicProducts({ sellerId: productSellerId, fulfilmentMode, limit: 1000 })
                const products = response?.data?.data?.products || []
                const byCategory = new Map()
                for (const product of Array.isArray(products) ? products : []) {
                  const name = product.categoryName || "Other"
                  if (!byCategory.has(name)) byCategory.set(name, [])
                  byCategory.get(name).push(product)
                }
                const normalizedInventory = [...byCategory.entries()].map(([name, items], index) => ({
                  id: `category-${index}`,
                  name,
                  description: "",
                  itemCount: items.length,
                  inStock: items.some((item) => channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop")).inStock),
                  items: items.map((item) => ({
                    id: String(item._id || item.id),
                    name: item.name || "Unnamed Item",
                    inStock: channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop")).inStock,
                    isVeg: item.foodType === "Veg" ? true : item.foodType === "Non-Veg" ? false : null,
                    stockQuantity: channelAvailability(item, (fulfilmentMode === "quick" ? "quick" : "shop")).qty ?? "Unlimited",
                    unit: "piece",
                    expiryDate: null,
                    lastRestocked: null,
                  })),
                  order: index,
                }))

                setSeller(prev => ({
                  ...prev,
                  inventory: normalizedInventory,
                }))
              }
            } catch (inventoryError) {
              debugError('? Error fetching store products:', inventoryError)
            }
          }
          else {
            setLoadingMenuItems(false)
          }
        } else {
          debugError('? No seller data found in API response')
          debugError('? Response:', response)
          debugError('? apiSeller:', apiSeller)
          if (!fetchedSellerRef.current) {
            setSellerError('Seller not found')
            setSeller(null)
          }
        }
      } catch (error) {
        // Check if it's a network error (backend not running)
        const isNetworkError = error.code === 'ERR_NETWORK' || error.message === 'Network Error'

        // Check if it's a 404 error (seller doesn't exist)
        const is404Error = error.response?.status === 404

        if (isNetworkError) {
          // Network error - backend is not running
          // Don't show "Seller not found" for network errors
          // The axios interceptor will show a toast notification
          debugError('Network error fetching seller (backend may not be running):', error)
          if (!fetchedSellerRef.current) {
            setSellerError('Backend server is not connected. Please make sure the backend is running.')
            setSeller(null)
          }
        } else if (is404Error) {
          // 404 error - seller doesn't exist in database
          debugLog(`Seller "${slug}" not found in database`)
          if (!fetchedSellerRef.current) {
            setSellerError('Seller not found')
            setSeller(null)
          }
        } else {
          // Other errors
          debugError('Error fetching seller:', error)
          if (!fetchedSellerRef.current) {
            setSellerError(error.message || 'Failed to load seller')
            setSeller(null)
          }
        }
      } finally {
        setLoadingSeller(false)
        setLoadingMenuItems(false)
      }
    }

    // Reset fetched flag only when URL slug changes.
    // Do not compare with seller.slug because canonical API slug may differ
    // from route slug (e.g. "seller-2513"), causing refetch loops.
    if (fetchedSellerRef.current && fetchedSlugRef.current !== slug) {
      fetchedSellerRef.current = false
      fetchedSlugRef.current = null
    }

    fetchSeller()
  }, [slug, zoneId, fulfilmentMode])

  // Track previous distance label to avoid loops
  const prevDistanceRef = useRef(null)

  // Recalculate straight-line distance when user/seller location updates
  useEffect(() => {
    if (!seller?.locationObject || !userLocation) return
    if (seller?.distanceSource === "road") return

    const measured = getUserSellerDistance(
      userLocation?.deliveryAddress || userLocation,
      normalizeSellerLocation(seller.locationObject) || seller.locationObject,
    )
    if (!measured?.label) return

    const calculatedDistance = measured.label
    if (calculatedDistance === prevDistanceRef.current) return
    prevDistanceRef.current = calculatedDistance

    setSeller((prev) => {
      if (!prev || prev.distance === calculatedDistance || prev.distanceSource === "road") return prev
      return { ...prev, distance: calculatedDistance, distanceSource: "haversine" }
    })
  }, [
    userLocation?.latitude,
    userLocation?.longitude,
    userLocation?.coordinates?.[0],
    userLocation?.coordinates?.[1],
    seller?.locationObject,
    seller?.id,
    seller?.distanceSource,
  ])

  // Prefer Google road distance (matches delivery Rest→User / tripDistanceKm).
  useEffect(() => {
    let cancelled = false
    if (!seller?.locationObject || !userLocation) return undefined

    const run = async () => {
      const km = await fetchDrivingDistanceKm(
        userLocation?.deliveryAddress || userLocation,
        seller.locationObject,
      )
      if (cancelled || !Number.isFinite(Number(km))) return
      const label = formatDistanceLabel(km)
      if (!label) return
      prevDistanceRef.current = label
      setSeller((prev) => {
        if (!prev || (prev.distance === label && prev.distanceSource === "road")) return prev
        return { ...prev, distance: label, distanceSource: "road" }
      })
    }

    run()
    return () => {
      cancelled = true
    }
  }, [
    userLocation?.latitude,
    userLocation?.longitude,
    userLocation?.coordinates?.[0],
    userLocation?.coordinates?.[1],
    seller?.locationObject,
    seller?.id,
  ])

  // Sync quantities from cart on mount and when seller changes
  useEffect(() => {
    if (!seller || !seller.name) return

    const cartQuantities = {}
    cart.forEach((item) => {
      if (item.seller === seller.name) {
        cartQuantities[item.id] = item.quantity || 0
      }
    })
    setQuantities(cartQuantities)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seller?.name, cart])

  useEffect(() => {
    if (!selectedItem) {
      setSelectedVariantId("")
      return
    }
    const defaultVariant = getDefaultProductVariant(selectedItem)
    setSelectedVariantId(defaultVariant?.id || "")
  }, [selectedItem])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = (item, newQuantity, event = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart")
      navigate('/auth/login', { state: { from: location.pathname } })
      return
    }

    // CRITICAL: Check if user is in service zone or seller is available
    if (isOutOfService) {
      toast.error('You are outside the service zone. Please select a location within the service area.');
      return;
    }

    const availability = getSellerAvailabilityStatus(seller)
    if (!availability.isOpen) {
      toast.error("Seller is currently offline. Please try again later.")
      return
    }

    const resolvedVariant = preferredVariant || getDefaultProductVariant(item)
    const lineItemId = getLineItemIdForDish(item, resolvedVariant)

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [lineItemId]: newQuantity,
    }))

    // CRITICAL: Validate seller data before adding to cart
    if (!seller || !seller.name) {
      debugError('? Cannot add item to cart: Seller data is missing!');
      toast.error('Seller information is missing. Please refresh the page.');
      return;
    }

    // Ensure we have a valid sellerId
    const validSellerId = seller?.sellerId || seller?._id || seller?.id;
    if (!validSellerId) {
      debugError('? Cannot add item to cart: Seller ID is missing!', {
        seller: seller,
        sellerId: seller?.sellerId,
        _id: seller?._id,
        id: seller?.id
      });
      toast.error('Seller ID is missing. Please refresh the page.');
      return;
    }

    // Log for debugging
    debugLog('? Adding item to cart:', {
      itemName: item.name,
      sellerName: seller.name,
      sellerId: validSellerId,
      seller_id: seller._id,
      seller_sellerId: seller.sellerId
    });

    // Prepare cart item with all required properties
    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: item.id,
      name: item.name,
      price: resolvedVariant?.price ?? item.price,
      otherPrice:
        Number(resolvedVariant?.otherPrice) > 0
          ? Number(resolvedVariant.otherPrice)
          : getProductDisplayOtherPrice(item),
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: resolvedVariant?.price ?? item.price,
      image: item.image,
      seller: seller.name, // Use seller.name directly (already validated)
      sellerId: validSellerId, // Use validated sellerId
      description: item.description,
      originalPrice: item.originalPrice,
      foodType: item.foodType,
      isVeg: item.foodType === "Veg" ? true : item.foodType === "Non-Veg" ? false : null,
      preparationTime: item.preparationTime // Add preparationTime property
    }

    // Get source position for animation from event target
    // Prefer currentTarget (the button) over target (might be icon inside button)
    let sourcePosition = null
    if (event) {
      // Use currentTarget (the button element) for accurate button position
      // If currentTarget is not available, try to find the button element
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        // If we clicked on an icon inside, find the closest button
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        // Store button reference and current viewport position
        // We'll recalculate position right before animation to account for scroll
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        // Store both viewport position and scroll at capture time
        // This allows us to adjust for scroll changes later
        sourcePosition = {
          // Viewport-relative position at capture time
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          // Scroll position at capture time
          scrollX: scrollX,
          scrollY: scrollY,
          // Store button identifier to potentially find it again
          itemId: lineItemId,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      // Pass sourcePosition and product info for removal animation
      const productInfo = {
        id: lineItemId,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(lineItemId, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(lineItemId)
      if (existingCartItem) {
        // Prepare product info for animation
        const productInfo = {
          id: lineItemId,
          name: item.name,
          imageUrl: item.image,
        }

        // If incrementing quantity, trigger add animation with sourcePosition
        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = addToCart(cartItem, sourcePosition, { quantity: newQuantity - existingCartItem.quantity })
          if (result?.ok === false) {
            if (result.needsConfirmation) return
            toast.error(result.error || 'Cannot add item from different seller. Please clear cart first.')
            return
          }
        }
        // If decreasing quantity, trigger removal animation with sourcePosition
        else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        }
        // Otherwise just update quantity without animation
        else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        // Add to cart first (adds with quantity 1), then update to desired quantity
        // Pass sourcePosition when adding a new item
        const result = addToCart(cartItem, sourcePosition, { quantity: newQuantity })
        if (result?.ok === false) {
          if (result.needsConfirmation) return
          toast.error(result.error || 'Cannot add item from different seller. Please clear cart first.')
          return
        }
      }
    }
  }

  const isRecommendedSection = (section) => {
    const sectionName = section?.name || section?.title || ""
    if (typeof sectionName !== "string") return false
    const name = sectionName.trim().toLowerCase()
    return name === "recommended for you" || name === "result for your search"
  }

  const isRecommendedItem = (item) => {
    return item.isRecommended === true && typeof item.isRecommended === "boolean"
  }

  const getSectionDisplayName = (section) => {
    if (isRecommendedSection(section)) {
      return "Recommended for you"
    }
    if (section?.name && typeof section.name === "string" && section.name.trim()) {
      return section.name.trim()
    }
    if (section?.title && typeof section.title === "string" && section.title.trim()) {
      return section.title.trim()
    }
    return "Unnamed Section"
  }

  const normalizeMenuCategoryId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")

  const toRenderableArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== "object") return []
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }

  const getSectionCategoryImage = (section) => {
    const directImage = typeof section?.image === "string" ? section.image.trim() : ""
    if (directImage) return directImage

    const firstSectionItemImage = toRenderableArray(section?.items).find(
      (item) => typeof item?.image === "string" && item.image.trim(),
    )?.image
    if (firstSectionItemImage) return firstSectionItemImage

    const firstSubsectionImage = toRenderableArray(section?.subsections)
      .flatMap((subsection) => toRenderableArray(subsection?.items))
      .find((item) => typeof item?.image === "string" && item.image.trim())?.image

    return firstSubsectionImage || ""
  }

  // Menu categories - dynamically generated from seller menu sections
  const menuCategories = useMemo(() => {
    if (!seller?.menuSections || !Array.isArray(seller.menuSections)) return []

    return seller.menuSections
      .map((section, index) => {
        if (isRecommendedSection(section)) return null

        const sectionTitle = getSectionDisplayName(section)
        const itemCount = Array.isArray(section?.items) ? section.items.length : 0
        const subsectionCount = Array.isArray(section?.subsections)
          ? section.subsections.reduce((sum, sub) => sum + (Array.isArray(sub?.items) ? sub.items.length : 0), 0)
          : 0
        const totalCount = itemCount + subsectionCount

        if (totalCount <= 0) return null

        return {
          id: normalizeMenuCategoryId(section?.categoryId || sectionTitle || index) || `section-${index}`,
          name: sectionTitle,
          image: getSectionCategoryImage(section),
          count: totalCount,
          sectionIndex: index,
        }
      })
      .filter(Boolean)
  }, [seller?.menuSections])

  // Count active filters
  const getActiveFilterCount = () => {
    let count = 0
    if (filters.sortBy) count++
    if (filters.vegNonVeg) count++
    if (filters.highlyReordered) count++
    if (filters.spicy) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()

  useEffect(() => {
    if (!vegMode) return
    setFilters((prev) => (
      prev.vegNonVeg === "non-veg"
        ? { ...prev, vegNonVeg: null }
        : prev
    ))
  }, [vegMode])

  useEffect(() => {
    if (typeof window === "undefined" || !slug) return

    try {
      const raw = window.localStorage.getItem(SELLER_DETAILS_FILTERS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : {}
      const nextState = parsed && typeof parsed === "object" ? parsed : {}
      nextState[slug] = filters
      window.localStorage.setItem(SELLER_DETAILS_FILTERS_STORAGE_KEY, JSON.stringify(nextState))
    } catch (error) {
      debugWarn("Failed to persist seller filters:", error)
    }
  }, [filters, slug])

  useEffect(() => {
    if (selectedMenuCategory === "all") return
    const categoryStillVisible = menuCategories.some((category) => category.id === selectedMenuCategory)
    if (!categoryStillVisible) {
      setSelectedMenuCategory("all")
    }
  }, [menuCategories, selectedMenuCategory])

  // Handle bookmark click
  const handleBookmarkClick = (item) => {
    const sellerId = seller?.sellerId || seller?._id || seller?.id
    if (!sellerId) {
      toast.error("Seller information is missing")
      return
    }

    const dishId = item.id || item._id
    if (!dishId) {
      toast.error("Dish information is missing")
      return
    }

    const isFavorite = isDishFavorite(dishId, sellerId)

    if (isFavorite) {
      // If already bookmarked, remove it
      removeDishFavorite(dishId, sellerId)
      toast.success("Dish removed from favorites")
    } else {
      // Add to favorites
      const dishData = {
        id: dishId,
        name: item.name,
        description: item.description,
        price: item.price,
        originalPrice: item.originalPrice,
        image: item.image,
        sellerId: sellerId,
        sellerName: seller?.name || "",
        sellerSlug: seller?.slug || slug || "",
        foodType: item.foodType,
        isSpicy: item.isSpicy,
        customisable: item.customisable,
      }
      addDishFavorite(dishData)
      toast.success("Dish added to favorites")
    }
  }

  // Handle add to collection
  const handleAddToCollection = () => {
    const sellerSlug = seller?.slug || slug || ""

    if (!sellerSlug) {
      toast.error("Seller information is missing")
      return
    }

    if (!seller) {
      toast.error("Seller data not available")
      return
    }

    const isAlreadyFavorite = isFavorite(sellerSlug)

    if (isAlreadyFavorite) {
      // Remove from collection
      removeFavorite(sellerSlug)
      toast.success("Seller removed from collection")
    } else {
      // Add to collection
      addFavorite({
        slug: sellerSlug,
        name: seller.name || "",
        rating: seller.rating || 0,
        deliveryTime: seller.deliveryTime || seller.estimatedDeliveryTime || "",
        distance: seller.distance || "",
        priceRange: seller.priceRange || "",
        image: seller.profileImageUrl?.url || seller.image || ""
      })
      toast.success("Seller added to collection")
    }

    setShowMenuOptionsSheet(false)
  }

  // Handle share seller
  const handleShareSeller = async () => {
    const companyName = await getCompanyNameAsync()
    const sellerSlug = seller?.slug || slug || ""
    const sellerName = seller?.name || "this seller"

    // Create share URL
    const shareUrl = `${window.location.origin}/user/sellers/${sellerSlug}`
    const shareText = `Check out ${sellerName} on ${companyName}! ${shareUrl}`

    const payload = {
      title: sellerName,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      setShowMenuOptionsSheet(false)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Seller shared successfully")
      setShowMenuOptionsSheet(false)
      return
    }

    openShareModal(payload)
    setShowMenuOptionsSheet(false)
  }



  // Handle share click
  const handleShareClick = async (item) => {
    const dishId = item.id || item._id
    const sellerSlug = seller?.slug || slug || ""

    // Create share URL
    const shareUrl = `${window.location.origin}/user/sellers/${sellerSlug}?dish=${dishId}`
    const shareText = `Check out ${item.name} from ${seller?.name || "this seller"}! ${shareUrl}`

    const payload = {
      title: `${item.name} - ${seller?.name || ""}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Dish shared successfully")
      return
    }

    openShareModal(payload)
  }

  // Copy to clipboard helper
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      document.body.removeChild(textArea)
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  // Handle item card click
  const handleItemClick = (item) => {
    setSelectedItem(item)
    setShowItemDetail(true)
  }

  const handleAddButtonClick = (item, event) => {
    if (hasProductVariants(item) && getDishQuantity(item) === 0) {
      handleItemClick(item)
      return
    }
    updateItemQuantity(item, 1, event)
  }

  // Helper function to calculate final price after discount
  const getFinalPrice = (item) => {
    // If discount exists, calculate from originalPrice, otherwise use price directly
    if (item.originalPrice && item.discountAmount && item.discountAmount > 0) {
      // Calculate discounted price from originalPrice
      let discountedPrice = item.originalPrice;
      if (item.discountType === 'Percent') {
        discountedPrice = item.originalPrice - (item.originalPrice * item.discountAmount / 100);
      } else if (item.discountType === 'Fixed') {
        discountedPrice = item.originalPrice - item.discountAmount;
      }
      return Math.max(0, discountedPrice);
    }
    // Otherwise, use price as the final price
    return Math.max(0, item.price || 0);
  };

  // Filter menu items based on active filters
  const filterMenuItems = (items) => {
    if (!items) return items

    return items.filter((item) => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const itemName = item.name?.toLowerCase() || ""
        if (!itemName.includes(query)) return false
      }

      // VegMode filter - when vegMode is ON, show only Veg items
      // When vegMode is false/null/undefined, show all items (Veg and Non-Veg)
      if (vegMode === true) {
        if (item.foodType !== "Veg") return false
      }

      // Veg/Non-veg filter (local filter override)
      if (filters.vegNonVeg === "veg") {
        // Show only veg items
        if (item.foodType !== "Veg") return false
      }
      if (filters.vegNonVeg === "non-veg") {
        // Show only non-veg items
        if (item.foodType !== "Non-Veg") return false
      }

      if (filters.highlyReordered && !isRecommendedItem(item)) return false
      if (filters.spicy && item.isSpicy !== true) return false

      return true
    })
  }

  // Sort items based on sortBy filter
  const sortMenuItems = (items) => {
    if (!items) return items
    if (!filters.sortBy) return items

    const sorted = [...items]
    if (filters.sortBy === "low-to-high") {
      return sorted.sort((a, b) => getFinalPrice(a) - getFinalPrice(b))
    } else if (filters.sortBy === "high-to-low") {
      return sorted.sort((a, b) => getFinalPrice(b) - getFinalPrice(a))
    }
    return sorted
  }

  const getSectionSortValue = (section) => {
    const allItems = [
      ...toRenderableArray(section?.items),
      ...toRenderableArray(section?.subsections).flatMap((subsection) => toRenderableArray(subsection?.items)),
    ]

    if (allItems.length === 0) return null

    const prices = allItems
      .map((item) => getFinalPrice(item))
      .filter((price) => Number.isFinite(price))

    if (prices.length === 0) return null

    if (filters.sortBy === "low-to-high") {
      return Math.min(...prices)
    }

    if (filters.sortBy === "high-to-low") {
      return Math.max(...prices)
    }

    return null
  }

  // Build renderable sections from the current filter state so section/subsection visibility
  // stays in sync with the actual filtered items shown on screen.
  const getFilteredSections = () => {
    if (!seller?.menuSections) return []

    const visibleSections = seller.menuSections
      .map((section, index) => {
        const filteredItems = sortMenuItems(
          filterMenuItems(
            toRenderableArray(section?.items).filter((item) => item?.isAvailable !== false)
          )
        )

        const filteredSubsections = toRenderableArray(section?.subsections)
          .map((subsection) => ({
            ...subsection,
            items: sortMenuItems(
              filterMenuItems(
                toRenderableArray(subsection?.items).filter((item) => item?.isAvailable !== false)
              )
            ),
          }))
          .filter((subsection) => subsection.items.length > 0)

        return {
          section: {
            ...section,
            items: filteredItems,
            subsections: filteredSubsections,
          },
          originalIndex: index,
        }
      })
      .filter(({ section }) => {
        if (selectedMenuCategory !== "all") {
          if (isRecommendedSection(section)) return false
          const sectionCategoryId = normalizeMenuCategoryId(section?.categoryId || getSectionDisplayName(section))
          if (sectionCategoryId !== selectedMenuCategory) {
            return false
          }
        }

        const hasVisibleItems = toRenderableArray(section?.items).length > 0
        const hasVisibleSubsections = toRenderableArray(section?.subsections).length > 0
        return hasVisibleItems || hasVisibleSubsections
      })

    if (!filters.sortBy) {
      return visibleSections
    }

    return [...visibleSections].sort((left, right) => {
      const leftValue = getSectionSortValue(left.section)
      const rightValue = getSectionSortValue(right.section)

      if (leftValue == null && rightValue == null) return 0
      if (leftValue == null) return 1
      if (rightValue == null) return -1

      return filters.sortBy === "low-to-high"
        ? leftValue - rightValue
        : rightValue - leftValue
    })
  }

  const hasActiveMenuFilters = Boolean(
    searchQuery.trim() ||
    vegMode === true ||
    filters.sortBy ||
    filters.vegNonVeg ||
    filters.highlyReordered ||
    filters.spicy
  )

  const filteredSections = useMemo(
    () => getFilteredSections(),
    [seller?.menuSections, searchQuery, vegMode, filters, selectedMenuCategory]
  )

  useEffect(() => {
    if (!hasActiveMenuFilters) return

    const nextExpanded = new Set()
    filteredSections.forEach(({ section, originalIndex }) => {
      nextExpanded.add(originalIndex)
      toRenderableArray(section?.subsections).forEach((_, subIndex) => {
        nextExpanded.add(`${originalIndex}-${subIndex}`)
      })
    })

    setExpandedSections(nextExpanded)
  }, [filteredSections, hasActiveMenuFilters])

  useEffect(() => {
    if (!seller?.menuSections || !targetDishId) return

    let matchedItem = null
    const sectionKeysToExpand = new Set()

    seller.menuSections.forEach((section, originalIndex) => {
      const sectionItems = toRenderableArray(section?.items)
      const matchedSectionItem = sectionItems.find(
        (item) => String(item?.id || item?._id || "").trim() === targetDishId,
      )

      if (matchedSectionItem && !matchedItem) {
        matchedItem = matchedSectionItem
        sectionKeysToExpand.add(originalIndex)
      }

      const sectionSubsections = toRenderableArray(section?.subsections)
      sectionSubsections.forEach((subsection, subIndex) => {
        const subsectionItems = toRenderableArray(subsection?.items)
        const matchedSubsectionItem = subsectionItems.find(
          (item) => String(item?.id || item?._id || "").trim() === targetDishId,
        )

        if (matchedSubsectionItem && !matchedItem) {
          matchedItem = matchedSubsectionItem
          sectionKeysToExpand.add(originalIndex)
          sectionKeysToExpand.add(`${originalIndex}-${subIndex}`)
        }
      })
    })

    if (!matchedItem) return

    setExpandedSections((prev) => {
      const next = new Set(prev)
      sectionKeysToExpand.forEach((key) => next.add(key))
      return next
    })
    setHighlightedDishId(targetDishId)

    const scrollTimer = window.setTimeout(() => {
      const targetNode = dishCardRefs.current[targetDishId]
      if (targetNode) {
        targetNode.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }, 250)

    const highlightTimer = window.setTimeout(() => {
      setHighlightedDishId((current) => (current === targetDishId ? null : current))
    }, 2600)

    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [seller, targetDishId])

  // Highlight offers/texts for the blue offer line
  const highlightOffers = [
    seller?.offerText || "",
    ...(Array.isArray(seller?.offers) ? seller.offers.map((offer) => offer?.title || "") : []),
  ].filter((offer) => typeof offer === "string" && offer.trim())

  const heroImages = useMemo(() => buildHeroImages(seller), [seller])

  // Auto-rotate hero images every 3 seconds
  useEffect(() => {
    if (heroImages.length <= 1) return undefined
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setCurrentImageIndex((prev) => (prev + 1) % heroImages.length)
    }, 3000)
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setCurrentImageIndex((prev) => (prev + 1) % heroImages.length)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [heroImages.length])

  // Auto-rotate highlight offer text every 2 seconds
  useEffect(() => {
    if (highlightOffers.length === 0) return undefined
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setHighlightIndex((prev) => (prev + 1) % highlightOffers.length)
    }, 2000)

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setHighlightIndex((prev) => (prev + 1) % highlightOffers.length)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [highlightOffers.length])

  // Show loading state
  if (loadingSeller) {
    return <SellerDetailSkeleton />
  }

  // Show error state if seller not found or network error
  if (sellerError && !seller) {
    const isNetworkError = sellerError.includes('Backend server is not connected')
    const isNotFoundError = sellerError === 'Seller not found'

    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className={`h-12 w-12 ${isNetworkError ? 'text-orange-500' : 'text-red-500'}`} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {isNetworkError ? 'Connection Error' : isNotFoundError ? 'Seller not found' : 'Error'}
              </h2>
              <p className="text-sm text-gray-600 mb-4 max-w-md">{sellerError}</p>
              {isNetworkError && (
                <p className="text-xs text-gray-500 mb-4">
                  Make sure the backend server is running at {API_BASE_URL.replace('/api', '')}
                </p>
              )}
              <Button onClick={goBack} variant="outline">
                Go Back
              </Button>
            </div>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  // Show error if seller is still null
  if (!seller) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <span className="text-sm text-gray-600">Seller not found</span>
            <Button onClick={goBack} variant="outline">
              Go Back
            </Button>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  const availabilityStatus = getSellerAvailabilityStatus(seller, new Date(availabilityTick))
  const isSellerOffline = !availabilityStatus.isOpen
  const shouldShowGrayscale = isOutOfService || isSellerOffline
  const displayHeroImages = heroImages.length > 0 ? heroImages : [PRODUCT_IMAGE_FALLBACK]
  const safeHighlightIndex = highlightOffers.length > 0 ? highlightIndex % highlightOffers.length : 0
  const hasCartItems = itemCount > 0
  const menuButtonBottomClass = hasCartItems ? "bottom-[5.25rem]" : "bottom-4"

  // Desktop (lg+): store header and product grid with a category rail; mobile below is unchanged.
  if (isDesktop) {
    return (
      <StoreDesktop
        seller={seller}
        sections={seller.menuSections || []}
        coverImage={displayHeroImages[0]}
        isOpen={!isSellerOffline && !isOutOfService}
        onAddToCart={(item) => {
          if (hasProductVariants(item)) {
            navigate(storePath(`/product/${item.id}`))
            return
          }
          const current = getCartItem(getLineItemIdForDish(item))?.quantity || 0
          updateItemQuantity(item, current + 1)
        }}
      />
    )
  }

  return (
    <AnimatedPage
      id="scrollingelement"
      className={`min-h-screen bg-transparent flex flex-col transition-all duration-300 ${shouldShowGrayscale ? 'grayscale opacity-75' : ''
        }`}
    >
      {/* Sticky Header — overlays hero image */}
      <div className="sticky top-0 z-50 bg-transparent pointer-events-none">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-2.5 sm:py-3 pointer-events-auto">
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-9 w-9 sm:h-10 sm:w-10 shrink-0 border border-white/50 dark:border-white/15 shadow-sm !bg-white/40 dark:!bg-black/30 backdrop-blur-md hover:!bg-white/60 dark:hover:!bg-black/45 text-gray-900 dark:text-white"
              onClick={goBack}
            >
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>

            <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              {!showSearch ? (
                <Button
                  variant="ghost"
                  className="rounded-full h-9 sm:h-10 px-3 sm:px-4 border border-white/50 dark:border-white/15 shadow-sm !bg-white/40 dark:!bg-black/30 backdrop-blur-md flex items-center gap-1.5 sm:gap-2 text-gray-900 dark:text-white hover:!bg-white/60 dark:hover:!bg-black/45"
                  onClick={() => setShowSearch(true)}
                >
                  <Search className="h-4 w-4" />
                  <span className="text-xs sm:text-sm font-medium">Search</span>
                </Button>
              ) : (
                <div className="relative flex-1 max-w-xl">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search this store..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-9 py-2 sm:py-2.5 rounded-full border border-white/50 dark:border-white/15 shadow-sm bg-white/50 dark:bg-black/30 backdrop-blur-md text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-wh-brand focus:border-transparent"
                    autoFocus
                    onBlur={() => {
                      if (!searchQuery) setShowSearch(false)
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("")
                        setShowSearch(false)
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-9 w-9 sm:h-10 sm:w-10 shrink-0 border border-white/50 dark:border-white/15 shadow-sm !bg-white/40 dark:!bg-black/30 backdrop-blur-md hover:!bg-white/60 dark:hover:!bg-black/45 text-gray-900 dark:text-white"
                onClick={() => setShowMenuOptionsSheet(true)}
              >
                <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full pb-0 -mt-14 sm:-mt-[3.75rem]">
        {/* Hero Banner — full-bleed, extends under transparent header */}
        <div className="relative left-1/2 w-screen max-w-none -translate-x-1/2 overflow-hidden h-[224px] sm:h-[276px] md:h-[316px] lg:h-[336px]">
          <AnimatePresence mode="wait">
            <motion.img
              key={displayHeroImages[currentImageIndex % displayHeroImages.length]}
              src={displayHeroImages[currentImageIndex % displayHeroImages.length]}
              alt={seller?.name || "Seller"}
              className="absolute inset-0 h-full w-full object-cover object-center"
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0.85 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              onError={(event) => {
                event.currentTarget.src = PRODUCT_IMAGE_FALLBACK
              }}
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/20" />
          {displayHeroImages.length > 1 && (
            <div className="absolute bottom-3 right-4 flex items-center gap-1">
              {displayHeroImages.map((_, index) => (
                <button
                  key={`hero-dot-${index}`}
                  type="button"
                  aria-label={`Show image ${index + 1}`}
                  onClick={() => setCurrentImageIndex(index)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    index === currentImageIndex % displayHeroImages.length
                      ? "w-4 bg-white"
                      : "w-1.5 bg-white/45"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="max-w-7xl mx-auto w-full">
        {/* Overlapping Seller Info Card */}
        <div className="relative z-10 mx-3 sm:mx-4 md:mx-6 lg:mx-8 xl:mx-12 -mt-6 sm:-mt-8">
          <div className="rounded-[20px] sm:rounded-[24px] bg-white dark:bg-[#141414] px-4 py-3.5 sm:p-5 shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)] border border-white/80 dark:border-gray-800/80">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-[17px] sm:text-xl md:text-2xl font-bold tracking-tight text-gray-950 dark:text-white leading-snug line-clamp-2">
                  {seller?.name || "Unknown Seller"}
                </h1>
                {seller?.topCategory && (
                  <div className="mt-1.5 flex items-center gap-2 text-[13px] sm:text-sm text-gray-700 dark:text-gray-300">
                    <Utensils className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span>{seller.topCategory}</span>
                  </div>
                )}
                <div className="mt-1.5 flex items-start gap-1.5 text-[13px] sm:text-sm text-gray-600 dark:text-gray-400">
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span className="leading-relaxed line-clamp-2">
                    {seller?.distance || "1.2 km"}
                    {seller?.location && (
                      <>
                        <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
                        {seller.location}
                      </>
                    )}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <Badge
                  className="text-wh-text mb-1 flex items-center gap-1 px-2 py-1 border-0"
                  style={{
                    backgroundColor: "var(--module-theme-color, #FD920B)",
                    boxShadow: "0 4px 10px rgba(var(--module-theme-rgb, 253,146,11), 0.28)",
                  }}
                >
                  <Star className="h-3 w-3 fill-wh-text" />
                  {seller?.rating || 4.5}
                </Badge>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  By {(seller?.reviews || 0).toLocaleString()}+
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[13px] sm:text-sm text-gray-700 dark:text-gray-300">
                <Clock className="h-4 w-4 shrink-0 text-gray-400" />
                <span>{seller?.deliveryTime || "25-30 mins"}</span>
              </div>
              <Badge
                className={`${isSellerOffline ? "bg-rose-600 text-white" : "text-wh-text"} border-0`}
                style={!isSellerOffline ? {
                  backgroundColor: "var(--module-theme-color, #FD920B)",
                  boxShadow: "0 4px 10px rgba(var(--module-theme-rgb, 253,146,11), 0.25)",
                } : undefined}
              >
                {isSellerOffline ? "Offline" : "Open now"}
              </Badge>
            </div>

            {isSellerOffline && (
              <div className="mt-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2.5 text-[12px] sm:text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Orders unavailable — seller is offline.</span>
              </div>
            )}
          </div>
        </div>

        {/* Offers Banner */}
        {highlightOffers.length > 0 && (
          <button
            type="button"
            onClick={() => setShowOffersSheet(true)}
            className="mx-3 sm:mx-4 md:mx-6 lg:mx-8 xl:mx-12 mt-3 block w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] rounded-2xl px-4 py-3 text-left shadow-[0_6px_20px_rgba(var(--module-theme-rgb,253,146,11),0.22)]"
            style={{ backgroundColor: "var(--wh-nav-2)" }}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Tag className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="relative h-5 overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={safeHighlightIndex}
                      initial={{ y: 12, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -12, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="text-sm font-bold text-white truncate"
                    >
                      {highlightOffers[safeHighlightIndex]}
                    </motion.p>
                  </AnimatePresence>
                </div>
                <p className="text-[11px] text-white/75 mt-0.5">Tap to view all offers</p>
              </div>
              {highlightOffers.length > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  {highlightOffers.map((_, index) => (
                    <span
                      key={`offer-dot-${index}`}
                      className={`h-1.5 rounded-full transition-all ${
                        index === safeHighlightIndex ? "w-3 bg-white" : "w-1.5 bg-white/40"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </button>
        )}

        {/* Filters Row */}
        <div className="mt-3 px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
            <button
              type="button"
              onClick={() => setShowFilterSheet(true)}
              className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-[13px] font-semibold transition-all shrink-0 ${
                activeFilterCount > 0
                  ? "border-wh-brand bg-[#FFF1E8] text-wh-brand-ink"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-gray-800 dark:text-gray-200"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-wh-brand px-1 text-[10px] font-bold text-wh-text">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                }))
              }
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-[12px] font-bold uppercase tracking-wide shrink-0 transition-all ${
                filters.vegNonVeg === "veg"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-gray-600 dark:text-gray-300"
              }`}
            >
              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: "#16a34a" }} />
              Veg
            </button>
            {!vegMode && (
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                  }))
                }
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-[12px] font-bold uppercase tracking-wide shrink-0 transition-all ${
                  filters.vegNonVeg === "non-veg"
                    ? "border-red-500 bg-red-50 text-red-700"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-gray-600 dark:text-gray-300"
                }`}
              >
                <span className="h-3 w-3 rounded-full shrink-0 bg-red-600" style={{ backgroundColor: "#dc2626" }} />
                Non-veg
              </button>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    sortBy: null,
                    vegNonVeg: null,
                    highlyReordered: false,
                    spicy: false,
                  })
                }
                className="text-[12px] font-semibold text-wh-brand-ink whitespace-nowrap shrink-0 px-1"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category Chips */}
          {menuCategories.length > 0 && (
            <div className="mt-2.5 flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
              <button
                type="button"
                onClick={() => setSelectedMenuCategory("all")}
                className={`flex items-center justify-center shrink-0 transition-all ${
                  selectedMenuCategory === "all"
                    ? "h-9 min-w-[36px] px-3 rounded-full text-wh-text text-[13px] font-bold shadow-sm"
                    : "h-9 min-w-[36px] px-3 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-[13px] font-semibold text-gray-600 dark:text-gray-300"
                }`}
                style={selectedMenuCategory === "all" ? {
                  backgroundColor: "var(--module-theme-color, #FD920B)",
                  boxShadow: "0 4px 12px rgba(var(--module-theme-rgb, 253,146,11), 0.25)",
                } : undefined}
              >
                All
              </button>
              {menuCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedMenuCategory(category.id)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[13px] font-semibold shrink-0 transition-all ${
                    selectedMenuCategory === category.id
                      ? "border-wh-brand bg-[#FFF1E8] text-wh-brand-ink"
                      : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {category.image ? (
                    <img
                      src={category.image}
                      alt={category.name}
                      className="h-7 w-7 rounded-full object-cover border border-gray-100 dark:border-gray-700"
                      onError={(event) => {
                        event.currentTarget.style.display = "none"
                      }}
                    />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] font-bold uppercase text-gray-500">
                      {category.name?.charAt(0) || "C"}
                    </span>
                  )}
                  {category.name}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Main Content Card wrapper for menu */}
      <div className="bg-transparent relative z-10 min-h-[40vh] mt-2 sm:mt-3">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12 pb-0">

        {/* Menu Items Section */}
        {seller?.menuSections && Array.isArray(seller.menuSections) && seller.menuSections.length > 0 && (
          <div className="py-6 sm:py-8 md:py-10 lg:py-12 space-y-6 md:space-y-8 lg:space-y-10">
            {filteredSections.length === 0 && hasActiveMenuFilters && (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-5 py-8 text-center">
                <p className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                  No dishes match the selected filters.
                </p>
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Clear filters or try a different combination.
                </p>
              </div>
            )}
            {filteredSections.length === 0 && (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
                No dishes match the current filters.
              </div>
            )}

            {filteredSections.map(({ section, originalIndex }, sectionIndex) => {
              // Handle section name - check for valid non-empty string
              const isRecommended = isRecommendedSection(section)
              const sectionId = `menu-section-${originalIndex}`
              const sectionItems = toRenderableArray(section?.items)
              const sectionSubsections = toRenderableArray(section?.subsections)

              const isExpanded = expandedSections.has(originalIndex)

              return (
                <div key={sectionIndex} id={sectionId} className="space-y-1 scroll-mt-20">
                  {/* Section Header */}
                  {isRecommended && (
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                        Recommended for you
                      </h2>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedSections(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(originalIndex)) {
                              newSet.delete(originalIndex)
                            } else {
                              newSet.add(originalIndex)
                            }
                            return newSet
                          })
                        }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <ChevronDown
                          className={`h-5 w-5 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'
                            }`}
                        />
                      </button>
                    </div>
                  )}
                  {!isRecommended && (
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                          {(section?.name && typeof section.name === 'string' && section.name.trim())
                            ? section.name.trim()
                            : (section?.title && typeof section.title === 'string' && section.title.trim())
                              ? section.title.trim()
                              : "Unnamed Section"}
                        </h2>
                        {section.subtitle && (
                          <button className="text-sm text-blue-600 dark:text-blue-400 underline">
                            {section.subtitle}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedSections(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(originalIndex)) {
                              newSet.delete(originalIndex)
                            } else {
                              newSet.add(originalIndex)
                            }
                            return newSet
                          })
                        }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <ChevronDown
                          className={`h-5 w-5 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'
                            }`}
                        />
                      </button>
                    </div>
                  )}

                  {/* Direct Items */}
                  {isExpanded && isRecommended && !loadingMenuItems && sectionItems.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
                        No dish recommended
                      </p>
                    </div>
                  )}
                  {isExpanded && loadingMenuItems && (
                    <div className="space-y-3 px-1 py-2 animate-pulse">
                      <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                      <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                    </div>
                  )}
                  {isExpanded && sectionItems.length > 0 && (
                    <div className="space-y-3">
                      {sectionItems.map((item) => {
                        const quantity = getDishQuantity(item)
                        // Determine veg/non-veg based on foodType
                        const isVeg = item.foodType === "Veg"
                        const isNonVeg = item.foodType === "Non-Veg"

                        // Debug: Log preparationTime for troubleshooting
                        if (item.preparationTime) {
                          debugLog(`[FRONTEND] Item "${item.name}" preparationTime:`, item.preparationTime, 'Type:', typeof item.preparationTime)
                        }

                        return (
                          <div
                            key={item.id}
                            ref={(node) => {
                              if (node) {
                                dishCardRefs.current[item.id] = node
                              } else {
                                delete dishCardRefs.current[item.id]
                              }
                            }}
                            className={`flex gap-4 p-4 relative cursor-pointer transition-all duration-500 ${highlightedDishId === item.id
                                ? "bg-gradient-to-r from-wh-brand-50/80 to-white dark:from-wh-brand/10 dark:to-[#1a1a1a] border-l-4 border-l-wh-brand shadow-[0_20px_50px_-12px_rgba(253,146,11,0.5)] scale-[1.02] z-20 rounded-3xl"
                                : "rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm"
                            }`}
                            onClick={() => handleItemClick(item)}
                          >
                            {highlightedDishId === item.id && (
                              <div className="absolute -top-2 left-4 z-30">
                                <span className="bg-wh-brand text-wh-text text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg animate-bounce uppercase tracking-wider">
                                  Selected
                                </span>
                              </div>
                            )}
                            {/* Left Side - Details */}
                            <div className="flex-1 min-w-0">
                              {/* Veg Icon & Spicy Indicator */}
                              <div className="flex items-center gap-2 mb-1">
                                {isVeg ? (
                                  <div className="w-4 h-4 border-2 flex items-center justify-center rounded-sm flex-shrink-0" style={{ borderColor: "#16a34a" }}>
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#16a34a" }}></div>
                                  </div>
                                ) : isNonVeg ? (
                                  <div className="w-4 h-4 border-2 border-red-600 flex items-center justify-center rounded-sm flex-shrink-0" style={{ borderColor: "#dc2626" }}>
                                    <div className="w-2 h-2 bg-red-600 rounded-full" style={{ backgroundColor: "#dc2626" }}></div>
                                  </div>
                                ) : null}
                                {item.isSpicy && <span className="text-xs font-semibold text-red-500">Spicy</span>}
                              </div>

                              <h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight">{item.name}</h3>
{item.stockNote && <p className="text-xs font-semibold text-rose-600 mt-0.5">{item.stockNote}</p>}

                              {/* Highly Reordered Progress Bar - Show if recommended */}
                              {isRecommendedItem(item) && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="h-1.5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-wh-brand w-3/4"></div>
                                  </div>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Highly reordered</span>
                                </div>
                              )}

                              <div className="flex items-center gap-3 mt-1">
                                <ProductPriceDisplay item={item} />
                                {/* Preparation Time - Show if available */}
                                {item.preparationTime && String(item.preparationTime).trim() && (
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                    <Clock size={12} className="text-gray-500" />
                                    <span>{String(item.preparationTime).trim()}</span>
                                  </div>
                                )}
                              </div>

                              {/* Description - Show if available */}
                              {item.description && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                              )}

                              {/* Mobile-only action buttons */}
                              <div className="flex gap-4 mt-3 md:hidden">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleBookmarkClick(item)
                                  }}
                                  className={`p-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isDishFavorite(item.id, seller?.sellerId || seller?._id || seller?.id)
                                    ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-900/20"
                                    : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                                    }`}
                                >
                                  <Bookmark
                                    size={18}
                                    className={isDishFavorite(item.id, seller?.sellerId || seller?._id || seller?.id) ? "fill-red-500" : ""}
                                  />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleShareClick(item)
                                  }}
                                  className="p-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <Share2 size={18} />
                                </button>
                              </div>

                            </div>

                            {/* Right Side - Image and Add Button */}
                            <div className={`relative w-32 flex-shrink-0 ${item.image ? "h-32" : "h-auto flex items-end justify-center"}`}>
                              {item.image ? (
                                <img
                                  src={item.image}
                                  alt={item.name}
                                  className="w-full h-full object-cover rounded-2xl shadow-sm"
                                  onError={(e) => {
                                    if (e.currentTarget.src !== PRODUCT_IMAGE_FALLBACK) {
                                      e.currentTarget.src = PRODUCT_IMAGE_FALLBACK
                                    }
                                  }}
                                />
                              ) : null}
                              {quantity > 0 ? (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  className={`${item.image ? "absolute -bottom-2 left-1/2 -translate-x-1/2" : "relative"} bg-white border font-bold px-4 py-1.5 rounded-lg shadow-md flex items-center gap-1 ${shouldShowGrayscale
                                    ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                    : 'border-wh-brand text-wh-brand-ink hover:bg-orange-50'
                                    }`}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!shouldShowGrayscale) {
                                        updateItemQuantity(item, Math.max(0, quantity - 1), e)
                                      }
                                    }}
                                    disabled={shouldShowGrayscale}
                                    className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-wh-brand-ink hover:text-wh-brand-ink'}
                                  >
                                    <Minus size={14} />
                                  </button>
                                  <span className={`mx-2 text-sm ${shouldShowGrayscale ? 'text-gray-400' : ''}`}>{quantity}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!shouldShowGrayscale) {
                                        updateItemQuantity(item, quantity + 1, e)
                                      }
                                    }}
                                    disabled={shouldShowGrayscale}
                                    className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-wh-brand-ink hover:text-wh-brand-ink'}
                                  >
                                    <Plus size={14} className="stroke-[3px]" />
                                  </button>
                                </motion.div>
                              ) : (
                                <motion.button
                                  layoutId={`add-button-${item.id}`}
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, type: "spring", damping: 20, stiffness: 300 }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!shouldShowGrayscale) {
                                      handleAddButtonClick(item, e)
                                    }
                                  }}
                                  disabled={shouldShowGrayscale}
                                  className={`${item.image ? "absolute -bottom-2 left-1/2 -translate-x-1/2" : "relative"} bg-white border font-bold px-6 py-1.5 rounded-lg shadow-md flex items-center gap-1 transition-colors ${shouldShowGrayscale
                                    ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                    : 'border-wh-brand text-wh-brand-ink hover:bg-orange-50'
                                    }`}
                                >
                                  ADD <Plus size={14} className="stroke-[3px]" />
                                </motion.button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Subsections */}
                  {isExpanded && sectionSubsections.length > 0 && (
                    <div className="space-y-4">
                      {sectionSubsections.map((subsection, subIndex) => {
                        const subsectionKey = `${originalIndex}-${subIndex}`
                        const isSubsectionExpanded = expandedSections.has(subsectionKey)
                        const subsectionItems = toRenderableArray(subsection?.items)

                        return (
                          <div key={subIndex} className="space-y-4">
                            {/* Subsection Header */}
                            <div className="flex items-center justify-between">
                              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {subsection?.name || subsection?.title || "Subsection"}
                              </h3>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpandedSections(prev => {
                                    const newSet = new Set(prev)
                                    if (newSet.has(subsectionKey)) {
                                      newSet.delete(subsectionKey)
                                    } else {
                                      newSet.add(subsectionKey)
                                    }
                                    return newSet
                                  })
                                }}
                                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                              >
                                <ChevronDown
                                  className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isSubsectionExpanded ? '' : '-rotate-90'
                                    }`}
                                />
                              </button>
                            </div>

                            {/* Subsection Items */}
                            {isSubsectionExpanded && subsectionItems.length > 0 && (
                              <div className="space-y-3">
                                {subsectionItems.map((item) => {
                                  const quantity = getDishQuantity(item)
                                  // Determine veg/non-veg based on foodType
                                  const isVeg = item.foodType === "Veg"
                                  const isNonVeg = item.foodType === "Non-Veg"

                                  // Debug: Log preparationTime for troubleshooting
                                  if (item.preparationTime) {
                                    debugLog(`[FRONTEND] Subsection item "${item.name}" preparationTime:`, item.preparationTime)
                                  }

                                  return (
                                    <div
                                      key={item.id}
                                      ref={(node) => {
                                        if (node) {
                                          dishCardRefs.current[item.id] = node
                                        } else {
                                          delete dishCardRefs.current[item.id]
                                        }
                                      }}
                                      className={`flex gap-4 p-4 relative cursor-pointer transition-all duration-500 ${highlightedDishId === item.id
                                        ? "bg-gradient-to-r from-wh-brand-50/80 to-white dark:from-wh-brand/10 dark:to-[#1a1a1a] border-l-4 border-l-wh-brand shadow-[0_20px_50px_-12px_rgba(253,146,11,0.5)] scale-[1.02] z-20 rounded-3xl"
                                        : "rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm"
                                    }`}
                                      onClick={() => handleItemClick(item)}
                                    >
                                      {highlightedDishId === item.id && (
                                        <div className="absolute -top-2 left-4 z-30">
                                          <span className="bg-wh-brand text-wh-text text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg animate-bounce uppercase tracking-wider">
                                            Selected
                                          </span>
                                        </div>
                                      )}
                                      {/* Left Side - Details */}
                                      <div className="flex-1 min-w-0">
                                        {/* Veg Icon & Spicy Indicator */}
                                        <div className="flex items-center gap-2 mb-1">
                                          {isVeg ? (
                                            <div className="w-4 h-4 border-2 flex items-center justify-center rounded-sm flex-shrink-0" style={{ borderColor: "#16a34a" }}>
                                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#16a34a" }}></div>
                                            </div>
                                          ) : isNonVeg ? (
                                            <div className="w-4 h-4 border-2 border-red-600 flex items-center justify-center rounded-sm flex-shrink-0" style={{ borderColor: "#dc2626" }}>
                                              <div className="w-2 h-2 bg-red-600 rounded-full" style={{ backgroundColor: "#dc2626" }}></div>
                                            </div>
                                          ) : null}
                                          {item.isSpicy && <span className="text-xs font-semibold text-red-500">Spicy</span>}
                                        </div>

                                        <h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight">{item.name}</h3>
{item.stockNote && <p className="text-xs font-semibold text-rose-600 mt-0.5">{item.stockNote}</p>}

                                        {/* Highly Reordered Progress Bar - Show if recommended */}
                                        {isRecommendedItem(item) && (
                                          <div className="flex items-center gap-2 mt-1">
                                            <div className="h-1.5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                              <div className="h-full bg-wh-brand w-3/4"></div>
                                            </div>
                                            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Highly reordered</span>
                                          </div>
                                        )}

                                        <div className="flex items-center gap-3 mt-1">
                                          <ProductPriceDisplay item={item} />
                                          {/* Preparation Time - Show if available */}
                                          {item.preparationTime && String(item.preparationTime).trim() && (
                                            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                              <Clock size={12} className="text-gray-500" />
                                              <span>{String(item.preparationTime).trim()}</span>
                                            </div>
                                          )}
                                        </div>

                                        {/* Description - Show if available */}
                                        {item.description && (
                                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                                        )}

                                        {/* Mobile-only action buttons */}
                                        <div className="flex gap-4 mt-3 md:hidden">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.preventDefault()
                                              e.stopPropagation()
                                              handleBookmarkClick(item)
                                            }}
                                            className={`p-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isDishFavorite(item.id, seller?.sellerId || seller?._id || seller?.id)
                                              ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-900/20"
                                              : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                                              }`}
                                          >
                                            <Bookmark
                                              size={18}
                                              className={isDishFavorite(item.id, seller?.sellerId || seller?._id || seller?.id) ? "fill-red-500" : ""}
                                            />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.preventDefault()
                                              e.stopPropagation()
                                              handleShareClick(item)
                                            }}
                                            className="p-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                          >
                                            <Share2 size={18} />
                                          </button>
                                        </div>

                                      </div>

                                      {/* Right Side - Image and Add Button */}
                                      <div className={`relative w-32 flex-shrink-0 ${item.image ? "h-32" : "h-auto flex items-end justify-center"}`}>
                                        {item.image ? (
                                          <img
                                            src={item.image}
                                            alt={item.name}
                                            className="w-full h-full object-cover rounded-2xl shadow-sm"
                                            onError={(e) => {
                                              if (e.currentTarget.src !== PRODUCT_IMAGE_FALLBACK) {
                                                e.currentTarget.src = PRODUCT_IMAGE_FALLBACK
                                              }
                                            }}
                                          />
                                        ) : null}
                                        {quantity > 0 ? (
                                          <motion.div
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            className={`${item.image ? "absolute -bottom-2 left-1/2 -translate-x-1/2" : "relative"} bg-white border font-bold px-4 py-1.5 rounded-lg shadow-md flex items-center gap-1 ${shouldShowGrayscale
                                              ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                              : 'border-wh-brand text-wh-brand-ink hover:bg-orange-50'
                                              }`}
                                          >
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                if (!shouldShowGrayscale) {
                                                  updateItemQuantity(item, Math.max(0, quantity - 1), e)
                                                }
                                              }}
                                              disabled={shouldShowGrayscale}
                                              className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-wh-brand-ink hover:text-wh-brand-ink'}
                                            >
                                              <Minus size={14} />
                                            </button>
                                            <span className={`mx-2 text-sm ${shouldShowGrayscale ? 'text-gray-400' : ''}`}>{quantity}</span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                if (!shouldShowGrayscale) {
                                                  updateItemQuantity(item, quantity + 1, e)
                                                }
                                              }}
                                              disabled={shouldShowGrayscale}
                                              className={shouldShowGrayscale ? 'text-gray-400 cursor-not-allowed' : 'text-wh-brand-ink hover:text-wh-brand-ink'}
                                            >
                                              <Plus size={14} className="stroke-[3px]" />
                                            </button>
                                          </motion.div>
                                        ) : (
                                          <motion.button
                                            layoutId={`add-button-sub-${item.id}`}
                                            initial={{ opacity: 0, scale: 0.9 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ duration: 0.3, type: "spring", damping: 20, stiffness: 300 }}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              if (!shouldShowGrayscale) {
                                                handleAddButtonClick(item, e)
                                              }
                                            }}
                                            disabled={shouldShowGrayscale}
                                            className={`${item.image ? "absolute -bottom-2 left-1/2 -translate-x-1/2" : "relative"} bg-white border font-bold px-6 py-1.5 rounded-lg shadow-md flex items-center gap-1 transition-colors ${shouldShowGrayscale
                                              ? 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                                              : 'border-wh-brand text-wh-brand-ink hover:bg-orange-50'
                                              }`}
                                          >
                                            ADD <Plus size={14} className="stroke-[3px]" />
                                          </motion.button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </div>
      </div>

      {/* FSSAI License Information - Bottom of page */}
      {seller?.onboarding?.step3?.fssai?.registrationNumber && (
        <div className="px-4 py-4 mt-2 mb-24 border-t border-dashed border-gray-200 dark:border-gray-800 bg-gray-50/30 dark:bg-white/5 mx-4 rounded-xl">
          <div className="flex items-center gap-4">
            <div className="h-12 w-20 flex items-center justify-center bg-white rounded-lg p-1.5 shadow-sm border border-gray-100">
              <img
                src={fssaiLogo}
                alt="FSSAI"
                className="h-full w-auto object-contain"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-bold mb-1">
                License No.
              </p>
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 font-mono tracking-wide">
                {seller?.onboarding?.step3?.fssai?.registrationNumber}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Menu Button - fixed bottom right; shifts up when cart bar is visible */}
      {typeof window !== "undefined" &&
        !showFilterSheet &&
        !showMenuSheet &&
        !showMenuOptionsSheet &&
        createPortal(
          <div
            className={`fixed right-4 z-[10000] transition-all duration-300 ease-out ${menuButtonBottomClass}`}
          >
            <button
              type="button"
              onClick={() => setShowMenuSheet(true)}
              className="flex h-[60px] w-[60px] flex-col items-center justify-center gap-0.5 rounded-full bg-[#1a1a1a] text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] hover:bg-black transition-colors"
              aria-label="Open menu categories"
            >
              <Utensils className="h-5 w-5" />
              <span className="text-[10px] font-bold tracking-wide">MENU</span>
            </button>
          </div>,
          document.body
        )}

      {/* Menu Categories Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowMenuSheet(false)}
                />

                {/* Menu Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="space-y-1">
                      {menuCategories.map((category, index) => (
                        <button
                          key={index}
                          className="w-full flex items-center justify-between py-3 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                          onClick={() => {
                            setShowMenuSheet(false)
                            // Scroll to category section
                            setTimeout(() => {
                              const sectionId = `menu-section-${category.sectionIndex}`
                              const sectionElement = document.getElementById(sectionId)
                              if (sectionElement) {
                                sectionElement.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start'
                                })
                              }
                            }, 300) // Small delay to allow sheet to close
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {category.image ? (
                              <img
                                src={category.image}
                                alt={category.name}
                                className="h-10 w-10 rounded-xl object-cover border border-gray-200"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none"
                                }}
                              />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold uppercase text-gray-500">
                                {category.name?.charAt(0) || "C"}
                              </span>
                            )}
                            <span className="text-base font-medium text-gray-900 dark:text-white truncate">
                              {category.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {category.count}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-[#1a1a1a] dark:bg-wh-brand hover:bg-wh-brand-600 dark:hover:bg-wh-brand-600 text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg"
                      onClick={() => setShowMenuSheet(false)}
                    >
                      <X className="h-5 w-5" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Filters and Sorting Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showFilterSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowFilterSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl h-[80vh] md:h-auto md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header with X button */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters and Sorting</h2>
                    <button
                      onClick={() => setShowFilterSheet(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    >
                      <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {/* Sort by */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sort by:</h3>
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "low-to-high" ? null : "low-to-high",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "low-to-high"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - low to high
                        </button>
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "high-to-low" ? null : "high-to-low",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "high-to-low"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - high to low
                        </button>
                      </div>
                    </div>

                    {/* Veg/Non-veg preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Veg/Non-veg preference:</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                            }))
                          }
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "veg"
                            ? ""
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                          style={filters.vegNonVeg === "veg" ? {
                            borderColor: "#16a34a",
                            backgroundColor: "#f0fdf4",
                            color: "#15803d",
                          } : undefined}
                        >
                          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: "#16a34a" }} />
                          <span className="font-medium">Veg</span>
                        </button>
                        {!vegMode && (
                          <button
                            onClick={() =>
                              setFilters((prev) => ({
                                ...prev,
                                vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                              }))
                            }
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "non-veg"
                              ? "border-red-600 dark:border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                              }`}
                            style={filters.vegNonVeg === "non-veg" ? {
                              borderColor: "#dc2626",
                              backgroundColor: "#fef2f2",
                              color: "#b91c1c",
                            } : undefined}
                          >
                            <div className="h-4 w-4 rounded-full bg-red-600 dark:bg-red-500" style={{ backgroundColor: "#dc2626" }} />
                            <span className="font-medium">Non-veg</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Top picks */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Top picks:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            highlyReordered: !prev.highlyReordered,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.highlyReordered
                          ? "border-wh-brand dark:border-wh-brand bg-[#FFF2EB] dark:bg-wh-brand/20 text-wh-brand-ink dark:text-wh-brand"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <RotateCcw className="h-4 w-4" />
                        <span className="font-medium">Highly reordered</span>
                      </button>
                    </div>

                    {/* Dietary preference */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dietary preference:</h3>
                      <button
                        onClick={() =>
                          setFilters((prev) => ({
                            ...prev,
                            spicy: !prev.spicy,
                          }))
                        }
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all w-full ${filters.spicy
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                      >
                        <Flame className="h-4 w-4" />
                        <span className="font-medium">Spicy</span>
                      </button>
                    </div>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between bg-white dark:bg-[#1a1a1a]">
                    <button
                      onClick={() => {
                        setFilters({
                          sortBy: null,
                          vegNonVeg: null,
                          highlyReordered: false,
                          spicy: false,
                        })
                      }}
                      className="text-red-600 dark:text-red-400 font-medium text-sm hover:text-red-700 dark:hover:text-red-500"
                    >
                      Clear All
                    </button>
                    <Button
                      className="bg-wh-brand hover:bg-wh-brand-600 text-wh-text px-6 py-2.5 rounded-lg font-bold"
                      onClick={() => setShowFilterSheet(false)}
                    >
                      Apply {activeFilterCount > 0 && `(${activeFilterCount})`}
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Location Outlets Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showLocationSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowLocationSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl h-[75vh] md:h-auto md:max-h-[90vh] md:max-w-xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">All delivery outlets for</p>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-600 dark:bg-red-500 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-base">{(seller.name || "R").charAt(0).toUpperCase()}</span>
                      </div>
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{seller?.name || "Unknown Seller"}</h2>
                    </div>
                  </div>

                  {/* Outlets List */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {seller?.outlets && Array.isArray(seller.outlets) && seller.outlets.length > 0 ? (
                      <div className="space-y-2">
                        {seller.outlets.map((outlet) => (
                          <div
                            key={outlet?.id || Math.random()}
                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a]"
                          >
                            {outlet?.isNearest && (
                              <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-[#FFF2EB] dark:bg-wh-brand/20 rounded-md">
                                <Zap className="h-3.5 w-3.5 text-wh-brand-ink dark:text-wh-brand fill-wh-brand dark:fill-wh-brand" />
                                <span className="text-xs font-semibold text-wh-brand-ink dark:text-wh-brand">
                                  Nearest available outlet
                                </span>
                              </div>
                            )}
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                              {outlet?.location || "Location"}
                            </h3>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{outlet?.deliveryTime || "25-30 mins"}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span>{outlet?.distance || "1.2 km"}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1">
                                  <Star className="h-3.5 w-3.5 text-green-600 dark:text-green-500 fill-green-600 dark:fill-green-500" />
                                  <span className="text-xs font-medium text-gray-900 dark:text-white">
                                    {outlet?.rating || 4.5}
                                  </span>
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  By {(outlet?.reviews || 0) >= 1000 ? `${((outlet.reviews || 0) / 1000).toFixed(1)}K+` : `${outlet?.reviews || 0}+`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No outlets available
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  {seller?.outlets && Array.isArray(seller.outlets) && seller.outlets.length > 5 && (
                    <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-[#1a1a1a]">
                      <button className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm w-full">
                        <span>See all {seller.outlets.length} outlets</span>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl md:max-w-lg w-full md:w-auto"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Manage Collections</h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2">
                    {/* Bookmarks Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Don't close modal on click, let checkbox handle it
                      }}
                    >
                      <div className="h-12 w-12 rounded-lg bg-wh-brand-50 dark:bg-wh-brand/10 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900 dark:text-white">Bookmarks</span>
                          {selectedItem && (
                            <Checkbox
                              checked={isDishFavorite(selectedItem.id, seller?.sellerId || seller?._id || seller?.id)}
                              onCheckedChange={(checked) => {
                                if (!checked && selectedItem) {
                                  const sellerId = seller?.sellerId || seller?._id || seller?.id
                                  removeDishFavorite(selectedItem.id, sellerId)
                                  setShowManageCollections(false)
                                }
                              }}
                              className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          {!selectedItem && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {getDishFavorites().length} dishes � {getFavorites().length} seller
                        </p>
                      </div>
                    </button>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}
                    >
                      <div className="h-12 w-12 rounded-lg bg-wh-brand-50 dark:bg-wh-brand/10 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900 dark:text-white">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4">
                    <Button
                      className="w-full bg-wh-brand hover:bg-wh-brand-600 text-wh-text py-3 rounded-lg font-bold"
                      onClick={() => {
                        setShowManageCollections(false)
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Item Detail Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showItemDetail && selectedItem && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowItemDetail(false)}
                />

                {/* Item Detail Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[90vh] md:max-w-2xl lg:max-w-3xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Top Center Above Popup with 4px gap */}
                  <div className="absolute -top-[44px] left-1/2 -translate-x-1/2 z-[10001]">
                    <motion.button
                      onClick={() => setShowItemDetail(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <X className="h-5 w-5 text-white" />
                    </motion.button>
                  </div>

                  {/* Image Section */}
                  <div className="relative w-full h-64 overflow-hidden rounded-t-3xl">
                    {selectedItem.image ? (
                      <img
                        src={selectedItem.image}
                        alt={selectedItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <span className="text-sm text-gray-400">No image available</span>
                      </div>
                    )}
                    {/* Bookmark Icon Overlay */}
                    <div className="absolute bottom-4 right-4 flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBookmarkClick(selectedItem)
                        }}
                        className={`h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${isDishFavorite(selectedItem.id, seller?.sellerId || seller?._id || seller?.id)
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400"
                          : "border-white dark:border-gray-800 bg-white/90 dark:bg-[#1a1a1a]/90 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2a2a2a]"
                          }`}
                      >
                        <Bookmark
                          className={`h-5 w-5 transition-all duration-300 ${isDishFavorite(selectedItem.id, seller?.sellerId || seller?._id || seller?.id) ? "fill-red-500 dark:fill-red-400" : ""
                            }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Item Name and Indicator */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-1">
                        {isVegDish(selectedItem) ? (
                          <div className="h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: "#16A34A", backgroundColor: "#F0FDF4" }}>
                            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#16A34A" }} />
                          </div>
                        ) : isNonVegDish(selectedItem) ? (
                          <div className="h-5 w-5 rounded border-2 border-red-600 bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                            <div className="h-2.5 w-2.5 rounded-full bg-red-600" />
                          </div>
                        ) : null}
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                          {selectedItem.name}
                        </h2>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                      {selectedItem.description}
                    </p>

                    {/* Highly Reordered Progress Bar */}
                    {isRecommendedItem(selectedItem) && (
                      <div className="flex items-center gap-2 mb-4">
                        <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 dark:bg-green-400 rounded-full" style={{ width: '50%' }} />
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap">
                          highly reordered
                        </span>
                      </div>
                    )}

                    {/* Not Eligible for Coupons */}
                    {selectedItem.notEligibleForCoupons && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-4">
                        NOT ELIGIBLE FOR COUPONS
                      </p>
                    )}

                    {hasProductVariants(selectedItem) && (
                      <VariantSelector
                        variants={getProductVariants(selectedItem)}
                        selectedVariantId={selectedVariantId}
                        onSelectVariant={setSelectedVariantId}
                        getVariantQuantity={(variantId) => getDishQuantity(selectedItem, variantId)}
                      />
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className={`border-t px-4 py-4 bg-white dark:bg-[#1a1a1a] ${hasProductVariants(selectedItem) ? "border-wh-brand/10 dark:border-wh-brand/20" : "border-gray-200 dark:border-gray-800"}`}>
                    {hasProductVariants(selectedItem) && (
                      <div className="mb-3 flex items-center justify-between rounded-xl bg-gray-50 dark:bg-[#222222] px-3 py-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          Adding to cart
                        </span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[65%] text-right">
                          {getVariantForDish(selectedItem, selectedVariantId)?.name || "Selected portion"}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      {/* Quantity Selector */}
                      <div className={`flex items-center gap-3 rounded-xl px-3 h-[44px] ${hasProductVariants(selectedItem)
                        ? "border-2 border-wh-brand/25 bg-[#FFF7F2] dark:bg-wh-brand/5"
                        : "border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-[#2a2a2a]"
                        } ${shouldShowGrayscale ? "opacity-50" : ""}`}>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                Math.max(0, getDishQuantity(selectedItem, selectedVariantId) - 1),
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={getDishQuantity(selectedItem, selectedVariantId) === 0 || shouldShowGrayscale}
                          className={`${shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed'
                            }`}
                        >
                          <Minus className="h-5 w-5" />
                        </button>
                        <span className={`text-lg font-semibold min-w-[2rem] text-center ${shouldShowGrayscale
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-900 dark:text-white'
                          }`}>
                          {getDishQuantity(selectedItem, selectedVariantId)}
                        </span>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                getDishQuantity(selectedItem, selectedVariantId) + 1,
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={shouldShowGrayscale}
                          className={shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                          }
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Add Item Button */}
                      <Button
                        className={`flex-1 h-[44px] rounded-xl font-semibold flex items-center justify-center gap-2 shadow-lg border-0 ${shouldShowGrayscale
                          ? '!bg-gray-300 dark:!bg-gray-700 !text-gray-500 dark:!text-gray-600 cursor-not-allowed opacity-50 shadow-none'
                          : hasProductVariants(selectedItem)
                            ? '!bg-wh-brand hover:!bg-wh-brand-600 !text-wh-text shadow-[0_8px_20px_-8px_rgba(253,146,11,0.65)]'
                            : '!bg-red-500 hover:!bg-red-600 !text-white shadow-red-500/25'
                          }`}
                        onClick={(e) => {
                          if (!shouldShowGrayscale) {
                            updateItemQuantity(
                              selectedItem,
                              getDishQuantity(selectedItem, selectedVariantId) + 1,
                              e,
                              getVariantForDish(selectedItem, selectedVariantId),
                            )
                            setShowItemDetail(false)
                          }
                        }}
                        disabled={shouldShowGrayscale}
                      >
                        <span>{hasProductVariants(selectedItem) ? "Add to cart" : "Add item"}</span>
                        <div className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-0.5">
                          {(() => {
                            const sellPrice = hasProductVariants(selectedItem)
                              ? Number(getVariantForDish(selectedItem, selectedVariantId)?.price || selectedItem.price) || 0
                              : Number(selectedItem.price) || 0
                            const comparePrice = hasProductVariants(selectedItem)
                              ? Number(getVariantForDish(selectedItem, selectedVariantId)?.otherPrice) ||
                                getProductDisplayOtherPrice(selectedItem)
                              : Number(selectedItem.otherPrice) ||
                                Number(selectedItem.originalPrice) ||
                                getProductDisplayOtherPrice(selectedItem)
                            const showStrike =
                              comparePrice > 0 && comparePrice > sellPrice
                            const discountPercent = showStrike
                              ? getProductDiscountPercent(null, sellPrice, comparePrice)
                              : 0
                            return (
                              <>
                                {showStrike ? (
                                  <span className="text-xs line-through text-white/70">
                                    {RUPEE_SYMBOL}{Math.round(comparePrice)}
                                  </span>
                                ) : null}
                                <span className="text-sm font-bold tabular-nums">
                                  {RUPEE_SYMBOL}{Math.round(sellPrice)}
                                </span>
                                {discountPercent > 0 ? (
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-white/95">
                                    {discountPercent}% OFF
                                  </span>
                                ) : null}
                              </>
                            )
                          })()}
                        </div>
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Schedule Delivery Time Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showScheduleSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowScheduleSheet(false)}
                />

                {/* Schedule Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[60vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Centered Overlapping */}
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                    <button
                      onClick={() => setShowScheduleSheet(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                    >
                      <X className="h-5 w-5 text-white" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 pt-10 pb-4">
                    {/* Title */}
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
                      Select your delivery time
                    </h2>

                    {/* Date Selection */}
                    <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                      {(() => {
                        const today = new Date()
                        const tomorrow = new Date(today)
                        tomorrow.setDate(tomorrow.getDate() + 1)
                        const dayAfter = new Date(today)
                        dayAfter.setDate(dayAfter.getDate() + 2)

                        const dates = [
                          { date: today, label: "Today" },
                          { date: tomorrow, label: "Tomorrow" },
                          { date: dayAfter, label: dayAfter.toLocaleDateString('en-US', { weekday: 'short' }) }
                        ]

                        return dates.map((item, index) => {
                          const dateStr = item.date.toISOString().split('T')[0]
                          const day = String(item.date.getDate()).padStart(2, '0')
                          const month = item.date.toLocaleDateString('en-US', { month: 'short' })
                          const isSelected = selectedDate === dateStr

                          return (
                            <button
                              key={index}
                              onClick={() => setSelectedDate(dateStr)}
                              className="flex flex-col items-center gap-0.5 flex-shrink-0 pb-1"
                            >
                              <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {day} {month} {item.label}
                              </span>
                              {isSelected && (
                                <div className="h-0.5 w-full bg-red-500 mt-0.5" />
                              )}
                            </button>
                          )
                        })
                      })()}
                    </div>

                    {/* Time Slot Selection */}
                    <div className="space-y-2 mb-4">
                      {["6:30 - 7 PM", "7 - 7:30 PM", "7:30 - 8 PM", "8 - 8:30 PM"].map((slot, index) => {
                        const isSelected = selectedTimeSlot === slot
                        return (
                          <button
                            key={index}
                            onClick={() => setSelectedTimeSlot(slot)}
                            className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${isSelected
                              ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600"
                              : "bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent"
                              }`}
                          >
                            <span className="text-sm font-medium">{slot}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Confirm Button - Fixed at bottom */}
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                    <Button
                      className="w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg font-semibold"
                      onClick={() => {
                        setShowScheduleSheet(false)
                        // Handle schedule confirmation
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Offers Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showOffersSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowOffersSheet(false)}
                />

                {/* Offers Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Offers at {seller?.name || "Unknown Seller"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Gold Exclusive Offer Section */}
                    {seller?.sellerOffers?.goldOffer && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                          {seller.sellerOffers.goldOffer?.title || "Gold exclusive offer"}
                        </h3>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 flex-1">
                            <Lock className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                {seller.sellerOffers.goldOffer?.description || "Free delivery above ₹99"}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {seller.sellerOffers.goldOffer?.unlockText || "join Gold to unlock"}
                              </p>
                            </div>
                          </div>
                          <Button
                            className="bg-red-500 hover:bg-red-600 text-white text-sm px-4 py-2 rounded-lg whitespace-nowrap"
                            onClick={() => {
                              // Handle add gold
                            }}
                          >
                            {seller.sellerOffers.goldOffer?.buttonText || "Add Gold - ₹1"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Seller Coupons Section */}
                    {seller?.sellerOffers?.coupons && Array.isArray(seller.sellerOffers.coupons) && seller.sellerOffers.coupons.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                          Seller coupons
                        </h3>
                        <div className="space-y-3">
                          {seller.sellerOffers.coupons.map((coupon, couponIndex) => {
                            const couponKey = coupon?.id || coupon?.code || `coupon-${couponIndex}`
                            const isExpanded = expandedCoupons.has(couponKey)
                            return (
                              <div
                                key={couponKey}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                              >
                                <button
                                  className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  onClick={() => {
                                    setExpandedCoupons((prev) => {
                                      const newSet = new Set(prev)
                                      if (newSet.has(couponKey)) {
                                        newSet.delete(couponKey)
                                      } else {
                                        newSet.add(couponKey)
                                      }
                                      return newSet
                                    })
                                  }}
                                >
                                  <Percent className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                  <div className="flex-1 text-left">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                      {coupon?.title || "Seller coupon"}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      Use code {coupon?.code || "N/A"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        // Copy code to clipboard
                                        if (coupon?.code) {
                                          navigator.clipboard.writeText(coupon.code)
                                        }
                                      }}
                                    >
                                      {coupon?.code || "Copy"}
                                    </button>
                                    <ChevronDown
                                      className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""
                                        }`}
                                    />
                                  </div>
                                </button>
                                {isExpanded && (
                                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      Terms and conditions apply
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-[#1a1a1a] dark:bg-wh-brand hover:bg-wh-brand-600 dark:hover:bg-wh-brand-600 text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg"
                      onClick={() => setShowOffersSheet(false)}
                    >
                      <X className="h-5 w-5" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Menu Options Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuOptionsSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowMenuOptionsSheet(false)}
                />

                {/* Menu Options Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[70vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {seller?.name || "Unknown Seller"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Menu Options List */}
                    <div className="space-y-1">
                      {/* Add to Collection */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleAddToCollection}
                      >
                        <Bookmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">
                          {isFavorite(seller?.slug || slug || "") ? "Remove from Collection" : "Add to Collection"}
                        </span>
                      </button>

                      {/* Share this seller */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleShareSeller}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">Share this seller</span>
                      </button>

                    </div>

                    {/* Disclaimer Text */}
                    <div className="mt-6 px-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Menu items, prices, photos and descriptions are set directly by the seller. In case you see any incorrect information, please report it to us.
                      </p>
                    </div>

                    {/* FSSAI License Information */}
                    {seller?.onboarding?.step3?.fssai?.registrationNumber && (
                      <div className="mt-4 px-2 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 opacity-80 mb-2">
                        <div className="h-8 w-14 flex items-center justify-center bg-white rounded p-1 border border-gray-100">
                          <img
                            src={fssaiLogo}
                            alt="FSSAI"
                            className="h-full w-auto object-contain"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                            Lic. No.
                          </p>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {seller?.onboarding?.step3?.fssai?.registrationNumber}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Handle */}
                  <div className="px-4 pb-2 pt-2 flex justify-center">
                    <div className="h-1 w-12 bg-gray-300 rounded-full" />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Add to Cart Animation Component - Rendered via Portal to prevent transform interference */}
      {typeof window !== "undefined" &&
        createPortal(
          <AddToCartAnimation
            bottomOffset={16}
            linkTo="/cart"
            hideOnPages={true}
            variant="bar"
          />,
          document.body
        )}
    </AnimatedPage>
  )
}

class SellerDetailsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    debugError("SellerDetails crashed:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <AnimatedPage>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Something went wrong
                </h2>
                <p className="text-sm text-gray-600 mb-4 max-w-md">
                  We could not load this seller page right now.
                </p>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Reload Page
                </Button>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )
    }

    return this.props.children
  }
}

export default function SellerDetails() {
  return (
    <SellerDetailsErrorBoundary>
      <SellerDetailsContent />
    </SellerDetailsErrorBoundary>
  )
}
