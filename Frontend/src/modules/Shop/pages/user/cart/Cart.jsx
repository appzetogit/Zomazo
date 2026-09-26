import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate } from "@shop/router"
import { Plus, Minus, ArrowLeft, ChevronRight, Clock, MapPin, Phone, FileText, Utensils, Tag, Percent, Share2, ChevronUp, ChevronDown, X, Check, Settings, CreditCard, Wallet, Building2, Sparkles, Banknote, Zap, CheckCircle2, MessageCircle, Send, Mail, Copy, Home, Briefcase, Pencil, Receipt, ShoppingCart, DoorOpen, PhoneOff, BellOff, Coins, Store, Truck, ShieldCheck, Trash2, ShoppingBag, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import confetti from "canvas-confetti"

import AnimatedPage from "@shop/components/user/AnimatedPage"
import { Button } from "@shop/components/ui/button"
import { isModuleAuthenticated } from "@shop/utils/auth"
import { useCart } from "@shop/context/CartContext"
import { useStoreMode } from "@shop/context/StoreModeContext"
import { useProfile } from "@shop/context/ProfileContext"
import { useOrders } from "@shop/context/OrdersContext"
import { useLocation as useUserLocation } from "@shop/hooks/useLocation"
import { useZone } from "@shop/hooks/useZone"
import { orderAPI, sellerAPI, adminAPI, userAPI, coinsAPI, API_ENDPOINTS } from "@shop/api"
import { API_BASE_URL } from "@shop/api/config"
import { catalogAPI } from "@shop/api"
import { resolveMediaUrl } from "@shop/platform/utils/mediaUrl"
import { CHANNEL_COPY, addToOtherStoreCart, channelAvailability, findUnavailableCartItem, otherChannel } from "@shop/utils/channelStock"
import { initRazorpayPayment } from "@shop/utils/razorpay"
import { toast } from "sonner"
import { getCompanyNameAsync } from "@shop/utils/businessSettings"
import { getCachedFeeSettings, loadCorePublicAppConfig } from "@shop/services/publicAppConfig"
import { useCompanyName } from "@shop/hooks/useCompanyName"
import { getSellerAvailabilityStatus } from "@shop/utils/sellerAvailability"
import useAppBackNavigation from "@shop/hooks/useAppBackNavigation"
import {
  calculateDistanceKm,
  normalizeLocationForPricing,
  normalizeSellerLocation,
} from "@shop/utils/geo"
import {
  fetchDrivingDistanceKm,
  fetchDrivingDistancesMatrix,
  formatDistanceLabel,
} from "@shop/utils/roadDistance"
import { computeDeliveryFeeGst, formatDeliveryFeeBreakdownSubtext, getDeliveryFeeTotal, resolveDeliveryFeeGst } from "@shop/utils/deliveryFeeDisplay"
import { getCartCompareItemTotal } from "@shop/utils/productVariants"
import { DualMoney } from "@shop/components/user/ProductPriceDisplay"
import {
  AUTO_COUPON_STATE_EVENT,
  getCartSignature,
  isManualCouponOptOut,
  markManualCouponOptOut,
  markUserSelectedCoupon,
} from "@shop/utils/autoCoupon"
import CartAutoCouponBanner from "@shop/components/user/CartAutoCouponBanner"
import RecommendationRail from "@shop/components/user/RecommendationRail"
import CartSubtotalCard from "@shop/components/user/desktop/CartSubtotalCard"
import SavedForLater, { saveCartLineForLater } from "@shop/components/user/cart/SavedForLater"
import CartSwitch from "@shop/components/user/cart/CartSwitch"
import useIsDesktop from "@shop/components/user/desktop/useIsDesktop"
import { formatDeliveryWindow, useQuickEta, useShopDeliveryEstimate } from "@shop/components/user/desktop/useDeliveryEstimates"
import zoopSound from "@shop/assets/audio/order-placed.mp3"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }



// Coupons will be fetched from backend based on items in cart

/**
 * Format full address string from address object
 * @param {Object} address - Address object with street, additionalDetails, city, state, zipCode, or formattedAddress
 * @returns {String} Formatted address string
 */
const formatFullAddress = (address) => {
  if (!address) return ""

  const looksLikeLatLng = (s) => {
    if (!s) return false
    const v = String(s).trim()
    // Matches "12.34, 56.78" (lat,lng) with optional decimals/spaces
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)
  }

  // Priority 1: Use formattedAddress if available (for live location addresses)
  if (address.formattedAddress && address.formattedAddress !== "Select location") {
    // If formattedAddress is still raw coordinates, don't show it as-is.
    // Fall back to composing from city/state/area instead.
    if (!looksLikeLatLng(address.formattedAddress)) {
      return address.formattedAddress
    }
  }

  // Priority 2: Build address from parts
  const addressParts = []
  if (address.street) addressParts.push(address.street)
  if (address.additionalDetails) addressParts.push(address.additionalDetails)
  if (address.city) addressParts.push(address.city)
  if (address.state) addressParts.push(address.state)
  if (address.zipCode) addressParts.push(address.zipCode)

  if (addressParts.length > 0) {
    // Saved addresses often repeat a value across street/city/state
    // ("Indore, Indore, Indore, Madhya Pradesh") — show each part once.
    const seen = new Set()
    const unique = addressParts.filter((part) => {
      const key = String(part).trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    return unique.join(', ')
  }

  // Priority 3: Use address field if available
  if (address.address && address.address !== "Select location") {
    return address.address
  }

  return ""
}

const RUPEE_SYMBOL = "\u20B9"
const CART_RECIPIENT_DETAILS_STORAGE_KEY = "store-cart-recipient-details-v1"
const CART_ORDER_NOTE_STORAGE_KEY = "store-cart-order-note-v1"
const CART_DELIVERY_PREFS_STORAGE_KEY = "store-cart-delivery-prefs-v1"
const RECIPIENT_NAME_REGEX = /^[A-Za-z ]+$/
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/

const PREDEFINED_DELIVERY_INSTRUCTIONS = [
  { id: "leave_at_door", label: "Leave at the door", Icon: DoorOpen },
  { id: "avoid_calling", label: "Avoid calling", Icon: PhoneOff },
  { id: "avoid_bell", label: "Avoid ringing bell", Icon: BellOff },
]

const getConfiguredQuickDeliveryFee = (feeSettings = {}) => {
  const configured = Number(feeSettings?.quickDeliveryFee)
  return Number.isFinite(configured) && configured >= 0 ? configured : 0
}

const buildDeliveryInstructionsText = ({
  deliveryInstructionMode = "preset",
  selectedDeliveryInstruction = null,
  customDeliveryInstruction = "",
}) => {
  if (deliveryInstructionMode === "custom") {
    return String(customDeliveryInstruction || "").trim()
  }
  if (!selectedDeliveryInstruction) return ""
  const preset = PREDEFINED_DELIVERY_INSTRUCTIONS.find((item) => item.id === selectedDeliveryInstruction)
  return preset?.label || ""
}

const clearCartInstructionStorage = () => {
  try {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
    window.localStorage.removeItem(CART_DELIVERY_PREFS_STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}

const resolveFallbackDeliveryFee = ({
  feeSettings = {},
  sellerData = null,
  defaultAddress = null,
  distanceKmOverride = null,
}) => {
  const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
    ? [...feeSettings.deliveryFeeRanges]
    : []
  const rangeFees = ranges
    .map((range) => Number(range?.fee))
    .filter((fee) => Number.isFinite(fee) && fee >= 0)

  const flat = Number(feeSettings.deliveryFee)
  const hasPositiveFlat = Number.isFinite(flat) && flat > 0

  const distanceKm = Number.isFinite(Number(distanceKmOverride))
    ? Number(distanceKmOverride)
    : calculateDistanceKm(sellerData, defaultAddress)
  if (Number.isFinite(distanceKm) && ranges.length > 0) {
      const sortedRanges = ranges.sort((a, b) => Number(a.min) - Number(b.min))
      for (let i = 0; i < sortedRanges.length; i += 1) {
        const range = sortedRanges[i]
        const min = Number(range.min)
        const max = Number(range.max)
        const fee = Number(range.fee)
        const isLastRange = i === sortedRanges.length - 1
        const inRange = isLastRange
          ? distanceKm >= min && distanceKm <= max
          : distanceKm >= min && distanceKm < max

        if (inRange && Number.isFinite(fee)) return fee
      }
  }

  if (rangeFees.length > 0) {
    return hasPositiveFlat ? flat : Math.min(...rangeFees)
  }

  return Number.isFinite(flat) && flat >= 0 ? flat : 0
}

const normalizeSellerForPricing = (seller) => {
  if (!seller || typeof seller !== "object") return seller
  if (!seller.location) return seller
  return {
    ...seller,
    location: normalizeSellerLocation(seller.location),
  }
}

const buildEffectiveCartPricing = ({
  cart = [],
  pricing = null,
  feeSettings = {},
  defaultAddress = null,
  sellerData = null,
  appliedCoupon = null,
  deliveryMode = "basic",
  roadDistanceKm = null,
}) => {
  const subtotal =
    pricing?.subtotal ||
    cart.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1), 0)

  const fallbackDeliveryFee = resolveFallbackDeliveryFee({
    feeSettings,
    sellerData,
    defaultAddress,
    distanceKmOverride: roadDistanceKm,
  })

  // When backend pricing is available, trust it so cart total matches payment amount.
  const hasServerPricing =
    pricing != null && Number.isFinite(Number(pricing.total)) && Number(pricing.total) >= 0

  if (hasServerPricing) {
    const serverDeliveryFee = Number(pricing.deliveryFee)
    const serverDeliveryFeeGst = Number(pricing.deliveryFeeGst)
    const serverPlatformFee = Number(pricing.platformFee)
    const serverTax = Number(pricing.tax)
    const serverDiscount = Number(pricing.discount)
    const serverTotal = Number(pricing.total)
    const quickDeliveryFee =
      deliveryMode === "quick"
        ? Number(pricing.quickDeliveryFee) || getConfiguredQuickDeliveryFee(feeSettings)
        : 0

    return {
      subtotal: Number.isFinite(Number(pricing.subtotal)) ? Number(pricing.subtotal) : subtotal,
      tax: Number.isFinite(serverTax) ? serverTax : 0,
      packagingFee: Number(pricing.packagingFee) || 0,
      deliveryFee: Number.isFinite(serverDeliveryFee) ? serverDeliveryFee : 0,
      deliveryFeeGst: Number.isFinite(serverDeliveryFeeGst)
        ? serverDeliveryFeeGst
        : computeDeliveryFeeGst(Number.isFinite(serverDeliveryFee) ? serverDeliveryFee : 0),
      platformFee: Number.isFinite(serverPlatformFee) ? serverPlatformFee : 0,
      quickDeliveryFee,
      discount: Number.isFinite(serverDiscount) ? serverDiscount : 0,
      total: serverTotal,
      savings: Number.isFinite(Number(pricing.savings))
        ? Number(pricing.savings)
        : Math.max(0, subtotal + (Number.isFinite(serverDeliveryFee) ? serverDeliveryFee : 0) + (Number.isFinite(serverDeliveryFeeGst) ? serverDeliveryFeeGst : 0) + (Number.isFinite(serverPlatformFee) ? serverPlatformFee : 0) + (Number.isFinite(serverTax) ? serverTax : 0) - serverTotal),
      couponCode: pricing?.couponCode || pricing?.appliedCoupon?.code || appliedCoupon?.code || "",
      deliveryFeeBreakdown: pricing?.deliveryFeeBreakdown || null,
      appliedCoupon: pricing?.appliedCoupon || appliedCoupon || null,
      deliveryMode: deliveryMode === "quick" ? "quick" : "basic",
    }
  }

  // Mirror of backend order-pricing: discount clamped to subtotal, GST on post-discount base.
  const deliveryFee = fallbackDeliveryFee
  const deliveryFeeGst = computeDeliveryFeeGst(deliveryFee)
  const basePlatformFee = Number(feeSettings.platformFee || 0)
  const quickDeliveryFee = deliveryMode === "quick" ? getConfiguredQuickDeliveryFee(feeSettings) : 0
  const platformFee = basePlatformFee + quickDeliveryFee
  const discount = appliedCoupon
    ? Math.max(0, Math.min(Math.floor(Number(appliedCoupon.discount) || 0), subtotal))
    : 0
  const gstCharges = Math.round(Math.max(0, subtotal - discount) * (Number(feeSettings.gstRate || 0) / 100))
  const totalBeforeDiscount = subtotal + deliveryFee + deliveryFeeGst + platformFee + gstCharges
  const total = Math.max(0, subtotal + deliveryFee + deliveryFeeGst + platformFee + gstCharges - discount)
  const savings = Math.max(0, totalBeforeDiscount - total)

  return {
    subtotal,
    tax: gstCharges,
    packagingFee: 0,
    deliveryFee,
    deliveryFeeGst,
    platformFee,
    quickDeliveryFee,
    discount,
    total,
    savings,
    couponCode: appliedCoupon?.code || "",
    deliveryFeeBreakdown: null,
    appliedCoupon: appliedCoupon || null,
    deliveryMode: deliveryMode === "quick" ? "quick" : "basic",
  }
}

export default function Cart() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const orderSuccessAudioRef = useRef(null)
  const hasRestoredRecipientRef = useRef(false)
  const appliedCouponRef = useRef(null)

  // Defensive check: Ensure CartProvider is available
  let cartContext;
  try {
    cartContext = useCart();
  } catch (error) {
    debugError('? CartProvider not found. Make sure Cart component is rendered within UserLayout.');
    // Return early with error message
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] dark:bg-[#0a0a0a]">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Cart Error</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cart functionality is not available. Please refresh the page.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  const { cart, updateQuantity, getCartCount, clearCart, cleanCartForSeller, replaceCart, removeFromCart } = cartContext;
  const { getDefaultAddress, getDefaultPaymentMethod, setDefaultAddress, addresses, paymentMethods, userProfile } = useProfile()
  const { createOrder } = useOrders()
  const isDesktop = useIsDesktop()
  const { location: currentLocation, loading: currentLocationLoading } = useUserLocation() // Get live location address

  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponCode, setCouponCode] = useState("")
  const [manualCouponCode, setManualCouponCode] = useState("")
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("razorpay")
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [showAddressSheet, setShowAddressSheet] = useState(false)
  const [showNoteSheet, setShowNoteSheet] = useState(false)
  const [showOffersView, setShowOffersView] = useState(false)
  const { fulfilmentMode: storeFulfilmentMode, storePath } = useStoreMode()
  const inQuick = storeFulfilmentMode === "quick"
  const quickEta = useQuickEta()
  const shopEstimate = useShopDeliveryEstimate({ enabled: !inQuick })
  const deliveryBadge = inQuick
    ? `In ${quickEta} min`
    : shopEstimate?.maxDays
      ? `Get by ${shopEstimate.minDays}-${shopEstimate.maxDays} days`
      : "Get by 2-4 days"
  const [deliverySectionTab, setDeliverySectionTab] = useState("instructions")
  const [deliveryMode, setDeliveryMode] = useState("basic")
  const [selectedDeliveryInstruction, setSelectedDeliveryInstruction] = useState(null)
  const [deliveryInstructionMode, setDeliveryInstructionMode] = useState("preset")
  const [customDeliveryInstruction, setCustomDeliveryInstruction] = useState("")
  const [walletBalance, setWalletBalance] = useState(0)
  const [isLoadingWallet, setIsLoadingWallet] = useState(false)
  const [coinBalance, setCoinBalance] = useState({ coins: 0, usable: 0, usableValue: 0, isEnabled: false })
  const [useCoins, setUseCoins] = useState(false)
  // The server's price for a split checkout (several stores, courier delivery,
  // or coins). When present, the cart shows it, since it is what is charged.
  const [checkoutQuote, setCheckoutQuote] = useState(null)
  const [isLoadingCoins, setIsLoadingCoins] = useState(false)
  const [note, setNote] = useState("")
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [isEditingRecipient, setIsEditingRecipient] = useState(false)
  const [recipientDetails, setRecipientDetails] = useState({
    name: "",
    phone: "",
  })

  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  // A cart line the server refused at checkout because it isn't sold in this
  // store's channel: { item, message, altAvailable: null (checking) | boolean }.
  const [unavailableLine, setUnavailableLine] = useState(null)
  const [showBillDetails, setShowBillDetails] = useState(true)
  const [showPlacingOrder, setShowPlacingOrder] = useState(false)
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [orderProgress, setOrderProgress] = useState(0)
  const [showOrderSuccess, setShowOrderSuccess] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState(null)
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    try {
      if (typeof window === "undefined") return "saved"
      return localStorage.getItem("deliveryAddressMode") || "saved"
    } catch {
      return "saved"
    }
  })

  useEffect(() => {
    const audio = new Audio(zoopSound)
    audio.preload = "auto"
    audio.volume = 0.8
    orderSuccessAudioRef.current = audio

    return () => {
      if (orderSuccessAudioRef.current) {
        orderSuccessAudioRef.current.pause()
        orderSuccessAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showOrderSuccess || !orderSuccessAudioRef.current) return

    orderSuccessAudioRef.current.currentTime = 0
    orderSuccessAudioRef.current.play().catch((error) => {
      debugWarn("Order success sound blocked by browser:", error?.message || error)
    })
  }, [showOrderSuccess])

  // Seller and pricing state
  const [sellerData, setSellerData] = useState(null)
  const [loadingSeller, setLoadingSeller] = useState(false)
  const [pricing, setPricing] = useState(null)
  const [loadingPricing, setLoadingPricing] = useState(false)
  // Same Google road Rest→User distance as Home / delivery (overrides Haversine 6.9).
  const [roadDistanceKm, setRoadDistanceKm] = useState(null)
  const [addressRoadKmById, setAddressRoadKmById] = useState({})

  // Coupons state - fetched from backend
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [loadingCoupons, setLoadingCoupons] = useState(false)
  const [userOrderCount, setUserOrderCount] = useState(0)
  const [availabilityTick, setAvailabilityTick] = useState(() => Date.now())

  useEffect(() => {
    appliedCouponRef.current = appliedCoupon
  }, [appliedCoupon])

  useEffect(() => {
    const onAutoCouponState = (event) => {
      const detail = event?.detail || {}
      const resolvedSellerId =
        sellerData?.sellerId || sellerData?._id || cart[0]?.sellerId
      const cartSignature = getCartSignature(cart)

      if (!resolvedSellerId || !cart.length) return
      if (isManualCouponOptOut(resolvedSellerId, cartSignature)) return

      if (detail.action === "clear") {
        if (appliedCouponRef.current?.autoApplied) {
          setAppliedCoupon(null)
          setCouponCode("")
          setManualCouponCode("")
        }
        if (detail.pricing) setPricing(detail.pricing)
        return
      }

      if (detail.action !== "apply" || !detail.coupon || !detail.code) return

      const nextCode = String(detail.code).toUpperCase()
      if (appliedCouponRef.current?.code === nextCode) {
        if (detail.pricing) setPricing(detail.pricing)
        return
      }

      setAppliedCoupon({
        ...detail.coupon,
        discount: Number(detail.savings ?? detail.coupon.discount) || 0,
        autoApplied: true,
      })
      setCouponCode(nextCode)
      setManualCouponCode(nextCode)
      if (detail.pricing) setPricing(detail.pricing)
    }

    window.addEventListener(AUTO_COUPON_STATE_EVENT, onAutoCouponState)
    return () => window.removeEventListener(AUTO_COUPON_STATE_EVENT, onAutoCouponState)
  }, [cart, sellerData])

  // Fee settings from database (used for platform fee and GST fallback only)
  const [feeSettings, setFeeSettings] = useState({
    deliveryFee: 0,
    deliveryFeeRanges: [],
    platformFee: 0,
    quickDeliveryFee: 0,
    gstRate: 0,
  })

  const configuredQuickDeliveryFee = getConfiguredQuickDeliveryFee(feeSettings)
  // Priority is a paid rider option. A Shop order goes by courier and cannot
  // arrive faster, and without a fee set there is nothing to choose between.
  const hasDeliveryModes = inQuick && configuredQuickDeliveryFee > 0
  useEffect(() => {
    if (hasDeliveryModes) setDeliverySectionTab((tab) => (tab === "instructions" ? "modes" : tab))
    else {
      setDeliveryMode("basic")
      setDeliverySectionTab("instructions")
    }
  }, [hasDeliveryModes])

  const resetCartPreferences = useCallback(() => {
    setNote("")
    setShowNoteInput(false)
    setDeliveryMode("basic")
    setDeliverySectionTab("modes")
    setSelectedDeliveryInstruction(null)
    setDeliveryInstructionMode("preset")
    setCustomDeliveryInstruction("")
    clearCartInstructionStorage()
  }, [])

  const deliveryInstructionText = useMemo(
    () =>
      buildDeliveryInstructionsText({
        deliveryInstructionMode,
        selectedDeliveryInstruction,
        customDeliveryInstruction,
      }),
    [deliveryInstructionMode, selectedDeliveryInstruction, customDeliveryInstruction],
  )

  // Cash on Delivery has been removed; coerce any stale selection to online payment.
  useEffect(() => {
    if (selectedPaymentMethod === "cash") {
      setSelectedPaymentMethod("razorpay")
    }
  }, [selectedPaymentMethod])

  useEffect(() => {
    const timer = setInterval(() => setAvailabilityTick(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const scheduledOrderAt = useMemo(() => {
    if (!isScheduled || !scheduledDate || !scheduledTime) return null
    const scheduleDate = new Date(`${scheduledDate}T${scheduledTime}:00`)
    return Number.isNaN(scheduleDate.getTime()) ? null : scheduleDate
  }, [isScheduled, scheduledDate, scheduledTime])

  const cartSellerAvailability = useMemo(() => {
    if (!sellerData) return { isOpen: false, reason: "loading" }
    const targetDate = scheduledOrderAt || new Date(availabilityTick)
    return getSellerAvailabilityStatus(sellerData, targetDate)
  }, [sellerData, availabilityTick, scheduledOrderAt])

  const canPlaceOrder = Boolean(sellerData) && cartSellerAvailability.isOpen === true


  const availableTimeSlots = useMemo(() => {
    if (!isScheduled || !scheduledDate || !sellerData) return []

    try {
      const targetDate = new Date(scheduledDate)
      const status = getSellerAvailabilityStatus(sellerData, targetDate)

      let openingHour = 9
      let closingHour = 22

      if (status.openingTime) {
        const [h] = status.openingTime.split(':')
        openingHour = parseInt(h, 10)
      }

      if (status.closingTime) {
        const [h] = status.closingTime.split(':')
        closingHour = parseInt(h, 10)
      }

      if (closingHour < openingHour) {
        closingHour += 24 // Handle overnight slots
      }

      const slots = []
      const now = new Date()
      // Fix timezone date comparison by comparing date strings YYYY-MM-DD
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
      const targetStr = scheduledDate
      const isToday = targetStr === nowStr
      const currentHour = now.getHours()

      for (let h = openingHour; h <= closingHour; h++) {
        const actualHour = h % 24
        // Skip past hours if today. Add 1 hour buffer so they can't order right at the boundary
        if (isToday && h <= currentHour) continue

        const period = actualHour >= 12 ? 'PM' : 'AM'
        const display12 = actualHour % 12 || 12
        const timeString = `${String(actualHour).padStart(2, '0')}:00`
        const displayString = `${display12}:00 ${period}`

        slots.push({ value: timeString, label: displayString })
      }

      return slots
    } catch {
      return []
    }
  }, [isScheduled, scheduledDate, sellerData])

  // Reset scheduledTime if it's no longer valid in the new slots
  useEffect(() => {
    if (isScheduled && availableTimeSlots.length > 0) {
      const isValid = availableTimeSlots.some(slot => slot.value === scheduledTime)
      if (!isValid) {
        setScheduledTime(availableTimeSlots[0].value)
      }
    } else if (!isScheduled) {
      setScheduledDate("")
      setScheduledTime("")
    }
  }, [isScheduled, availableTimeSlots, scheduledTime])

  const cartCount = getCartCount()
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    if (!label) return ""
    const value = String(label).trim().toLowerCase()
    if (value === "work" || value === "office") return "office"
    if (value === "home") return "home"
    if (value === "other") return "other"
    return value
  }
  const getDisplayAddressLabel = (label) => {
    const normalized = normalizeAddressLabel(label)
    if (normalized === "office") return "Work"
    if (normalized === "home") return "Home"
    if (normalized === "other") return "Other"
    return label || "Saved address"
  }
  const sanitizeRecipientName = (value) => String(value || "").replace(/[^A-Za-z ]/g, "").replace(/\s+/g, " ")
  const sanitizeRecipientPhone = (value) => String(value || "").replace(/\D/g, "").slice(0, 10)
  const isValidRecipientName = (value) => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim()
    return normalized.length >= 2 && RECIPIENT_NAME_REGEX.test(normalized)
  }
  const isValidIndianMobile = (value) => INDIAN_MOBILE_REGEX.test(String(value || ""))
  const savedAddress = getDefaultAddress()
  const selectedAddress = addresses.find((addr) => getAddressId(addr) && getAddressId(addr) === selectedAddressId)

  const currentLocationAddress = useMemo(() => {
    // `LocationSelectorOverlay` updates backend + localStorage, but Cart's live hook might lag.
    // So we fall back to `localStorage.userLocation` when `currentLocation` doesn't have a usable payload yet.
    let locFromStorage = null
    try {
      const storedRaw = localStorage.getItem("userLocation")
      locFromStorage = storedRaw ? JSON.parse(storedRaw) : null
    } catch {
      locFromStorage = null
    }

    const loc = currentLocation?.latitude && currentLocation?.longitude ? currentLocation : locFromStorage
    if (!loc?.latitude || !loc?.longitude) return null

    const formattedAddress = loc?.formattedAddress || loc?.address || ""
    if (!formattedAddress || formattedAddress === "Select location") return null

    return {
      // Backend deliveryAddressSchema expects label in ['Home','Office','Other'].
      label: "Home",
      formattedAddress,
      address: formattedAddress,
      street: loc?.street || loc?.address || loc?.area || "Current Location",
      additionalDetails: loc?.area || "",
      city: loc?.city || loc?.area || "Current City",
      state: loc?.state || loc?.city || "Current State",
      zipCode: loc?.postalCode || loc?.zipCode || "",
      phone: userProfile?.phone || "",
      location: {
        type: "Point",
        coordinates: [loc.longitude, loc.latitude], // [lng, lat]
      },
    }
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    currentLocation?.formattedAddress,
    currentLocation?.address,
    currentLocation?.street,
    currentLocation?.area,
    currentLocation?.city,
    currentLocation?.state,
    currentLocation?.postalCode,
    currentLocation?.zipCode,
    userProfile?.phone,
    // Re-evaluate derived address when mode changes (overlay closes -> Cart rerenders).
    deliveryAddressMode,
  ])

  const defaultAddress = useMemo(() => {
    return deliveryAddressMode === "current"
      ? currentLocationAddress || selectedAddress || savedAddress || null
      : selectedAddress || savedAddress || currentLocationAddress || null
  }, [deliveryAddressMode, currentLocationAddress, selectedAddress, savedAddress])

  const pricingAddress = useMemo(
    () => normalizeLocationForPricing(defaultAddress),
    [defaultAddress],
  )

  const hasSavedAddress = Boolean(defaultAddress && formatFullAddress(defaultAddress))
  const recipientName = String(recipientDetails.name || "").trim() || userProfile?.name || "Your Name"
  const recipientPhone = sanitizeRecipientPhone(recipientDetails.phone || "") || userProfile?.phone || ""
  const selectedAddressCoordinates = defaultAddress?.location?.coordinates
  const zoneLocation = selectedAddressCoordinates?.length === 2
    ? {
      latitude: selectedAddressCoordinates[1],
      longitude: selectedAddressCoordinates[0]
    }
    : currentLocation
  const { zoneId } = useZone(zoneLocation) // Prefer selected/saved address zone
  const defaultPayment = getDefaultPaymentMethod()

  useEffect(() => {
    // Sync delivery mode from overlay/localStorage changes.
    // No dependency array: overlay open/close re-renders Cart via provider state update,
    // even when GPS coords don't move enough to update `currentLocation`.
    try {
      const mode = localStorage.getItem("deliveryAddressMode") || "saved"
      setDeliveryAddressMode((prev) => (prev === mode ? prev : mode))
    } catch {
      // ignore
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const raw = window.localStorage.getItem(CART_RECIPIENT_DETAILS_STORAGE_KEY)
      if (!raw) {
        hasRestoredRecipientRef.current = true
        return
      }

      const stored = JSON.parse(raw)
      setRecipientDetails({
        name: stored?.name || "",
        phone: sanitizeRecipientPhone(stored?.phone || ""),
      })
      setIsEditingRecipient(Boolean(stored?.isEditingRecipient))
    } catch {
      setRecipientDetails({ name: "", phone: "" })
      setIsEditingRecipient(false)
    } finally {
      hasRestoredRecipientRef.current = true
    }
  }, [])

  useEffect(() => {
    setRecipientDetails((prev) => ({
      name: prev.name || userProfile?.name || "",
      phone: prev.phone || userProfile?.phone || "",
    }))
  }, [userProfile?.name, userProfile?.phone])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredRecipientRef.current) return

    try {
      window.localStorage.setItem(
        CART_RECIPIENT_DETAILS_STORAGE_KEY,
        JSON.stringify({
          name: recipientDetails.name || "",
          phone: sanitizeRecipientPhone(recipientDetails.phone || ""),
          isEditingRecipient,
        })
      )
    } catch {
      // Ignore storage errors and keep cart flow working.
    }
  }, [recipientDetails, isEditingRecipient])

  const handleRecipientEditToggle = () => {
    if (!isEditingRecipient) {
      setIsEditingRecipient(true)
      return
    }

    const normalizedName = String(recipientDetails.name || "").replace(/\s+/g, " ").trim()
    const normalizedPhone = sanitizeRecipientPhone(recipientDetails.phone || "")

    if (!isValidRecipientName(normalizedName)) {
      toast.error("Name should contain only letters and spaces")
      return
    }
    if (!isValidIndianMobile(normalizedPhone)) {
      toast.error("Enter a valid 10-digit Indian mobile number")
      return
    }

    setRecipientDetails((prev) => ({
      ...prev,
      name: normalizedName,
      phone: normalizedPhone,
    }))
    setIsEditingRecipient(false)
  }

  useEffect(() => {
    if (deliveryAddressMode === "current") {
      setSelectedAddressId(null)
    }
  }, [deliveryAddressMode])

  useEffect(() => {
    const defaultId = getAddressId(savedAddress)
    if (deliveryAddressMode !== "current" && !selectedAddressId && defaultId) {
      setSelectedAddressId(defaultId)
    }
  }, [savedAddress, selectedAddressId, deliveryAddressMode])

  // Get seller ID from cart or seller data
  // Priority: sellerData > cart[0].sellerId
  // DO NOT use cart[0].seller as slug fallback - it creates wrong slugs
  const sellerId = cart.length > 0
    ? (sellerData?._id || sellerData?.sellerId || cart[0]?.sellerId || null)
    : null



  // Lock body scroll and scroll to top when any full-screen modal opens
  useEffect(() => {
    if (showPlacingOrder || showOrderSuccess) {
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${window.scrollY}px`

      // Scroll window to top
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else {
      // Restore body scroll
      const scrollY = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1)
      }
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
    }
  }, [showPlacingOrder, showOrderSuccess])

  // Fetch seller data when cart has items
  useEffect(() => {
    const fetchSellerData = async () => {
      if (cart.length === 0) {
        setSellerData(null)
        return
      }

      // If we already have sellerData, don't fetch again
      if (sellerData) {
        return
      }

      setLoadingSeller(true)

      // Strategy 1: Try using sellerId from cart if available
      if (cart[0]?.sellerId) {
        try {
          const cartSellerId = cart[0].sellerId;
          const cartSellerName = cart[0].seller;

          debugLog("?? Fetching seller data by sellerId from cart:", cartSellerId)
          const response = await sellerAPI.getSellerById(cartSellerId)
          const data = response?.data?.data?.seller || response?.data?.seller

          if (data) {
            // CRITICAL: Validate that fetched seller matches cart items
            const fetchedSellerId = data.sellerId || data._id?.toString();
            const fetchedSellerName = data.name;

            // Check if sellerId matches
            const sellerIdMatches =
              fetchedSellerId === cartSellerId ||
              data._id?.toString() === cartSellerId ||
              data.sellerId === cartSellerId;

            // Check if seller name matches (if available in cart)
            const sellerNameMatches =
              !cartSellerName ||
              fetchedSellerName?.toLowerCase().trim() === cartSellerName.toLowerCase().trim();

            if (!sellerIdMatches) {
              debugError('? CRITICAL: Fetched seller ID does not match cart sellerId!', {
                cartSellerId: cartSellerId,
                fetchedSellerId: fetchedSellerId,
                fetched_id: data._id?.toString(),
                fetched_sellerId: data.sellerId,
                cartSellerName: cartSellerName,
                fetchedSellerName: fetchedSellerName
              });
              // Don't set sellerData if IDs don't match - this prevents wrong seller assignment
              setLoadingSeller(false);
              return;
            }

            if (!sellerNameMatches) {
              debugWarn('?? WARNING: Seller name mismatch:', {
                cartSellerName: cartSellerName,
                fetchedSellerName: fetchedSellerName
              });
              // Still proceed but log warning
            }

            debugLog("? Seller data loaded from cart sellerId:", {
              _id: data._id,
              sellerId: data.sellerId,
              name: data.name,
              cartSellerId: cartSellerId,
              cartSellerName: cartSellerName
            })
            setSellerData(normalizeSellerForPricing(data))
            setLoadingSeller(false)
            return
          }
        } catch (error) {
          debugWarn("?? Failed to fetch by cart sellerId, trying fallback...", error)
        }
      }

      // Strategy 2: If no sellerId in cart, search by seller name
      if (cart[0]?.seller && !sellerData) {
        try {
          debugLog("?? Searching seller by name:", cart[0].seller)
          const searchResponse = await sellerAPI.getSellers({ limit: 100 })
          const sellers = searchResponse?.data?.data?.sellers || searchResponse?.data?.data || []
          debugLog("?? Fetched", sellers.length, "sellers for name search")

          // Try exact match first
          let matchingSeller = sellers.find(r =>
            r.name?.toLowerCase().trim() === cart[0].seller?.toLowerCase().trim()
          )

          // If no exact match, try partial match
          if (!matchingSeller) {
            debugLog("?? No exact match, trying partial match...")
            matchingSeller = sellers.find(r =>
              r.name?.toLowerCase().includes(cart[0].seller?.toLowerCase().trim()) ||
              cart[0].seller?.toLowerCase().trim().includes(r.name?.toLowerCase())
            )
          }

          if (matchingSeller) {
            // CRITICAL: Validate that the found seller matches cart items
            const cartSellerName = cart[0]?.seller?.toLowerCase().trim();
            const foundSellerName = matchingSeller.name?.toLowerCase().trim();

            if (cartSellerName && foundSellerName && cartSellerName !== foundSellerName) {
              debugError("? CRITICAL: Seller name mismatch!", {
                cartSellerName: cart[0]?.seller,
                foundSellerName: matchingSeller.name,
                cartSellerId: cart[0]?.sellerId,
                foundSellerId: matchingSeller.sellerId || matchingSeller._id
              });
              // Don't set sellerData if names don't match - this prevents wrong seller assignment
              setLoadingSeller(false);
              return;
            }

            debugLog("? Found seller by name:", {
              name: matchingSeller.name,
              _id: matchingSeller._id,
              sellerId: matchingSeller.sellerId,
              slug: matchingSeller.slug,
              cartSellerName: cart[0]?.seller
            })
            setSellerData(normalizeSellerForPricing(matchingSeller))
            setLoadingSeller(false)
            return
          } else {
            debugWarn("?? Seller not found even by name search. Searched in", sellers.length, "sellers")
            if (sellers.length > 0) {
              debugLog("?? Available seller names:", sellers.map(r => r.name).slice(0, 10))
            }
          }
        } catch (searchError) {
          debugWarn("?? Error searching sellers by name:", searchError)
        }
      }

      // If all strategies fail, set to null
      setSellerData(null)
      setLoadingSeller(false)
    }

    fetchSellerData()
  }, [cart.length, cart[0]?.sellerId, cart[0]?.seller])

  // Keep seller online/offline status fresh while user stays on cart
  useEffect(() => {
    const cartSellerId = cart[0]?.sellerId
    if (!cartSellerId || cart.length === 0) return

    const refreshSellerStatus = async () => {
      try {
        const response = await sellerAPI.getSellerById(cartSellerId)
        const data = response?.data?.data?.seller || response?.data?.seller
        if (data) setSellerData(normalizeSellerForPricing(data))
      } catch (error) {
        debugWarn("Failed to refresh seller status:", error)
      }
    }

    refreshSellerStatus()
    const intervalId = setInterval(refreshSellerStatus, 60000)
    const handleFocus = () => refreshSellerStatus()
    window.addEventListener("focus", handleFocus)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener("focus", handleFocus)
    }
  }, [cart.length, cart[0]?.sellerId])

  // Fetch coupons for items in cart
  useEffect(() => {
    const fetchCouponsForCartItems = async () => {
      if (cart.length === 0 || !sellerId) {
        setAvailableCoupons([])
        return
      }

      debugLog(`[CART-COUPONS] Fetching coupons for ${cart.length} items in cart`)
      setLoadingCoupons(true)

      const allCoupons = []
      const uniqueCouponCodes = new Set()

      // Fetch coupons for each item in cart
      for (const cartItem of cart) {
        const couponItemId = cartItem.itemId || cartItem.id
        if (!couponItemId) {
          debugLog(`[CART-COUPONS] Skipping item without id:`, cartItem)
          continue
        }

        try {
          debugLog(`[CART-COUPONS] Fetching coupons for itemId: ${couponItemId}, name: ${cartItem.name}`)
          const response = await sellerAPI.getCouponsByItemIdPublic(sellerId, couponItemId, subtotal)

          if (response?.data?.success && response?.data?.data?.coupons) {
            const coupons = response.data.data.coupons
            debugLog(`[CART-COUPONS] Found ${coupons.length} coupons for item ${couponItemId}`)

            // Add coupons, avoiding duplicates
            coupons.forEach(coupon => {
              if (!uniqueCouponCodes.has(coupon.couponCode)) {
                uniqueCouponCodes.add(coupon.couponCode)
                // Convert backend coupon format to frontend format
                allCoupons.push({
                  code: coupon.couponCode,
                  discount: coupon.originalPrice - coupon.discountedPrice,
                  discountPercentage: coupon.discountPercentage,
                  discountDisplay: coupon.discountType === "percentage"
                    ? `${coupon.discountPercentage}% OFF`
                    : `${RUPEE_SYMBOL}${Math.max(0, (coupon.originalPrice || 0) - (coupon.discountedPrice || 0))} OFF`,
                  minOrder: coupon.minOrderValue || 0,
                  description: coupon.discountType === "percentage"
                    ? `${coupon.discountPercentage}% OFF with '${coupon.couponCode}'`
                    : `Save ${RUPEE_SYMBOL}${Math.max(0, (coupon.originalPrice || 0) - (coupon.discountedPrice || 0))} with '${coupon.couponCode}'`,
                  originalPrice: coupon.originalPrice,
                  discountedPrice: coupon.discountedPrice,
                  customerGroup: coupon.customerGroup || "all",
                  isGlobalCoupon: Boolean(coupon.isGlobalCoupon),
                  itemId: couponItemId,
                  itemName: cartItem.name,
                })
              }
            })
          }
        } catch (error) {
          debugError(`[CART-COUPONS] Error fetching coupons for item ${cartItem.id}:`, error)
        }
      }

      debugLog(`[CART-COUPONS] Total unique coupons found: ${allCoupons.length}`, allCoupons)
      setAvailableCoupons(allCoupons)
      setLoadingCoupons(false)
    }

    fetchCouponsForCartItems()
  }, [cart, sellerId])

  const usesSplitCheckout = useMemo(() => {
    const sellers = new Set(
      cart.map((item) => String(item.sellerId || item.seller?._id || "")).filter(Boolean),
    )
    return sellers.size > 1 || storeFulfilmentMode === "standard" || useCoins
  }, [cart, useCoins, storeFulfilmentMode])

  useEffect(() => {
    if (!usesSplitCheckout || cart.length === 0 || !hasSavedAddress) {
      setCheckoutQuote(null)
      return
    }
    let cancelled = false
    const quote = async () => {
      try {
        const res = await orderAPI.calculateCheckout({
          items: cart.map((item) => ({
            itemId: item.itemId || item.id,
            sellerId: item.sellerId || item.seller?._id,
            variantId: item.variantId || undefined,
            name: item.name,
            price: item.price,
            quantity: item.quantity || 1,
          })),
          deliveryAddress: pricingAddress,
          fulfilmentMode: storeFulfilmentMode,
          couponCode: appliedCoupon?.code || couponCode || undefined,
          // Ask for as many as the customer has; the server caps it.
          coins: useCoins ? Math.floor(Number(coinBalance?.usable) || 0) : 0,
        })
        if (!cancelled) setCheckoutQuote(res?.data?.data || null)
      } catch (error) {
        debugError("Checkout quote failed:", error)
        if (!cancelled) setCheckoutQuote(null)
      }
    }
    quote()
    return () => {
      cancelled = true
    }
  }, [usesSplitCheckout, cart, hasSavedAddress, pricingAddress, appliedCoupon, couponCode, useCoins, coinBalance?.usable, storeFulfilmentMode])

  // Calculate pricing from backend whenever cart, address, or coupon changes
  useEffect(() => {
    const calculatePricing = async () => {
      if (cart.length === 0 || !hasSavedAddress) {
        setPricing(null)
        return
      }

      try {
        setLoadingPricing(true)
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price, // Price should already be in INR
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null
        }))

        const resolvedSellerId = sellerData?.sellerId || sellerData?._id || sellerId || undefined
        const resolvedCouponCode = appliedCoupon?.code || couponCode || undefined

        const calculatePayload = {
          items,
          sellerId: resolvedSellerId,
          deliveryAddress: pricingAddress,
          couponCode: resolvedCouponCode,
          deliveryMode,
        }

        if (scheduledOrderAt) {
          calculatePayload.scheduledAt = scheduledOrderAt.toISOString()
        }

        const response = await orderAPI.calculateOrder(calculatePayload)

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)

          const resolvedItems = Array.isArray(response.data.data.items)
            ? response.data.data.items
            : []
          if (resolvedItems.length > 0) {
            const priceById = new Map(
              resolvedItems.map((item) => [String(item.itemId), item]),
            )
            const nextCart = cart.map((cartItem) => {
              const itemId = String(cartItem.itemId || cartItem.id || "")
              const resolved = priceById.get(itemId)
              if (!resolved) return cartItem

              const nextPrice = Number(resolved.price)
              if (!Number.isFinite(nextPrice) || nextPrice === Number(cartItem.price)) {
                return cartItem
              }

              return {
                ...cartItem,
                name: resolved.name || cartItem.name,
                price: nextPrice,
                variantPrice: Number(resolved.variantPrice ?? nextPrice),
                variantName: resolved.variantName || cartItem.variantName,
              }
            })

            const pricesChanged = nextCart.some(
              (item, index) => Number(item.price) !== Number(cart[index]?.price),
            )
            if (pricesChanged) {
              replaceCart(nextCart)
              const priceChanges = response.data.data.priceChanges || []
              if (priceChanges.length > 0) {
                toast.info("Cart prices were updated to match the latest menu")
              }
            }
          }

          // Update applied coupon if backend returns one
          if (response.data.data.pricing.appliedCoupon && !appliedCoupon) {
            const coupon = availableCoupons.find(c => c.code === response.data.data.pricing.appliedCoupon.code)
            if (coupon) {
              setAppliedCoupon(coupon)
            }
          }
        }
      } catch (error) {
        const apiMessage =
          error?.response?.data?.message ||
          error?.response?.data?.error?.message ||
          error?.message ||
          ""

        if (
          apiMessage.toLowerCase().includes("offline") ||
          apiMessage.toLowerCase().includes("closed")
        ) {
          setPricing(null)
          return
        }

        // Network errors or 404 errors - silently handle, fallback to frontend calculation
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error calculating pricing:", error)
        }
        // Fallback to frontend calculation if backend fails
        setPricing(null)
      } finally {
        setLoadingPricing(false)
      }
    }

    calculatePricing()
  }, [cart, pricingAddress, appliedCoupon, couponCode, sellerId, sellerData, scheduledOrderAt, replaceCart, deliveryMode])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!Array.isArray(cart) || cart.length === 0) {
      sessionStorage.removeItem("store_cart_pricing_snapshot")
      return
    }

    try {
      const snapshot = buildEffectiveCartPricing({
        cart,
        pricing,
        feeSettings,
        defaultAddress: pricingAddress,
        sellerData,
        appliedCoupon,
        deliveryMode,
        roadDistanceKm:
          Number.isFinite(Number(pricing?.distanceKm))
            ? Number(pricing.distanceKm)
            : Number.isFinite(Number(pricing?.roadDistanceKm))
              ? Number(pricing.roadDistanceKm)
              : roadDistanceKm,
      })
      sessionStorage.setItem("store_cart_pricing_snapshot", JSON.stringify(snapshot))
      window.dispatchEvent(new CustomEvent("store_cart_pricing_updated"))
    } catch {
      // ignore storage errors
    }
  }, [cart, pricing, feeSettings, pricingAddress, sellerData, appliedCoupon, deliveryMode, roadDistanceKm])

  // Selected address Rest→User road distance (same source as Home / delivery).
  useEffect(() => {
    let cancelled = false
    if (!sellerData || !pricingAddress) {
      setRoadDistanceKm(null)
      return undefined
    }

    // Prefer backend pricing distance once available.
    if (Number.isFinite(Number(pricing?.distanceKm)) || Number.isFinite(Number(pricing?.roadDistanceKm))) {
      const fromPricing = Number(pricing?.distanceKm ?? pricing?.roadDistanceKm)
      setRoadDistanceKm(fromPricing)
      return undefined
    }

    const run = async () => {
      const km = await fetchDrivingDistanceKm(sellerData, pricingAddress)
      if (!cancelled && Number.isFinite(Number(km))) {
        setRoadDistanceKm(Number(km))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [
    sellerData,
    pricingAddress,
    pricing?.distanceKm,
    pricing?.roadDistanceKm,
  ])

  // Address sheet labels: batch road distances for saved addresses.
  useEffect(() => {
    let cancelled = false
    if (!sellerData || !Array.isArray(addresses) || addresses.length === 0) {
      setAddressRoadKmById({})
      return undefined
    }

    const run = async () => {
      const kms = await fetchDrivingDistancesMatrix(sellerData, addresses)
      if (cancelled || !Array.isArray(kms)) return
      const next = {}
      addresses.forEach((address, index) => {
        const id = getAddressId(address)
        if (!id || !Number.isFinite(Number(kms[index]))) return
        next[String(id)] = Number(kms[index])
      })
      setAddressRoadKmById(next)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [sellerData, addresses])

  // Fetch wallet balance
  useEffect(() => {
    const fetchWalletBalance = async () => {
      try {
        setIsLoadingWallet(true)
        const response = await userAPI.getWallet()
        if (response?.data?.success && response?.data?.data?.wallet) {
          setWalletBalance(response.data.data.wallet.balance || 0)
        }
      } catch (error) {
        debugError("Error fetching wallet balance:", error)
        setWalletBalance(0)
      } finally {
        setIsLoadingWallet(false)
      }
    }
    fetchWalletBalance()
  }, [])

  // Fetch platform coins balance
  useEffect(() => {
    let isMounted = true
    const fetchCoins = async () => {
      try {
        setIsLoadingCoins(true)
        const res = await coinsAPI.getBalance()
        if (isMounted && res?.data?.data) {
          setCoinBalance(res.data.data)
        }
      } catch (error) {
        debugWarn("Error fetching coins balance:", error)
      } finally {
        if (isMounted) setIsLoadingCoins(false)
      }
    }
    fetchCoins()
    return () => { isMounted = false }
  }, [])

  // Fetch user order count (used for first-time coupon eligibility)
  useEffect(() => {
    const fetchOrderCount = async () => {
      try {
        const response = await orderAPI.getOrders({ page: 1, limit: 1 })
        if (response?.data?.success) {
          const totalOrders = response?.data?.data?.pagination?.total || 0
          setUserOrderCount(totalOrders)
        }
      } catch (error) {
        debugError("Error fetching user order count:", error)
        setUserOrderCount(0)
      }
    }

    fetchOrderCount()
  }, [])

  // Fee settings from centralized public config (cached; refresh on admin update only)
  useEffect(() => {
    const applyFeeSettings = (raw) => {
      if (!raw) return
      setFeeSettings({
        deliveryFee: raw.deliveryFee ?? 0,
        deliveryFeeRanges: raw.deliveryFeeRanges || [],
        platformFee: raw.platformFee ?? 0,
        quickDeliveryFee: raw.quickDeliveryFee ?? 0,
        gstRate: raw.gstRate ?? 0,
      })
    }

    applyFeeSettings(getCachedFeeSettings())

    void loadCorePublicAppConfig().then((snapshot) => {
      applyFeeSettings(snapshot.feeSettings)
    })

    const handleSettingsUpdate = () => {
      void loadCorePublicAppConfig({ force: true }).then((snapshot) => {
        applyFeeSettings(snapshot.feeSettings)
      })
    }

    window.addEventListener("businessSettingsUpdated", handleSettingsUpdate)
    return () => window.removeEventListener("businessSettingsUpdated", handleSettingsUpdate)
  }, [])

  const effectivePricing = useMemo(
    () =>
      buildEffectiveCartPricing({
        cart,
        pricing: checkoutQuote
          ? {
            ...(pricing || {}),
            subtotal: checkoutQuote.subtotal,
            tax: checkoutQuote.tax,
            packagingFee: checkoutQuote.packagingFee,
            // The quote's delivery fee already includes its GST.
            deliveryFee: checkoutQuote.deliveryFee,
            deliveryFeeGst: 0,
            platformFee: checkoutQuote.platformFee,
            discount: checkoutQuote.discount,
            // Before coins; the coins line comes off it below.
            total: Math.round((checkoutQuote.grandTotal + checkoutQuote.coinsDiscount) * 100) / 100,
            couponCode: checkoutQuote.couponCode,
            appliedCoupon: checkoutQuote.appliedCoupon,
          }
          : pricing,
        feeSettings,
        defaultAddress: pricingAddress,
        sellerData,
        appliedCoupon,
        deliveryMode,
        roadDistanceKm:
          Number.isFinite(Number(pricing?.distanceKm))
            ? Number(pricing.distanceKm)
            : Number.isFinite(Number(pricing?.roadDistanceKm))
              ? Number(pricing.roadDistanceKm)
              : roadDistanceKm,
      }),
    [cart, pricing, checkoutQuote, feeSettings, pricingAddress, sellerData, appliedCoupon, deliveryMode, roadDistanceKm],
  )
  const subtotal = effectivePricing.subtotal
  const deliveryFee = effectivePricing.deliveryFee
  const deliveryFeeGst = effectivePricing.deliveryFeeGst != null
    ? resolveDeliveryFeeGst(deliveryFee, effectivePricing.deliveryFeeGst)
    : computeDeliveryFeeGst(deliveryFee)
  const quickDeliveryFee = effectivePricing.quickDeliveryFee || 0
  const deliveryFeeBreakdown = effectivePricing.deliveryFeeBreakdown
  const displayDistanceKm = Number.isFinite(Number(deliveryFeeBreakdown?.distanceKm))
    ? Number(deliveryFeeBreakdown.distanceKm)
    : Number.isFinite(Number(pricing?.distanceKm))
      ? Number(pricing.distanceKm)
      : Number.isFinite(Number(pricing?.roadDistanceKm))
        ? Number(pricing.roadDistanceKm)
        : Number.isFinite(Number(roadDistanceKm))
          ? Number(roadDistanceKm)
          : null
  const hasDistanceDeliveryBreakdown =
    Number.isFinite(displayDistanceKm)
  const deliveryFeeBreakdownText = hasDistanceDeliveryBreakdown
    ? deliveryFeeBreakdown?.message || `Distance: ${displayDistanceKm.toFixed(1)} km`
    : null
  const platformFee = effectivePricing.platformFee
  const gstCharges = effectivePricing.tax
  const discount = effectivePricing.discount
  const totalBeforeDiscount = subtotal + deliveryFee + deliveryFeeGst + platformFee + gstCharges
  const total = effectivePricing.total
  const commerceMode = storeFulfilmentMode

  const maxCoinsRedeemable = useMemo(() => {
    if (!coinBalance?.isEnabled || !coinBalance?.usable) return 0
    const halfOrder = Math.floor((effectivePricing?.total || 0) * 0.5)
    return Math.min(Number(coinBalance.usable) || 0, Math.max(0, halfOrder))
  }, [coinBalance, effectivePricing?.total])

  const coinDiscount = useCoins
    ? (checkoutQuote ? Number(checkoutQuote.coinsDiscount) || 0 : maxCoinsRedeemable)
    : 0
  const finalPayable = checkoutQuote
    ? Number(checkoutQuote.grandTotal) || 0
    : Math.max(0, total - coinDiscount)

  const sellerGroups = useMemo(() => {
    const groups = new Map()
    cart.forEach((item) => {
      const sId = String(item.sellerId || item.seller?._id || 'unknown')
      const sName = item.seller || 'Store'
      if (!groups.has(sId)) {
        groups.set(sId, { sellerId: sId, sellerName: sName, items: [] })
      }
      groups.get(sId).items.push(item)
    })
    return Array.from(groups.values())
  }, [cart])

  const savings = effectivePricing.savings
  const itemDiscountAmount = appliedCoupon && discount > 0 ? discount : 0
  const otherSavings = Math.max(0, savings - itemDiscountAmount)
  const compareItemTotal = getCartCompareItemTotal(cart)
  const selectedPaymentLabel =
    selectedPaymentMethod === "wallet" ? "Wallet" : "Online Payment"

  const headerAddressLabel = defaultAddress ? getDisplayAddressLabel(defaultAddress.label) : "Select address"
  const headerAddressText = defaultAddress
    ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Add delivery address")
    : "Add delivery address"

  const formatAddressDistanceLabel = (address) => {
    const addressId = getAddressId(address)
    const cached = addressId ? addressRoadKmById[String(addressId)] : null
    const km = Number.isFinite(Number(cached))
      ? Number(cached)
      : calculateDistanceKm(sellerData, address)
    if (!Number.isFinite(km)) return null
    return formatDistanceLabel(km)
  }

  const getAddressIcon = (address) => {
    const label = normalizeAddressLabel(address?.label)
    if (label === "office") return Briefcase
    return Home
  }

  const handleOpenAddAddress = () => {
    setShowAddressSheet(false)
    navigate(storePath("/cart/address-selector"), { state: { backTo: storePath("/cart") } })
  }

  const handleSelectAddressFromSheet = async (address) => {
    await handleSelectSavedAddress(address)
    setShowAddressSheet(false)
  }

  // Seller name from data or cart
  const sellerName = sellerData?.name || sellerData?.sellerName || cart[0]?.seller || "Seller"

  const handleShare = async () => {
    const sellerNameStr = sellerName || companyName || "this seller"
    const shareUrl = window.location.href
    const shareText = `Check out what I'm ordering from ${sellerNameStr}! ${shareUrl}`

    const payload = {
      title: `My Cart at ${sellerNameStr}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Link shared successfully")
      return
    }

    openShareModal(payload)
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

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
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

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  const handleBack = () => {
    // Priority: slug > sellerId (both work for the seller details route)
    const idOrSlug = sellerData?.slug || sellerId
    if (idOrSlug) {
      navigate(storePath(`/sellers/${idOrSlug}`))
    } else {
      goBack()
    }
  }

  // Handler to select address by label (Home, Office, Other)
  const handleSelectAddressByLabel = async (label) => {
    try {
      // Find address with matching label
      const targetLabel = normalizeAddressLabel(label)
      const address = addresses.find(addr => normalizeAddressLabel(addr.label) === targetLabel)

      if (!address) {
        toast.error(`No ${label} address found. Please add an address first.`)
        return
      }

      await handleSelectSavedAddress(address)
    } catch (error) {
      debugError(`Error selecting ${label} address:`, error)
      toast.error(`Failed to select ${label} address. Please try again.`)
    }
  }

  const handleSelectSavedAddress = async (address) => {
    try {
      const addressId = getAddressId(address)
      if (addressId) {
        setSelectedAddressId(addressId)
        setDefaultAddress(addressId)
      }

      // Get coordinates from address location
      const coordinates = address.location?.coordinates || []
      const longitude = coordinates[0]
      const latitude = coordinates[1]

      if (!latitude || !longitude) {
        toast.error(`Invalid coordinates for ${address.label || "saved"} address`)
        return
      }

      // Update location in backend
      await userAPI.updateLocation({
        latitude,
        longitude,
        address: `${address.street}, ${address.city}`,
        city: address.city,
        state: address.state,
        area: address.additionalDetails || "",
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      })

      // Update the location in localStorage
      const locationData = {
        city: address.city,
        state: address.state,
        address: `${address.street}, ${address.city}`,
        area: address.additionalDetails || "",
        zipCode: address.zipCode,
        latitude,
        longitude,
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      }
      localStorage.setItem("userLocation", JSON.stringify(locationData))
      // User selected a saved address from Cart; prefer saved mode.
      try {
        localStorage.setItem("deliveryAddressMode", "saved")
        setDeliveryAddressMode("saved")
      } catch { }

      toast.success(`${address.label || "Saved"} address selected!`)
    } catch (error) {
      debugError("Error selecting saved address:", error)
      toast.error("Failed to select address. Please try again.")
    }
  }

  const handleApplyCoupon = async (coupon) => {
    if (coupon?.customerGroup === "new" && userOrderCount > 0) {
      toast.error("This coupon is only for first-time users")
      return
    }

    if (subtotal < (Number(coupon.minOrder) || 0)) {
      toast.error(`Min order ${RUPEE_SYMBOL}${Number(coupon.minOrder || 0)}`)
      return
    }

    // Validate with backend first; only set applied if backend accepts
    if (cart.length > 0 && hasSavedAddress) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null
        }))

        const response = await orderAPI.calculateOrder({
          items,
          sellerId: sellerData?.sellerId || sellerData?._id || sellerId || null,
          deliveryAddress: pricingAddress,
          couponCode: coupon.code,
          deliveryMode,
        })

        const pricingData = response?.data?.data?.pricing
        if (!pricingData || !pricingData.appliedCoupon) {
          toast.error("Coupon not applicable")
          return
        }

        setPricing(pricingData)
        setAppliedCoupon({ ...coupon, autoApplied: false })
        setCouponCode(coupon.code)
        setManualCouponCode(coupon.code)
        markUserSelectedCoupon(
          sellerData?.sellerId || sellerData?._id || sellerId || cart[0]?.sellerId,
          getCartSignature(cart),
          coupon.code,
        )
        setShowOffersView(false)
      } catch (error) {
        debugError("Error recalculating pricing:", error)
        toast.error("Failed to apply coupon")
      }
    }
  }

  const handleApplyCouponCode = async () => {
    const inputCode = manualCouponCode.trim().toUpperCase()
    if (!inputCode) {
      toast.error("Enter coupon code")
      return
    }

    if (cart.length === 0 || !hasSavedAddress) {
      toast.error("Add items and delivery address first")
      return
    }

    const matchedCoupon = availableCoupons.find(
      (coupon) => String(coupon.code || "").toUpperCase() === inputCode,
    )

    // If we know this is first-time only and user already ordered, block early.
    if (matchedCoupon?.customerGroup === "new" && userOrderCount > 0) {
      toast.error("This coupon is only for first-time users")
      return
    }

    try {
      const items = cart.map(item => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image,
        description: item.description,
        isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null
      }))

      const response = await orderAPI.calculateOrder({
        items,
        sellerId: sellerData?.sellerId || sellerData?._id || sellerId || null,
        deliveryAddress: pricingAddress,
        couponCode: inputCode,
        deliveryMode,
      })

      const pricingData = response?.data?.data?.pricing
      if (!pricingData) {
        toast.error("Unable to validate coupon")
        return
      }

      if (!pricingData.appliedCoupon) {
        toast.error("Invalid or unavailable coupon code")
        setCouponCode("")
        return
      }

      setPricing(pricingData)
      setCouponCode(inputCode)
      setAppliedCoupon(
        {
          ...(matchedCoupon || {
            code: inputCode,
            discount: pricingData.appliedCoupon.discount || 0,
            minOrder: 0,
            customerGroup: "all",
          }),
          autoApplied: false,
        },
      )
      setManualCouponCode(inputCode)
      markUserSelectedCoupon(
        sellerData?.sellerId || sellerData?._id || sellerId || cart[0]?.sellerId,
        getCartSignature(cart),
        inputCode,
      )
      setShowOffersView(false)
      toast.success("Coupon applied")
    } catch (error) {
      debugError("Error applying coupon code:", error)
      toast.error("Failed to apply coupon")
    }
  }


  const handleRemoveCoupon = async () => {
    const resolvedSellerId =
      sellerData?.sellerId || sellerData?._id || sellerId || cart[0]?.sellerId
    if (resolvedSellerId) {
      markManualCouponOptOut(resolvedSellerId, getCartSignature(cart))
    }

    setAppliedCoupon(null)
    setCouponCode("")
    setManualCouponCode("")

    // Recalculate pricing without coupon
    if (cart.length > 0 && hasSavedAddress) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null
        }))

        const response = await orderAPI.calculateOrder({
          items,
          sellerId: sellerData?.sellerId || sellerData?._id || sellerId || null,
          deliveryAddress: pricingAddress,
          couponCode: null,
          deliveryMode,
        })

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)
        }
      } catch (error) {
        debugError("Error recalculating pricing:", error)
      }
    }
  }


  const handlePlaceOrder = async () => {
    // Guests can build a cart, but an order needs an account: send them to
    // sign in and bring them straight back here.
    if (!isModuleAuthenticated("user")) {
      toast.error("Please sign in to place your order")
      navigate("/auth/login", { state: { from: "/cart" } })
      return
    }

    if (!hasSavedAddress) {
      toast.error("Please choose a delivery location to continue")
      setShowAddressSheet(true)
      return
    }

    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        toast.error("Please select both date and time to schedule your order")
        return
      }
      const scheduleString = `${scheduledDate}T${scheduledTime}:00`
      const scheduleDateObj = new Date(scheduleString)
      if (scheduleDateObj < new Date()) {
        toast.error("Scheduled time must be in the future")
        return
      }
    }

    if (cart.length === 0) {
      toast.error("Your cart is empty")
      return
    }

    if (!canPlaceOrder) {
      toast.error("Seller is currently offline. Please try again later.")
      return
    }

    setIsPlacingOrder(true)

    // Use API_BASE_URL from config (supports both dev and production)

    try {
      debugLog("?? Starting order placement process...")
      debugLog("?? Cart items:", cart.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })))
      debugLog("?? Applied coupon:", appliedCoupon?.code || "None")
      debugLog("?? Delivery address:", defaultAddress?.label || defaultAddress?.city)

      // Include all cart items
      const orderItems = cart.map(item => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image || "",
        description: item.description || "",
        isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null,
        preparationTime: item.preparationTime
      }))

      debugLog("?? Order items to send:", orderItems)

      // Check API base URL before making request (for debugging)
      const fullUrl = `${API_BASE_URL}${API_ENDPOINTS.ORDER.CREATE}`;
      debugLog("?? Making request to:", fullUrl)
      debugLog("?? Authentication token present:", !!localStorage.getItem('accessToken') || !!localStorage.getItem('user_accessToken'))

      // Check if multi-seller cart, standard delivery mode, or coins are applied
      const cartSellerIds = cart
        .map(item => item.sellerId || item.seller?._id)
        .filter(Boolean)
        .map(id => String(id).trim());
      const uniqueSellerIds = [...new Set(cartSellerIds)];

      const isMultiSeller = uniqueSellerIds.length > 1 || commerceMode === 'standard';
      const shouldUseSplitCheckout = isMultiSeller || usesSplitCheckout;

      if (shouldUseSplitCheckout) {
        debugLog("🔄 Placing split / marketplace checkout with coins:", { useCoins, coinDiscount });
        const resolvedCouponCode = appliedCoupon?.code || couponCode || pricing?.couponCode || undefined;
        const checkoutPayload = {
          items: orderItems.map((item, idx) => ({
            ...item,
            sellerId: cart[idx]?.sellerId || cart[idx]?.seller?._id || sellerData?._id || cart[0]?.sellerId,
            seller: cart[idx]?.seller || sellerData?.name,
          })),
          deliveryAddress: pricingAddress,
          address: pricingAddress,
          fulfilmentMode: storeFulfilmentMode,
          couponCode: resolvedCouponCode,
          coins: useCoins ? Number(checkoutQuote?.coinsUsed) || 0 : 0,
          paymentMethod: selectedPaymentMethod === "wallet" ? "wallet" : (selectedPaymentMethod === "cash" ? "cash" : "razorpay"),
          note: String(note || "").trim(),
          scheduledAt: isScheduled ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : undefined,
        };

        const checkoutRes = await orderAPI.createCheckout(checkoutPayload);
        const checkoutData = checkoutRes?.data?.data?.checkout || checkoutRes?.data?.data;
        const checkoutId = checkoutData?.checkoutId;

        const finishCheckout = () => {
          setPlacedOrderId(checkoutId);
          setShowOrderSuccess(true);
          clearCart();
          resetCartPreferences();
          setIsPlacingOrder(false);
        };

        // Cash and wallet checkouts are complete when the server answers.
        if (checkoutPayload.paymentMethod === 'cash' || checkoutPayload.paymentMethod === 'wallet') {
          toast.success("Order placed successfully!");
          finishCheckout();
          return;
        }

        // Online: one Razorpay order for the whole cart. Nothing reaches the
        // stores until the server has checked the payment.
        const rzData = checkoutRes?.data?.data?.razorpay;
        if (!rzData?.orderId || !checkoutId) {
          throw new Error("Online payment could not be started. Please try again.");
        }

        await initRazorpayPayment({
          key: rzData.key,
          amount: rzData.amount,
          currency: rzData.currency || 'INR',
          order_id: rzData.orderId,
          name: await getCompanyNameAsync(),
          description: `Order ${checkoutId}`,
          prefill: {
            name: recipientName || userProfile?.name || "",
            email: userProfile?.email || "",
            contact: recipientPhone || userProfile?.phone || "",
          },
          handler: async (response) => {
            try {
              await orderAPI.verifyCheckoutPayment(checkoutId, {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              toast.success("Payment verified! Order placed successfully.");
              finishCheckout();
            } catch (verifyError) {
              debugError("Checkout payment verification failed:", verifyError);
              toast.error(
                verifyError?.response?.data?.message ||
                "We couldn't confirm your payment yet. If money was taken, your order will be confirmed shortly.",
              );
              setIsPlacingOrder(false);
            }
          },
          // Closing the sheet keeps the order held for 30 minutes; the order
          // page offers "Complete payment" until then, after which the server
          // releases the stock and coins.
          onClose: () => {
            const heldOrderId = checkoutRes?.data?.data?.childOrders?.[0]?._id;
            setIsPlacingOrder(false);
            if (!heldOrderId) {
              orderAPI.abandonCheckout(checkoutId).catch((abandonError) => {
                debugError("Failed to release abandoned checkout:", abandonError);
              });
              return;
            }
            clearCart();
            toast.info("Payment not completed. You can finish it from the order page within 30 minutes.");
            navigate(`/orders/${heldOrderId}`);
          },
        });
        return;
      }

      // CRITICAL: Validate seller ID before placing single-seller order
      // Ensure we're using the correct seller from sellerData (most reliable)
      const finalSellerId = sellerData?.sellerId || sellerData?._id || null;
      const finalSellerName = sellerData?.name || null;

      if (!finalSellerId) {
        debugError('? CRITICAL: Cannot place order - Seller ID is missing!');
        debugError('?? Debug info:', {
          sellerData: sellerData ? {
            _id: sellerData._id,
            sellerId: sellerData.sellerId,
            name: sellerData.name
          } : 'Not loaded',
          cartSellerId: sellerId,
          cartSellerName: cart[0]?.seller,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            seller: item.seller,
            sellerId: item.sellerId
          }))
        });
        toast.error('Error: Seller information is missing. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      // Validate that ALL cart items belong to the SAME seller in single-seller mode
      const cartSellerNames = cart
        .map(item => item.seller)
        .filter(Boolean)
        .map(name => name.trim().toLowerCase()); // Normalize names

      const uniqueSellerNames = [...new Set(cartSellerNames)];

      // Check if cart has items from multiple sellers
      // Note: If seller names match, allow even if IDs differ (same seller, different ID format)
      if (uniqueSellerNames.length > 1) {
        // Different seller names = definitely different sellers
        debugError('? CRITICAL ERROR: Cart contains items from multiple sellers!', {
          sellerIds: uniqueSellerIds,
          sellerNames: uniqueSellerNames,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            seller: item.seller,
            sellerId: item.sellerId
          }))
        });

        // Automatically clean cart to keep items from the seller matching sellerData
        if (finalSellerId && finalSellerName) {
          debugLog('?? Auto-cleaning cart to keep items from:', finalSellerName);
          cleanCartForSeller(finalSellerId, finalSellerName);
          toast.error('Cart contained items from different sellers. Items from other sellers have been removed.');
        } else {
          // If sellerData is not available, keep items from first seller in cart
          const firstSellerId = cart[0]?.sellerId;
          const firstSellerName = cart[0]?.seller;
          if (firstSellerId && firstSellerName) {
            debugLog('?? Auto-cleaning cart to keep items from first seller:', firstSellerName);
            cleanCartForSeller(firstSellerId, firstSellerName);
            toast.error('Cart contained items from different sellers. Items from other sellers have been removed.');
          } else {
            toast.error('Cart contains items from different sellers. Please clear cart and try again.');
          }
        }

        setIsPlacingOrder(false);
        return;
      }

      // If seller names match but IDs differ, that's OK (same seller, different ID format)
      // But log a warning in development
      if (uniqueSellerIds.length > 1 && uniqueSellerNames.length === 1) {
        if (process.env.NODE_ENV === 'development') {
          debugWarn('?? Cart items have different seller IDs but same name. This is OK if IDs are in different formats.', {
            sellerIds: uniqueSellerIds,
            sellerName: uniqueSellerNames[0]
          });
        }
      }

      // Validate that cart items' sellerId matches the sellerData
      if (cartSellerIds.length > 0) {
        const cartSellerId = cartSellerIds[0];

        // Check if cart sellerId matches sellerData
        const sellerIdMatches =
          cartSellerId === finalSellerId ||
          cartSellerId === sellerData?._id?.toString() ||
          cartSellerId === sellerData?.sellerId;

        if (!sellerIdMatches) {
          debugError('? CRITICAL ERROR: Cart sellerId does not match sellerData!', {
            cartSellerId: cartSellerId,
            finalSellerId: finalSellerId,
            sellerDataId: sellerData?._id?.toString(),
            sellerDataSellerId: sellerData?.sellerId,
            sellerDataName: sellerData?.name,
            cartSellerName: cartSellerNames[0]
          });
          toast.error(`Error: Cart items belong to "${cartSellerNames[0] || 'Unknown Seller'}" but seller data doesn't match. Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Validate seller name matches
      if (cartSellerNames.length > 0 && finalSellerName) {
        const cartSellerName = cartSellerNames[0];
        if (cartSellerName.toLowerCase().trim() !== finalSellerName.toLowerCase().trim()) {
          debugError('? CRITICAL ERROR: Seller name mismatch!', {
            cartSellerName: cartSellerName,
            finalSellerName: finalSellerName
          });
          toast.error(`Error: Cart items belong to "${cartSellerName}" but seller data shows "${finalSellerName}". Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Log order details for debugging
      debugLog('? Order validation passed - Placing order with seller:', {
        sellerId: finalSellerId,
        sellerName: finalSellerName,
        sellerDataId: sellerData?._id,
        sellerDataSellerId: sellerData?.sellerId,
        cartSellerId: cartSellerIds[0],
        cartSellerName: cartSellerNames[0],
        cartItemCount: cart.length
      });

      // FINAL VALIDATION: Double-check sellerId before sending to backend
      const cartSellerId = cart[0]?.sellerId;
      if (cartSellerId && cartSellerId !== finalSellerId &&
        cartSellerId !== sellerData?._id?.toString() &&
        cartSellerId !== sellerData?.sellerId) {
        debugError('? CRITICAL: Final validation failed - sellerId mismatch!', {
          cartSellerId: cartSellerId,
          finalSellerId: finalSellerId,
          sellerDataId: sellerData?._id?.toString(),
          sellerDataSellerId: sellerData?.sellerId,
          cartSellerName: cart[0]?.seller,
          finalSellerName: finalSellerName
        });
        toast.error('Error: Seller information mismatch detected. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      const resolvedCouponCode = appliedCoupon?.code || couponCode || pricing?.couponCode || undefined
      const calculatePayload = {
        items: orderItems,
        sellerId: finalSellerId,
        deliveryAddress: pricingAddress,
        couponCode: resolvedCouponCode,
        deliveryMode,
      }
      if (isScheduled) {
        calculatePayload.scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
      }

      let serverPricing = null
      try {
        const pricingResponse = await orderAPI.calculateOrder(calculatePayload)
        serverPricing = pricingResponse?.data?.data?.pricing || null
      } catch (pricingError) {
        debugError("Failed to refresh order pricing before checkout:", pricingError)
        toast.error("Unable to calculate order total. Please try again.")
        setIsPlacingOrder(false)
        return
      }

      if (!serverPricing || !Number.isFinite(Number(serverPricing.total)) || Number(serverPricing.total) <= 0) {
        toast.error("Unable to calculate order total. Please try again.")
        setIsPlacingOrder(false)
        return
      }

      setPricing(serverPricing)

      const orderPricing = {
        subtotal: Number(serverPricing.subtotal) || subtotal,
        deliveryFee: Number(serverPricing.deliveryFee) || 0,
        tax: Number(serverPricing.tax) || 0,
        platformFee: Number(serverPricing.platformFee) || 0,
        discount: Number(serverPricing.discount) || 0,
        total: Number(serverPricing.total),
        couponCode: serverPricing.couponCode || serverPricing.appliedCoupon?.code || resolvedCouponCode || null,
      }

      const checkoutTotal = orderPricing.total

      debugLog("?? Order pricing (server):", orderPricing)

      const orderPayload = {
        items: orderItems,
        address: {
          ...pricingAddress,
          phone: recipientPhone || defaultAddress?.phone || "",
          name: recipientName,
          fullName: recipientName,
        },
        customerName: recipientName,
        customerPhone: recipientPhone || defaultAddress?.phone || "",
        sellerId: finalSellerId,
        sellerName: finalSellerName || undefined,
        pricing: orderPricing,
        note: String(note || "").trim(),
        deliveryInstructions: deliveryInstructionText,
        deliveryMode,
        paymentMethod: selectedPaymentMethod,
        // `useZone()` can return `null`. Zod expects string/undefined, not null.
        zoneId: zoneId || undefined,
        scheduledAt: isScheduled ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : undefined,
      };
      // Log final order details (including paymentMethod for COD debugging)
      debugLog('?? FINAL: Sending order to backend with:', {
        sellerId: finalSellerId,
        sellerName: finalSellerName,
        itemCount: orderItems.length,
        totalAmount: orderPricing.total,
        paymentMethod: orderPayload.paymentMethod
      });

      // Check wallet balance if wallet payment selected
      if (selectedPaymentMethod === "wallet" && walletBalance < checkoutTotal) {
        toast.error(`Insufficient wallet balance. Required: ${RUPEE_SYMBOL}${checkoutTotal.toFixed(0)}, Available: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`)
        setIsPlacingOrder(false)
        return
      }

      // Create order in backend
      const orderResponse = await orderAPI.createOrder(orderPayload)

      debugLog("? Order created successfully:", orderResponse.data)

      const { order, razorpay } = orderResponse.data.data
      const pendingOnlineOrderId = order?._id || order?.id || order?.orderMongoId || null

      const cleanupAbandonedOnlinePayment = async () => {
        if (!pendingOnlineOrderId) return
        try {
          await orderAPI.abandonOnlinePayment(pendingOnlineOrderId)
          debugLog("Cleaned up abandoned online payment order:", pendingOnlineOrderId)
        } catch (cleanupError) {
          debugError("Failed to cleanup abandoned online payment order:", cleanupError)
        }
      }

      // Wallet flow: order placed with wallet payment (already processed in backend)
      if (selectedPaymentMethod === "wallet") {
        toast.success("Order placed with Wallet payment")
        setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
        setShowOrderSuccess(true)
        window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
        clearCart()
        resetCartPreferences()
        setIsPlacingOrder(false)
        // Refresh wallet balance
        try {
          const walletResponse = await userAPI.getWallet()
          if (walletResponse?.data?.success && walletResponse?.data?.data?.wallet) {
            setWalletBalance(walletResponse.data.data.wallet.balance || 0)
          }
        } catch (error) {
          debugError("Error refreshing wallet balance:", error)
        }
        return
      }

      if (!razorpay || !razorpay.orderId || !razorpay.key) {
        debugError("? Razorpay initialization failed:", { razorpay, order })
        throw new Error(razorpay ? "Razorpay payment gateway is not configured. Please contact support." : "Failed to initialize payment")
      }

      debugLog("?? Razorpay order created:", {
        orderId: razorpay.orderId,
        amount: razorpay.amount,
        currency: razorpay.currency,
        keyPresent: !!razorpay.key
      })

      // Get user info for Razorpay prefill
      const userInfo = userProfile || {}
      const userPhone = recipientPhone || userInfo.phone || defaultAddress?.phone || ""
      const userEmail = userInfo.email || ""
      const userName = recipientName || userInfo.name || ""

      // Format phone number (remove non-digits, take last 10 digits)
      const formattedPhone = userPhone.replace(/\D/g, "").slice(-10)

      debugLog("?? User info for payment:", {
        name: userName,
        email: userEmail,
        phone: formattedPhone
      })

      // Get company name for Razorpay
      const companyName = await getCompanyNameAsync()

      // Initialize Razorpay payment
      await initRazorpayPayment({
        key: razorpay.key,
        amount: razorpay.amount, // Already in paise from backend
        currency: razorpay.currency || 'INR',
        order_id: razorpay.orderId,
        name: companyName,
        description: `Order ${order._id || order.orderId} - ${RUPEE_SYMBOL}${(razorpay.amount / 100).toFixed(2)}`,
        prefill: {
          name: userName,
          email: userEmail,
          contact: formattedPhone
        },
        notes: {
          orderId: order._id || order.orderId,
          userId: userInfo.id || "",
          sellerId: sellerId || "unknown"
        },
        handler: async (response) => {
          try {
            debugLog("? Payment successful, verifying...", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id
            })

            // Verify payment with backend
            const verifyOrderId = order?._id || order?.id || order?.orderMongoId
            if (!verifyOrderId) {
              throw new Error("Unable to verify payment: missing order id from create-order response")
            }
            const verifyResponse = await orderAPI.verifyPayment({
              orderId: verifyOrderId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            })

            debugLog("? Payment verification response:", verifyResponse.data)

            if (verifyResponse.data.success) {
              // Payment successful
              debugLog("?? Order placed successfully:", {
                orderId: order._id || order.orderId,
                paymentId: verifyResponse.data.data?.payment?.paymentId
              })
              setPlacedOrderId(order._id || order.orderId)
              setShowOrderSuccess(true)
              window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
              clearCart()
              resetCartPreferences()
              setIsPlacingOrder(false)
            } else {
              throw new Error(verifyResponse.data.message || "Payment verification failed")
            }
          } catch (error) {
            debugError("? Payment verification error:", error)
            const errorMessage =
              error?.response?.data?.message ||
              error?.response?.data?.error?.message ||
              error?.response?.data?.errors?.[0]?.message ||
              error?.message ||
              "Payment verification failed. Please contact support."
            toast.error(errorMessage)
            setIsPlacingOrder(false)
          }
        },
        onError: async (error) => {
          debugError("? Razorpay payment error:", error)
          // Don't show alert for user cancellation
          if (error?.code !== 'PAYMENT_CANCELLED' && error?.message !== 'PAYMENT_CANCELLED') {
            const errorMessage = error?.description || error?.message || "Payment failed. Please try again."
            toast.error(errorMessage)
          } else {
            await cleanupAbandonedOnlinePayment()
          }
          setIsPlacingOrder(false)
        },
        onClose: async () => {
          debugLog("?? Payment modal closed by user")
          await cleanupAbandonedOnlinePayment()
          setIsPlacingOrder(false)
        }
      })
    } catch (error) {
      debugError("? Order creation error:", error)

      let errorMessage = "Failed to create order. Please try again."

      // Handle network errors
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        const backendUrl = API_BASE_URL.replace('/api', '');
        errorMessage = `Network Error: Cannot connect to backend server.\n\n` +
          `Expected backend URL: ${backendUrl}\n\n` +
          `Please check:\n` +
          `1. Backend server is running\n` +
          `2. Backend is accessible at ${backendUrl}\n` +
          `3. Check browser console (F12) for more details\n\n` +
          `If backend is not running, start it with:\n` +
          `cd Backend && npm start`

        debugError("?? Network Error Details:", {
          code: error.code,
          message: error.message,
          config: {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            fullUrl: error.config?.baseURL + error.config?.url,
            method: error.config?.method
          },
          backendUrl: backendUrl,
          apiBaseUrl: API_BASE_URL
        })

        // Backend disconnected - no health check (new backend in progress)
      }
      // Handle timeout errors
      else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = "Request timed out. The server is taking too long to respond. Please try again."
      }
      // An item not sold in this store's channel: let the customer fix the cart.
      else if (findUnavailableCartItem(error, cart)) {
        const hit = findUnavailableCartItem(error, cart)
        setUnavailableLine({ ...hit, altAvailable: null })
        setIsPlacingOrder(false)
        const productId = hit.item.productId || hit.item.itemId || hit.item.id
        const alt = otherChannel(storeFulfilmentMode === "quick" ? "quick" : "shop")
        catalogAPI.getProduct(productId)
          .then((res) => {
            const data = res?.data?.data || res?.data
            const product = data?.product
            const variant = hit.item.variantId && Array.isArray(product?.variants)
              ? product.variants.find((v) => String(v._id || v.id) === String(hit.item.variantId))
              : null
            const ok = !!product && channelAvailability(product, alt, variant).inStock
            setUnavailableLine((cur) => (cur && cur.item === hit.item ? { ...cur, altAvailable: ok } : cur))
          })
          .catch(() => setUnavailableLine((cur) => (cur && cur.item === hit.item ? { ...cur, altAvailable: false } : cur)))
        return
      }
      // Handle other axios errors
      else if (error.response) {
        // Server responded with error status
        errorMessage = error.response.data?.message || `Server error: ${error.response.status}`
      }
      // Handle other errors
      else if (error.message) {
        errorMessage = error.message
      }

      toast.error(errorMessage)
      setIsPlacingOrder(false)
    }
  }

  const handleGoToOrders = () => {
    setShowOrderSuccess(false)
    navigate(`/user/orders/${placedOrderId}?confirmed=true`)
  }

  // Empty cart state - but don't show if order success or placing order modal is active
  if (cart.length === 0 && !showOrderSuccess && !showPlacingOrder) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
        <div className="bg-white dark:bg-[#1a1a1a] border-b dark:border-gray-800 sticky top-0 z-10">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-gray-800 dark:text-white">Cart</span>
          </div>
          <CartSwitch className="mx-auto max-w-md px-4 pb-3" />
        </div>
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <ShoppingBag className="h-10 w-10 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center">Find something you like and it will show up here</p>
          <Link to={storePath("/")}>
            <Button className="border-0 bg-[#FD920B] text-[#0F1111] hover:bg-wh-brand-600">
              Start shopping
            </Button>
          </Link>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-10">
          <SavedForLater variant={isDesktop ? "desktop" : "mobile"} />
        </div>
      </AnimatedPage>
    )
  }

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#0a0a0a]">
      {/* Header (mobile; clean white matching reference Screen 5) */}
      <div className="sticky top-0 z-30 flex-shrink-0 bg-white dark:bg-[#141414] border-b border-gray-100 dark:border-gray-800 shadow-sm lg:hidden">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="p-1 -ml-1 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              onClick={handleBack}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                My Cart ({getCartCount()})
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {sellerGroups.length} {sellerGroups.length === 1 ? 'store' : 'stores'} • {RUPEE_SYMBOL}{Math.round(total)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            onClick={handleShare}
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
        <CartSwitch className="px-4 pb-3" />
      </div>

      {!canPlaceOrder && cart.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 md:px-6 py-2.5">
          <div className="max-w-7xl mx-auto">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {sellerName} is currently offline. You can keep items in your cart, but checkout will open once the seller is back online.
            </p>
          </div>
        </div>
      )}

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10 relative z-10 bg-slate-50 dark:bg-[#0a0a0a] lg:bg-wh-page">
        <CartAutoCouponBanner
          appliedCoupon={appliedCoupon?.autoApplied ? appliedCoupon : null}
          savings={itemDiscountAmount}
        />

        {/* "You may also like": co-purchases of the first item, minus what is already in the cart */}
        {cart.length > 0 && !isDesktop && (
          <div className="px-4 md:px-6 max-w-7xl mx-auto">
            <RecommendationRail
              productId={cart[0].productId || cart[0].itemId || cart[0].id}
              type="frequently_bought"
              title="You may also like"
              excludeIds={cart.map((item) => item.productId || item.itemId || item.id)}
              limit={10}
            />
          </div>
        )}

        {/* Savings Banner */}
        {otherSavings > 0 && (
          <div className="bg-blue-100 dark:bg-blue-900/20 px-4 md:px-6 py-2 md:py-3 flex-shrink-0">
            <div className="max-w-7xl mx-auto">
              <p className="text-sm md:text-base font-medium text-blue-800 dark:text-blue-200">
                Saved {RUPEE_SYMBOL}{otherSavings.toFixed(0)} on this order
              </p>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-6 pt-3 md:pt-4 pb-4 md:pb-6 lg:max-w-[1500px] lg:px-5 lg:pt-5">
          <div className="max-w-3xl mx-auto lg:max-w-none">
            {/* Main Cart Content */}
            <div className="flex flex-col gap-2 md:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
              {/* Left: cart lines, delivery and contact (desktop column; flattened on mobile) */}
              <div className="contents lg:flex lg:flex-col lg:gap-4 lg:min-w-0">
              {/* Cart Items */}
              <div className="order-1 bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 md:py-5 rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 dark:border-gray-800 lg:rounded-[8px] lg:border-0 lg:shadow-none lg:px-5 lg:py-5">
                <div className="hidden lg:flex items-end justify-between gap-6 border-b border-wh-border pb-2 mb-4">
                  <h1 className="text-[28px] font-normal leading-9 text-wh-text">Shopping Cart</h1>
                  <CartSwitch className="w-[340px]" />
                  <span className="text-[14px] text-wh-muted">Price</span>
                </div>
                <div className="space-y-4">
                  {sellerGroups.map((group, gIdx) => (
                    <div
                      key={group.sellerId || gIdx}
                      className="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 bg-white dark:bg-[#141414] shadow-sm space-y-3"
                    >
                      {/* Store Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-600 font-bold text-xs uppercase shrink-0">
                            {group.sellerName?.charAt(0) || "S"}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-tight">
                              {group.sellerName}{" "}
                              <span className="text-xs font-normal text-gray-500">
                                ({group.items.length} {group.items.length === 1 ? "item" : "items"})
                              </span>
                            </h3>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-0.5 rounded-full shrink-0">
                          {deliveryBadge}
                        </span>
                      </div>

                      {/* Items in this Store */}
                      <div className="space-y-3">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-xl bg-gray-50/60 dark:bg-black/20 border border-gray-100 dark:border-gray-800/80 hover:border-orange-200 transition-colors"
                          >
                            {/* Product Thumbnail - ALWAYS visible */}
                            <Link
                              to={storePath(`/product/${item.productId || item.itemId || item.id}`)}
                              className="h-20 w-16 sm:h-24 sm:w-20 shrink-0 overflow-hidden rounded-xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700 shadow-sm focus-visible:outline-2 focus-visible:outline-orange-500 group"
                            >
                              {item.image ? (
                                <img
                                  src={resolveMediaUrl(item.image)}
                                  alt={item.name}
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none"
                                  }}
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400">
                                  <ShoppingBag className="h-6 w-6" aria-hidden="true" />
                                </div>
                              )}
                            </Link>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <Link
                                to={storePath(`/product/${item.productId || item.itemId || item.id}`)}
                                className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white leading-tight hover:text-orange-600 transition-colors line-clamp-2"
                              >
                                {item.name}
                              </Link>

                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                {item.variantName ||
                                  (item.selectedSize
                                    ? `${item.selectedColor || ""} • ${item.selectedSize}`
                                    : item.packSize || "Standard Fit")}
                              </p>

                              <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-x-2 gap-y-0.5 flex-wrap">
                                <span className="text-sm sm:text-base font-bold text-gray-900 dark:text-white tabular-nums">
                                  {RUPEE_SYMBOL}
                                  {Math.round(Number(item.price || 0))}
                                </span>
                                {Number(item.otherPrice || item.mrp) > Number(item.price) && (
                                  <>
                                    <span className="text-xs text-gray-400 line-through tabular-nums">
                                      {RUPEE_SYMBOL}
                                      {Math.round(Number(item.otherPrice || item.mrp))}
                                    </span>
                                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded">
                                      {Math.round(
                                        ((Number(item.otherPrice || item.mrp) - Number(item.price)) /
                                          Number(item.otherPrice || item.mrp)) *
                                          100,
                                      )}
                                      % OFF
                                    </span>
                                  </>
                                )}
                              </div>
                            {/* Stepper & Trash Button */}
                            <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                              <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] shadow-sm">
                                <button
                                  type="button"
                                  aria-label={`Decrease quantity of ${item.name}`}
                                  className="h-7 w-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-l-lg transition-colors"
                                  onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                                <span className="min-w-[24px] text-center text-xs font-bold text-gray-900 dark:text-white tabular-nums">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Increase quantity of ${item.name}`}
                                  className="h-7 w-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-r-lg transition-colors"
                                  onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              </div>

                              <button
                                type="button"
                                aria-label={`Remove ${item.name} from cart`}
                                onClick={() => removeFromCart(item.id)}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                              </div>
                            </div>

                          </div>
                        ))}
                      </div>

                      {/* Store Free Delivery Milestone */}
                      <div className="mt-3 p-2.5 rounded-xl bg-orange-50/70 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40 text-xs font-medium text-orange-800 dark:text-orange-300 flex items-center justify-between">
                        <span>
                          {inQuick
                            ? `Packed by ${group.sellerName} and brought over by a rider`
                            : formatDeliveryWindow(shopEstimate, "Delivered in 2-4 days")}
                        </span>
                        <span className="font-bold text-orange-600 dark:text-orange-400">{inQuick ? "Quick" : "Courier"}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-1.5 shrink-0 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] px-3 py-2 text-[12px] font-semibold text-gray-700 dark:text-gray-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNoteSheet(true)}
                    className={`flex items-center gap-1.5 shrink-0 rounded-full border px-3 py-2 text-[12px] font-semibold ${
                      note.trim()
                        ? "border-wh-brand/40 bg-[#FFF1E8] text-wh-brand-ink"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {note.trim() ? "Edit order note" : "Add order note"}
                  </button>
                </div>
                {note.trim() ? (
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    <span className="font-semibold text-gray-700 dark:text-gray-300">Order note:</span> {note.trim()}
                  </p>
                ) : null}
              </div>

              {/* Saved for later (server-side, this storefront) */}
              <SavedForLater variant={isDesktop ? "desktop" : "mobile"} className="order-1" />

              {/* Delivery modes & instructions */}
              <div className="order-3 bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800 overflow-hidden">
                <div className="p-3">
                  <div className="flex items-center rounded-full bg-gray-100 dark:bg-[#222222] p-1">
                    {hasDeliveryModes ? (
                    <button
                      type="button"
                      onClick={() => setDeliverySectionTab("modes")}
                      className={`flex-1 flex items-center justify-center gap-1 rounded-full px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-semibold whitespace-nowrap transition-colors ${
                        deliverySectionTab === "modes"
                          ? "bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      <span className="whitespace-nowrap">Delivery Modes</span>
                      <span
                        className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wide px-1 sm:px-1.5 py-0.5 rounded-full text-wh-text shrink-0"
                        style={{ backgroundColor: "var(--module-theme-color, #FD920B)" }}
                      >
                        New
                      </span>
                    </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDeliverySectionTab("instructions")}
                      className={`flex-1 rounded-full px-2 sm:px-3 py-2 text-[11px] sm:text-[12px] font-semibold whitespace-nowrap transition-colors ${
                        deliverySectionTab === "instructions"
                          ? "bg-white dark:bg-[#1a1a1a] text-wh-brand-ink shadow-sm"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      Instructions
                    </button>
                  </div>
                </div>

                {hasDeliveryModes && deliverySectionTab === "modes" ? (
                  <div className="px-4 pb-4">
                    <button
                      type="button"
                      onClick={() => setDeliveryMode("quick")}
                      className="w-full flex items-start gap-3 text-left pb-3 border-b border-gray-100 dark:border-gray-800"
                    >
                      <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        deliveryMode === "quick" ? "border-wh-brand" : "border-gray-300 dark:border-gray-600"
                      }`}>
                        {deliveryMode === "quick" ? <div className="h-2.5 w-2.5 rounded-full bg-wh-brand" /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">
                            Priority <Zap className="inline h-3.5 w-3.5 text-wh-brand-ink mb-0.5" />
                          </p>
                          <p className={`text-xs font-semibold shrink-0 ${deliveryMode === "quick" ? "text-wh-brand-ink" : "text-gray-500"}`}>
                            +{RUPEE_SYMBOL}{configuredQuickDeliveryFee}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Packed first and handed to the next free rider
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeliveryMode("basic")}
                      className="w-full flex items-start gap-3 text-left pt-3"
                    >
                      <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        deliveryMode === "basic" ? "border-wh-brand" : "border-gray-300 dark:border-gray-600"
                      }`}>
                        {deliveryMode === "basic" ? <div className="h-2.5 w-2.5 rounded-full bg-wh-brand" /> : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          Standard | about {quickEta} min
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Your everyday delivery
                        </p>
                      </div>
                    </button>

                    {!hasSavedAddress && (
                      <button
                        type="button"
                        onClick={() => setShowAddressSheet(true)}
                        className="w-full text-left text-sm font-medium text-wh-brand-ink pt-1"
                      >
                        Select a delivery location to continue
                      </button>
                    )}

                    {deliveryInstructionText ? (
                      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Delivery note:</span> {deliveryInstructionText}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                      {PREDEFINED_DELIVERY_INSTRUCTIONS.map(({ id, label, Icon }) => {
                        const isSelected =
                          deliveryInstructionMode === "preset" && selectedDeliveryInstruction === id
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setDeliveryInstructionMode("preset")
                              setSelectedDeliveryInstruction(isSelected ? null : id)
                              setCustomDeliveryInstruction("")
                            }}
                            className={`shrink-0 w-[92px] rounded-xl border p-3 text-center transition-colors ${
                              isSelected
                                ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20"
                                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414]"
                            }`}
                          >
                            <Icon className={`h-5 w-5 mx-auto mb-2 ${isSelected ? "text-emerald-600" : "text-gray-600 dark:text-gray-300"}`} />
                            <p className={`text-[10px] font-semibold leading-tight ${isSelected ? "text-emerald-700 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}`}>
                              {label}
                            </p>
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setDeliveryInstructionMode("custom")
                          setSelectedDeliveryInstruction(null)
                        }}
                        className={`shrink-0 w-[92px] rounded-xl border p-3 text-center transition-colors ${
                          deliveryInstructionMode === "custom"
                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414]"
                        }`}
                      >
                        <Pencil className={`h-5 w-5 mx-auto mb-2 ${deliveryInstructionMode === "custom" ? "text-emerald-600" : "text-gray-600 dark:text-gray-300"}`} />
                        <p className={`text-[10px] font-semibold leading-tight ${deliveryInstructionMode === "custom" ? "text-emerald-700 dark:text-emerald-300" : "text-gray-700 dark:text-gray-300"}`}>
                          Add custom
                        </p>
                      </button>
                    </div>

                    {deliveryInstructionMode === "custom" ? (
                      <textarea
                        value={customDeliveryInstruction}
                        onChange={(e) => setCustomDeliveryInstruction(e.target.value)}
                        rows={3}
                        placeholder="Type delivery instructions for your partner..."
                        className="mt-3 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-emerald-600 resize-none"
                      />
                    ) : null}

                    {(deliveryInstructionMode === "preset" && selectedDeliveryInstruction) ||
                    (deliveryInstructionMode === "custom" && customDeliveryInstruction.trim()) ? (
                      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Delivery note:</span>{" "}
                        {deliveryInstructionText}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Contact */}
              <div className="order-4 bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800 overflow-hidden">
                <div className="px-4 py-3.5 flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <Phone className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">Order recipient</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">Delivery contact details</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRecipientEditToggle}
                    className="text-xs font-bold uppercase tracking-wide shrink-0"
                    style={{ color: "var(--module-theme-ink, #B45309)" }}
                  >
                    {isEditingRecipient ? "Save" : "Change"}
                  </button>
                </div>

                {!isEditingRecipient ? (
                  <div className="px-4 py-3.5">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{recipientName}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5 tabular-nums">
                      {recipientPhone ? `+91 ${recipientPhone}` : "+91 XXXXXXXXXX"}
                    </p>
                  </div>
                ) : (
                  <div className="px-4 py-3.5 space-y-3 bg-gray-50/60 dark:bg-[#141414]/60">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                        Recipient name
                      </label>
                      <input
                        type="text"
                        value={recipientDetails.name}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            name: sanitizeRecipientName(e.target.value),
                          }))
                        }
                        placeholder="Enter recipient name"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-wh-brand"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                        Phone number
                      </label>
                      <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] overflow-hidden focus-within:border-wh-brand">
                        <span className="px-3 text-sm text-gray-500 border-r border-gray-200 dark:border-gray-700">+91</span>
                        <input
                          type="tel"
                          value={recipientDetails.phone}
                          onChange={(e) =>
                            setRecipientDetails((prev) => ({
                              ...prev,
                              phone: sanitizeRecipientPhone(e.target.value),
                            }))
                          }
                          maxLength={10}
                          placeholder="10-digit mobile"
                          className="flex-1 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none tabular-nums"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      Ordering for someone else? Save their name and phone here.
                    </p>
                  </div>
                )}
              </div>

              </div>
              {/* Right: subtotal, offers, coins, bill (desktop column; flattened on mobile) */}
              <div className="contents lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-28">
              {/* Desktop subtotal card */}
              {isDesktop && (
                <CartSubtotalCard
                  itemCount={cart.reduce((n, item) => n + (Number(item.quantity) || 1), 0)}
                  subtotal={subtotal}
                  finalPayable={finalPayable}
                  savings={otherSavings}
                  addressLabel={headerAddressLabel}
                  addressText={headerAddressText}
                  onChangeAddress={() => setShowAddressSheet(true)}
                  paymentLabel={selectedPaymentLabel}
                  onChangePayment={() => setShowPaymentSheet(true)}
                  onProceed={handlePlaceOrder}
                  proceedDisabled={
                    isPlacingOrder ||
                    loadingSeller ||
                    !canPlaceOrder ||
                    (selectedPaymentMethod === "wallet" && walletBalance < finalPayable)
                  }
                  proceedLabel={
                    isPlacingOrder
                      ? "Processing..."
                      : loadingSeller
                        ? "Loading..."
                        : !canPlaceOrder
                          ? "Store offline"
                          : !hasSavedAddress
                            ? "Add delivery address"
                            : "Proceed to Buy"
                  }
                />
              )}
              {/* Offers row */}
              <button
                type="button"
                onClick={() => setShowOffersView(true)}
                className={`order-2 w-full bg-white dark:bg-[#1a1a1a] rounded-2xl border shadow-sm px-4 py-3.5 flex items-center gap-3 text-left ${
                  appliedCoupon
                    ? "border-wh-brand/30 dark:border-wh-brand/40"
                    : "border-slate-100 dark:border-gray-800"
                }`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                  appliedCoupon
                    ? "bg-wh-brand-50 dark:bg-wh-brand/10"
                    : "bg-emerald-50 dark:bg-emerald-950/40"
                }`}>
                  <Tag className={`h-4 w-4 ${appliedCoupon ? "text-wh-brand-ink" : "text-emerald-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${appliedCoupon ? "text-wh-brand-ink" : "text-gray-900 dark:text-white"}`}>
                    {appliedCoupon
                      ? `'${appliedCoupon.code}' applied`
                      : "Payment offers & more"}
                  </p>
                  <p className={`text-xs mt-0.5 truncate ${appliedCoupon ? "text-wh-brand-ink/80 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                    {appliedCoupon
                      ? `You saved ${RUPEE_SYMBOL}${discount.toFixed(0)} on this order`
                      : loadingCoupons
                        ? "Loading offers..."
                        : availableCoupons.length > 0
                          ? `${availableCoupons.length} offer${availableCoupons.length > 1 ? "s" : ""} available`
                          : "Explore bank offers and coupons"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
              </button>

              {/* Coins Redemption Widget */}
              {coinBalance?.isEnabled && (
                <div className="order-5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/50 dark:border-amber-600/30 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 text-amber-600 dark:text-amber-400 shadow-inner">
                        <Coins className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                            Coins
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                              80% usable rule
                            </span>
                          </h4>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          Balance: <strong className="text-amber-600 dark:text-amber-400">{coinBalance.usable || 0} usable</strong> ({coinBalance.coins || 0} total)
                          {maxCoinsRedeemable > 0 ? ` • Save up to ${RUPEE_SYMBOL}${maxCoinsRedeemable}` : ''}
                        </p>
                        <Link to="/coins" className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline">
                          View coins &amp; expiry
                        </Link>
                        {maxCoinsRedeemable > 0 ? (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                            Redeem up to 50% on this order
                          </p>
                        ) : (
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {(coinBalance.usable || 0) === 0 ? "Earn refund coins for savings on future orders" : "Minimum order required"}
                          </p>
                        )}
                      </div>
                    </div>
                    {maxCoinsRedeemable > 0 && (
                      <button
                        type="button"
                        onClick={() => setUseCoins(!useCoins)}
                        className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                          useCoins
                            ? "bg-amber-500 text-white shadow-amber-500/20 hover:bg-amber-600"
                            : "border border-amber-500/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                        }`}
                      >
                        {useCoins ? "Applied ✓" : "Apply Coins"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Bill Details */}
              <div className="order-6 bg-white dark:bg-[#1a1a1a] px-4 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowBillDetails(!showBillDetails)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-3">
                    <Receipt className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        To Pay {RUPEE_SYMBOL}{finalPayable.toFixed(0)}
                      </p>
                      <p className="text-xs text-emerald-600 mt-0.5">Incl. all taxes & charges</p>
                    </div>
                  </div>
                  <ChevronUp className={`h-4 w-4 text-gray-400 transition-transform ${showBillDetails ? "" : "rotate-180"}`} />
                </button>

                {showBillDetails && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    <div className="flex justify-between text-sm items-start gap-3">
                      <span className="text-gray-600 dark:text-gray-400 border-b border-dotted border-gray-300 shrink-0">Item Total</span>
                      <DualMoney
                        amount={subtotal}
                        compareAmount={compareItemTotal}
                        decimals={2}
                        showDiscountTag={false}
                        plainClassName="text-gray-800 dark:text-gray-200 font-medium tabular-nums"
                        saleClassName="inline-flex items-center rounded-full border border-wh-brand bg-wh-brand/10 px-2 py-0.5 text-sm font-bold text-wh-brand-ink tabular-nums"
                      />
                    </div>
                    {itemDiscountAmount > 0 && (
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-wh-brand-ink border-b border-dotted border-wh-brand/40">Coupon Discount</span>
                        <span className="text-wh-brand-ink">-{RUPEE_SYMBOL}{itemDiscountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <span className="text-gray-600 dark:text-gray-400 border-b border-dotted border-gray-300">
                          Delivery Fee
                          {deliveryFeeBreakdownText
                            ? ` | ${deliveryFeeBreakdownText.replace(/^Distance:\s*/i, "")}`
                            : ""}
                        </span>
                        {deliveryFee > 0 && (
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
                            {formatDeliveryFeeBreakdownSubtext(deliveryFee, deliveryFeeGst, RUPEE_SYMBOL)}
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 whitespace-nowrap text-right font-medium ${
                          deliveryFee === 0
                            ? "text-emerald-600 font-semibold"
                            : "text-gray-800 dark:text-gray-200"
                        }`}
                      >
                        {deliveryFee === 0
                          ? "FREE"
                          : `${RUPEE_SYMBOL}${getDeliveryFeeTotal(deliveryFee, deliveryFeeGst).toFixed(2)}`}
                      </span>
                    </div>
                    {quickDeliveryFee > 0 && (
                      <div className="flex justify-between text-sm font-semibold">
                        <span className="text-wh-brand-ink border-b border-dotted border-wh-brand/40">Quick Mode</span>
                        <span className="text-wh-brand-ink">{RUPEE_SYMBOL}{quickDeliveryFee.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400 border-b border-dotted border-gray-300">Platform Fee</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{Math.max(0, platformFee - quickDeliveryFee).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400 border-b border-dotted border-gray-300">Government Taxes</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{gstCharges.toFixed(2)}</span>
                    </div>
                    {coinDiscount > 0 && (
                      <div className="flex justify-between text-sm font-semibold text-amber-600 dark:text-amber-400">
                        <span className="flex items-center gap-1.5 border-b border-dotted border-amber-300">
                          <Coins className="w-4 h-4 text-amber-500 shrink-0" />
                          Coins redeemed
                        </span>
                        <span>-{RUPEE_SYMBOL}{coinDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold pt-3 mt-1 border-t border-gray-100 dark:border-gray-800 text-gray-900 dark:text-white">
                      <span>To Pay</span>
                      <span>{RUPEE_SYMBOL}{finalPayable.toFixed(2)}</span>
                    </div>
                    {otherSavings > 0 && (
                      <div className="rounded-xl bg-wh-brand-50 dark:bg-wh-brand/10 px-3 py-2.5 text-xs font-medium text-wh-brand-ink dark:text-wh-brand">
                        You saved {RUPEE_SYMBOL}{otherSavings.toFixed(0)} on fees and discounts
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="order-7 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed px-1">
                Cancellation policy: Please double-check your order and address details. Orders are non-refundable once placed.
              </p>
              {isDesktop && cart.length > 0 && (
                <div className="rounded-[8px] bg-wh-surface px-5 pb-2">
                  <RecommendationRail
                    variant="desktop"
                    productId={cart[0].productId || cart[0].itemId || cart[0].id}
                    type="frequently_bought"
                    fallbackType="similar"
                    title="You may also like"
                    excludeIds={cart.map((item) => item.productId || item.itemId || item.id)}
                    limit={10}
                  />
                </div>
              )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky - Pay bar */}
      {/* Bottom Sticky - Pay bar (Matching Screen 5) */}
      <div
        className="bg-white/95 dark:bg-[#161616]/95 backdrop-blur-md border-t border-gray-200/80 dark:border-gray-800 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] z-30 flex-shrink-0 fixed bottom-0 left-0 right-0 lg:hidden px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-md mx-auto space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
            <button
              type="button"
              onClick={() => setShowPaymentSheet(true)}
              className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200 hover:text-orange-500 transition-colors"
            >
              <span>{selectedPaymentLabel}</span>
              <span className="text-orange-500 font-bold text-[11px]">Change</span>
            </button>
            <span className="font-bold text-gray-900 dark:text-white text-sm">
              Total: {RUPEE_SYMBOL}{finalPayable.toFixed(0)}
            </span>
          </div>

          <button
            type="button"
            onClick={handlePlaceOrder}
            disabled={
              isPlacingOrder ||
              loadingSeller ||
              !canPlaceOrder ||
              (selectedPaymentMethod === "wallet" && walletBalance < finalPayable)
            }
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold text-base shadow-lg shadow-orange-500/25 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPlacingOrder ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : loadingSeller ? (
              <span>Loading...</span>
            ) : !canPlaceOrder ? (
              <span>Store Currently Offline</span>
            ) : !hasSavedAddress ? (
              <span>Add Delivery Address</span>
            ) : (
              <span>Proceed to Checkout</span>
            )}
          </button>
        </div>
      </div>

          {/* Placing Order Modal */}
          {showPlacingOrder && (
            <div className="fixed inset-0 z-[60] h-screen w-screen overflow-hidden">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

              {/* Modal Sheet */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl overflow-hidden"
                style={{ animation: 'slideUpModal 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}
              >
                <div className="px-6 py-8">
                  {/* Title */}
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Placing your order</h2>

                  {/* Payment Info */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-white shadow-sm">
                      <CreditCard className="w-6 h-6 text-gray-600" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedPaymentMethod === "razorpay"
                          ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} online (Razorpay)`
                          : selectedPaymentMethod === "wallet"
                            ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} from Wallet`
                            : `Pay on delivery (COD)`}
                      </p>
                    </div>
                  </div>

                  {/* Delivery Address */}
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-gray-50">
                      <svg className="w-7 h-7 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path d="M9 22V12h6v10" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">Delivering to Location</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Address") : "Add address"}
                      </p>
                      <p className="text-sm text-gray-500">
                        {defaultAddress ? (formatFullAddress(defaultAddress) || "Address") : "Address"}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative mb-6">
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-wh-brand to-wh-brand-600 rounded-full transition-all duration-100 ease-linear"
                        style={{
                          width: `${orderProgress}%`,
                          boxShadow: '0 0 10px rgba(253, 146, 11, 0.5)'
                        }}
                      />
                    </div>
                    {/* Animated shimmer effect */}
                    <div
                      className="absolute inset-0 h-2.5 rounded-full overflow-hidden pointer-events-none"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                        animation: 'shimmer 1.5s infinite',
                        width: `${orderProgress}%`
                      }}
                    />
                  </div>

                  {/* Cancel Button */}
                  <button
                    onClick={() => {
                      setShowPlacingOrder(false)
                      setIsPlacingOrder(false)
                    }}
                    className="w-full text-right"
                  >
                    <span className="text-wh-brand-ink font-semibold text-base hover:text-wh-brand-ink transition-colors">
                      CANCEL
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Order Success Celebration Page */}
          {showOrderSuccess && (
            <div
              className="fixed inset-0 z-[70] bg-white dark:bg-[#0a0a0a] flex flex-col items-center justify-center h-screen w-screen overflow-hidden"
              style={{ animation: 'fadeIn 0.3s ease-out' }}
            >
              {/* Confetti Background */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Animated confetti pieces */}
                {[...Array(50)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-3 h-3 rounded-sm"
                    style={{
                      left: `${Math.random() * 100}%`,
                      top: `-10%`,
                      backgroundColor: ['#FD920B', '#3b82f6', '#f59e0b', '#ef4444', '#E07F00', '#ec4899'][Math.floor(Math.random() * 6)],
                      animation: `confettiFall ${2 + Math.random() * 2}s linear ${Math.random() * 2}s infinite`,
                      transform: `rotate(${Math.random() * 360}deg)`,
                    }}
                  />
                ))}
              </div>

              {/* Success Content */}
              <div className="relative z-10 flex flex-col items-center px-6">
                {/* Success Tick Circle */}
                <div
                  className="relative mb-8"
                  style={{ animation: 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}
                >
                  {/* Outer ring animation */}
                  <div
                    className="absolute inset-0 w-32 h-32 rounded-full border-4 border-green-500 dark:border-green-400"
                    style={{
                      animation: 'ringPulse 1.5s ease-out infinite',
                      opacity: 0.3
                    }}
                  />
                  {/* Main circle */}
                  <div className="w-32 h-32 bg-gradient-to-br from-green-500 to-green-600 dark:from-green-500 dark:to-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-200/60 dark:shadow-green-900/40">
                    <svg
                      className="w-16 h-16 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ animation: 'checkDraw 0.5s ease-out 0.5s both' }}
                    >
                      <path d="M5 12l5 5L19 7" className="check-path" />
                    </svg>
                  </div>
                  {/* Sparkles */}
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 bg-yellow-400 dark:bg-yellow-300 rounded-full"
                      style={{
                        top: '50%',
                        left: '50%',
                        animation: `sparkle 0.6s ease-out ${0.3 + i * 0.1}s both`,
                        transform: `rotate(${i * 60}deg) translateY(-80px)`,
                      }}
                    />
                  ))}
                </div>

                {/* Location Info */}
                <div
                  className="text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.6s both' }}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-5 h-5 text-red-500 dark:text-red-400">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {defaultAddress?.city || "Your Location"}
                    </h2>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-base">
                    {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Delivery Address") : "Delivery Address"}
                  </p>
                </div>

                {/* Order Placed Message */}
                <div
                  className="mt-12 text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.8s both' }}
                >
                  <h3 className="text-3xl font-bold text-wh-brand-ink dark:text-orange-400 mb-2">Order Placed!</h3>
                  <p className="text-gray-600 dark:text-gray-300">Your order is on its way</p>
                </div>

                {/* Action Button */}
                <button
                  onClick={handleGoToOrders}
                  className="mt-10 bg-wh-brand hover:bg-wh-brand-600 text-wh-text font-semibold py-4 px-12 rounded-xl shadow-lg shadow-orange-200/70 dark:shadow-orange-950/40 transition-all hover:shadow-xl hover:scale-105"
                  style={{ animation: 'slideUp 0.5s ease-out 1s both' }}
                >
                  Track Your Order
                </button>
              </div>
            </div>
          )}

          {/* Address Selection Bottom Sheet */}
          <AnimatePresence>
            {showAddressSheet && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowAddressSheet(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 350 }}
                  className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[1.75rem] z-[101] shadow-2xl overflow-hidden max-h-[78vh] flex flex-col"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div className="p-5 flex flex-col min-h-0">
                    <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-4" />
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Choose a delivery address</h2>
                      <button
                        type="button"
                        onClick={() => setShowAddressSheet(false)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenAddAddress}
                      className="flex items-center gap-3 w-full py-3 mb-3 text-left"
                    >
                      <div className="h-10 w-10 rounded-lg border-2 border-dashed border-emerald-500 flex items-center justify-center shrink-0">
                        <Plus className="h-4 w-4 text-emerald-600" />
                      </div>
                      <span className="text-sm font-semibold text-emerald-600">Add new Address</span>
                    </button>

                    <div className="space-y-2 overflow-y-auto pr-1 pb-2">
                      {addresses.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 px-4 py-8 text-center">
                          <MapPin className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">No saved addresses yet</p>
                          <p className="text-xs text-gray-500 mt-1">Add an address to place your order</p>
                        </div>
                      ) : (
                        addresses.map((address) => {
                          const AddressIcon = getAddressIcon(address)
                          const addressId = getAddressId(address)
                          const isSelected = addressId && addressId === getAddressId(defaultAddress)
                          const distanceLabel = formatAddressDistanceLabel(address)

                          return (
                            <button
                              key={addressId || `${address.label}-${address.street}`}
                              type="button"
                              onClick={() => handleSelectAddressFromSheet(address)}
                              className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border text-left transition-colors ${
                                isSelected
                                  ? "border-wh-brand/40 bg-[#FFF7F2] dark:bg-wh-brand/10"
                                  : "border-gray-100 dark:border-gray-800 bg-white dark:bg-[#222222] hover:border-gray-200"
                              }`}
                            >
                              <div className="h-10 w-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                                <AddressIcon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {getDisplayAddressLabel(address.label)}
                                  </p>
                                  {isSelected && (
                                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                      Selected
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                                  {formatFullAddress(address) || address?.formattedAddress || address?.address || "Address"}
                                </p>
                              </div>
                              {distanceLabel && (
                                <span className="text-[11px] font-semibold text-gray-400 shrink-0 mt-1">
                                  {distanceLabel}
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Order note bottom sheet */}
          <AnimatePresence>
            {showNoteSheet && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowNoteSheet(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 350 }}
                  className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[1.75rem] z-[101] shadow-2xl overflow-hidden"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div className="p-5">
                    <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-4" />
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Order note</h2>
                      <button
                        type="button"
                        onClick={() => setShowNoteSheet(false)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      These notes are shared with the seller while they pack your order
                    </p>
                    <textarea
                      value={note}
                      onChange={(e) => {
                        setNote(e.target.value)
                        setShowNoteInput(true)
                      }}
                      rows={4}
                      placeholder="E.g. less spicy, no onions, extra sauce..."
                      className="w-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#111111] px-4 py-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-wh-brand resize-none"
                    />
                    <div className="mt-4 flex gap-2">
                      {note.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setNote("")
                            setShowNoteInput(false)
                          }}
                          className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowNoteSheet(false)}
                        className="flex-1 h-11 rounded-xl text-wh-text text-sm font-bold"
                        style={{ backgroundColor: "var(--module-theme-color, #FD920B)" }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Offers Full Page */}
          <AnimatePresence>
            {showOffersView && (
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 32, stiffness: 320 }}
                className="fixed inset-0 z-[95] bg-slate-50 dark:bg-[#0a0a0a] flex flex-col"
              >
                <div
                  className="sticky top-0 z-10 text-white shadow-sm"
                  style={{ backgroundColor: "var(--wh-nav-2)" }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-white hover:bg-white/15"
                      onClick={() => setShowOffersView(false)}
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                      <p className="text-base font-semibold">Payment offers & more</p>
                      <p className="text-xs text-white/80">Coupons and bank offers for this order</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-8">
                  {appliedCoupon ? (
                    <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-100 dark:border-gray-800 p-4 flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 dark:text-white">'{appliedCoupon.code}' applied</p>
                          <p className="text-xs text-emerald-600 mt-0.5">
                            You saved {RUPEE_SYMBOL}{discount.toFixed(0)} on this order
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="text-xs font-bold text-wh-brand-ink uppercase tracking-wide shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}

                  <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-100 dark:border-gray-800 p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Have a coupon code?</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualCouponCode}
                        onChange={(e) => setManualCouponCode(e.target.value.toUpperCase())}
                        placeholder="Enter coupon code"
                        className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#111111] px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-wh-brand"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCouponCode}
                        className="h-11 px-4 rounded-xl text-wh-text text-sm font-bold shrink-0"
                        style={{ backgroundColor: "var(--module-theme-color, #FD920B)" }}
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  {loadingCoupons ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-24 rounded-2xl bg-white dark:bg-[#1a1a1a] animate-pulse border border-slate-100 dark:border-gray-800" />
                      ))}
                    </div>
                  ) : availableCoupons.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400 px-1">
                        Available offers ({availableCoupons.length})
                      </p>
                      {availableCoupons.map((coupon) => {
                        const isLocked = subtotal < (Number(coupon.minOrder) || 0)
                        const isFirstTimeOnly = coupon.customerGroup === "new" && userOrderCount > 0
                        const isApplied = appliedCoupon?.code === coupon.code
                        const isDisabled = isLocked || isFirstTimeOnly || isApplied

                        return (
                          <div
                            key={coupon.code}
                            className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-slate-100 dark:border-gray-800 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="h-10 w-10 rounded-xl bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center shrink-0">
                                  <Percent className="h-5 w-5 text-wh-brand-ink" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-gray-900 dark:text-white">
                                    {coupon.discountDisplay || `Save ${RUPEE_SYMBOL}${coupon.discount}`}
                                  </p>
                                  <p className="text-xs text-gray-500 mt-0.5">Use code '{coupon.code}'</p>
                                  {coupon.customerGroup === "new" ? (
                                    <p className="text-[11px] text-wh-brand-ink mt-1">First-time users only</p>
                                  ) : isLocked ? (
                                    <p className="text-[11px] text-blue-600 mt-1">
                                      Add items worth {RUPEE_SYMBOL}{(Number(coupon.minOrder) - subtotal).toFixed(0)} more
                                    </p>
                                  ) : coupon.description ? (
                                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{coupon.description}</p>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleApplyCoupon(coupon)}
                                disabled={isDisabled}
                                className="shrink-0 border border-wh-brand text-wh-brand-ink rounded-full px-4 py-1.5 text-xs font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {isApplied ? "Applied" : "Apply"}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
                      <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-wh-brand-50 to-orange-100 dark:from-wh-brand/10 dark:to-orange-950/30 flex items-center justify-center">
                        <Sparkles className="h-7 w-7 text-wh-brand-ink" />
                      </div>
                      <h3 className="text-base font-bold text-gray-900 dark:text-white">No offers right now</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-xs mx-auto">
                        We couldn't find active coupons for this cart. You can still enter a code above if you have one.
                      </p>
                      <div className="mt-5 grid grid-cols-2 gap-2 text-left">
                        <div className="rounded-xl bg-slate-50 dark:bg-[#141414] p-3">
                          <Tag className="h-4 w-4 text-emerald-600 mb-2" />
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Bank offers</p>
                          <p className="text-[11px] text-gray-500 mt-1">Check at payment step</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-[#141414] p-3">
                          <Percent className="h-4 w-4 text-wh-brand-ink mb-2" />
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Seller deals</p>
                          <p className="text-[11px] text-gray-500 mt-1">Add more items to unlock</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Payment Selection Bottom Sheet */}
          <AnimatePresence>
            {showPaymentSheet && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowPaymentSheet(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 350 }}
                  className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[2rem] z-[101] shadow-2xl overflow-hidden max-h-[82vh] md:max-h-[60vh] flex flex-col"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div className="p-5 md:p-6 flex flex-col h-full min-h-0">
                    {/* Compact Drag handle */}
                    <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-5" />

                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white leading-none">Payment Method</h2>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Select how you want to pay</p>
                      </div>
                      <button
                        onClick={() => setShowPaymentSheet(false)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar pb-4 flex-1 min-h-0">
                      {[
                        {
                          id: 'razorpay',
                          name: 'Online Payment',
                          description: 'UPI, Cards, Netbanking',
                          icon: <Zap className="w-5 h-5" />,
                          color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
                          selectedColor: 'bg-emerald-500 text-white',
                          badge: 'SECURE'
                        },
                        {
                          id: 'wallet',
                          name: 'Quick Wallet',
                          description: 'Pay from your wallet',
                          icon: <Wallet className="w-5 h-5" />,
                          color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
                          selectedColor: 'bg-blue-500 text-white',
                          subInfo: `Bal: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`,
                          disabled: walletBalance < total,
                          disabledText: 'Low Balance'
                        },
                      ].map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            if (!option.disabled) {
                              setSelectedPaymentMethod(option.id)
                              setShowPaymentSheet(false)
                            }
                          }}
                          className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 group ${selectedPaymentMethod === option.id
                              ? 'border-wh-brand bg-wh-brand shadow-lg shadow-orange-500/30'
                              : 'border-gray-100 dark:border-gray-800/80 bg-white dark:bg-[#222222] hover:border-orange-200 dark:hover:border-orange-900/30 shadow-sm'
                            } ${option.disabled ? 'opacity-40 grayscale-[0.8] cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                                ? 'bg-white/20 text-wh-text'
                                : option.color
                              }`}>
                              {option.icon}
                            </div>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-black tracking-tight leading-none transition-colors ${selectedPaymentMethod === option.id ? 'text-wh-text' : 'text-gray-900 dark:text-gray-100'
                                  }`}>
                                  {option.name}
                                </span>
                                {option.badge && (
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-sm tracking-wider ${selectedPaymentMethod === option.id
                                      ? 'bg-white/20 text-wh-text'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    }`}>
                                    {option.badge}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <p className={`text-[11px] font-bold transition-colors ${selectedPaymentMethod === option.id ? 'text-wh-text/80' : 'text-gray-400'
                                  }`}>
                                  {option.description}
                                </p>
                                {option.subInfo && !option.disabled && (
                                  <>
                                    <span className={`w-1 h-1 rounded-full ${selectedPaymentMethod === option.id ? 'bg-white/40' : 'bg-orange-300 dark:bg-orange-700'
                                      }`} />
                                    <p className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${selectedPaymentMethod === option.id ? 'text-wh-text' : 'text-green-600 dark:text-green-500'
                                      }`}>
                                      {option.subInfo}
                                    </p>
                                  </>
                                )}
                              </div>
                              {option.disabled && (
                                <p className="text-[9px] font-black text-red-500 mt-1 uppercase tracking-wide">
                                  {option.disabledText}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                              ? 'bg-white border-white'
                              : 'border-gray-200 dark:border-gray-700'
                            }`}>
                            {selectedPaymentMethod === option.id && <Check className="w-3.5 h-3.5 text-wh-brand-ink" strokeWidth={4} />}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div
                      className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 bg-white dark:bg-[#1a1a1a]"
                      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
                    >
                      <div className="flex-shrink-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Pay</p>
                        <p className="text-xl font-black text-wh-brand-ink tabular-nums">{RUPEE_SYMBOL}{total.toFixed(0)}</p>
                      </div>
                      <Button
                        onClick={() => setShowPaymentSheet(false)}
                        className="flex-1 bg-wh-brand hover:bg-wh-brand-600 text-wh-text h-11 rounded-xl text-sm font-bold shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98]"
                      >
                        Confirm Order
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Animation Styles */}
          <style>{`
        @keyframes fadeInBackdrop {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUpBannerSmooth {
          from { transform: translateY(100%) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes slideUpBanner {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmerBanner {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes scaleInBounce {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes checkMarkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; }
          50% { opacity: 1; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes slideUpFull {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideUpModal {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes checkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; }
        }
        @keyframes ringPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes sparkle {
          0% { transform: rotate(var(--rotation, 0deg)) translateY(0) scale(0); opacity: 1; }
          100% { transform: rotate(var(--rotation, 0deg)) translateY(-80px) scale(1); opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .animate-slideUpFull {
          animation: slideUpFull 0.3s ease-out;
        }
        .check-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 0;
        }
      `}</style>

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
      {unavailableLine && (() => {
        const channel = storeFulfilmentMode === "quick" ? "quick" : "shop"
        const alt = otherChannel(channel)
        const line = unavailableLine.item
        const close = () => setUnavailableLine(null)
        return (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1a1a1a] p-5 shadow-xl">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                {line.name}{line.variantName ? ` (${line.variantName})` : ""} isn't available in {CHANNEL_COPY[channel].label}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {unavailableLine.message || "Remove it to place your order."}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {unavailableLine.altAvailable === null && (
                  <p className="text-xs text-gray-500">Checking {CHANNEL_COPY[alt].label}…</p>
                )}
                {unavailableLine.altAvailable && (
                  <Button
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => {
                      if (addToOtherStoreCart(line, alt)) {
                        removeFromCart(line.id)
                        toast.success(`Moved to your ${CHANNEL_COPY[alt].label} cart (${CHANNEL_COPY[alt].eta})`)
                      } else {
                        toast.error("Couldn't move the item. Please try again.")
                      }
                      close()
                    }}
                  >
                    Move to {CHANNEL_COPY[alt].label} cart — {CHANNEL_COPY[alt].eta}
                  </Button>
                )}
                <Button variant="outline" className="w-full" onClick={() => { removeFromCart(line.id); close() }}>
                  Remove from cart
                </Button>
                <button type="button" className="text-xs text-gray-500 py-1" onClick={close}>Cancel</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
