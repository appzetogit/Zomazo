import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useNavigate } from "react-router-dom"
import { useLocation } from "@store/hooks/useLocation"
import { useStoreMode, QUICK_BASE } from "@store/context/StoreModeContext"
import { useZone } from "@store/hooks/useZone"
import { useProfile } from "@store/context/ProfileContext"
import {
  buildDisplayAddressText,
  buildEffectiveLocation,
  formatSavedAddress,
  getDeliveryAddressMode,
  notifyUserLocationChanged,
} from "@store/utils/deliveryLocationUtils"

const defaultDeliveryLocationContext = {
  liveLocation: null,
  effectiveLocation: null,
  deliveryAddressMode: "saved",
  displayAddressText: "Select Location",
  savedAddressText: "",
  defaultSavedAddress: null,
  loading: true,
  requestLocation: async () => null,
  requestLiveLocation: async () => null,
  zoneId: null,
  zone: null,
  zoneStatus: null,
  isInService: false,
  isOutOfService: false,
  zoneLoading: true,
  zoneError: null,
  refreshZone: () => {},
  commerceMode: "quick",
  setCommerceMode: () => {},
}

const DeliveryLocationContext = createContext(defaultDeliveryLocationContext)

export function DeliveryLocationProvider({ children }) {
  const { getDefaultAddress } = useProfile()
  const { location: liveLocation, loading, requestLocation } = useLocation()
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(getDeliveryAddressMode)
  const [addressRevision, setAddressRevision] = useState(0)
  // The storefront (shop "/" vs quick "/quick") is the commerce mode.
  // Switching mode means moving to the other storefront, which has its own cart.
  const { fulfilmentMode: commerceMode, mode: storeMode } = useStoreMode()
  const navigate = useNavigate()
  const setCommerceMode = useCallback((mode) => {
    const nextStore = mode === "standard" ? "shop" : "quick"
    if (nextStore === storeMode) return
    navigate(nextStore === "quick" ? QUICK_BASE : "/")
  }, [navigate, storeMode])

  useEffect(() => {
    const syncMode = () => setDeliveryAddressMode(getDeliveryAddressMode())
    const syncAddress = () => setAddressRevision((value) => value + 1)

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        syncMode()
        syncAddress()
      }
    }

    window.addEventListener("deliveryAddressModeChanged", syncMode)
    window.addEventListener("userLocationChanged", syncAddress)
    window.addEventListener("focus", syncMode)
    window.addEventListener("storage", syncMode)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      window.removeEventListener("deliveryAddressModeChanged", syncMode)
      window.removeEventListener("userLocationChanged", syncAddress)
      window.removeEventListener("focus", syncMode)
      window.removeEventListener("storage", syncMode)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  const defaultSavedAddress = useMemo(() => {
    void addressRevision
    return getDefaultAddress?.() || null
  }, [getDefaultAddress, addressRevision])

  const savedAddressText = useMemo(
    () => formatSavedAddress(defaultSavedAddress),
    [defaultSavedAddress],
  )

  const effectiveLocation = useMemo(
    () =>
      buildEffectiveLocation({
        deliveryAddressMode,
        defaultSavedAddress,
        liveLocation,
      }),
    [deliveryAddressMode, defaultSavedAddress, liveLocation],
  )

  const displayAddressText = useMemo(
    () =>
      buildDisplayAddressText({
        deliveryAddressMode,
        savedAddressText,
        effectiveLocation,
      }),
    [deliveryAddressMode, savedAddressText, effectiveLocation],
  )

  const {
    zoneId,
    zone,
    zoneStatus,
    isInService,
    isOutOfService,
    loading: zoneLoading,
    error: zoneError,
    refreshZone,
  } = useZone(effectiveLocation)

  useEffect(() => {
    if (
      !Number.isFinite(effectiveLocation?.latitude) ||
      !Number.isFinite(effectiveLocation?.longitude)
    ) {
      return
    }

    refreshZone()
  }, [
    deliveryAddressMode,
    effectiveLocation?.latitude,
    effectiveLocation?.longitude,
    refreshZone,
  ])

  const requestLiveLocation = useCallback(async () => {
    const loc = await requestLocation({ live: true })
    if (loc) {
      notifyUserLocationChanged(loc)
    }
    return loc
  }, [requestLocation])

  const value = useMemo(
    () => ({
      liveLocation,
      effectiveLocation,
      deliveryAddressMode,
      displayAddressText,
      savedAddressText,
      defaultSavedAddress,
      loading,
      requestLocation,
      requestLiveLocation,
      zoneId,
      zone,
      zoneStatus,
      // Zones only limit Quick (rider) delivery; the Shop store ships anywhere,
      // so outside the Quick store nobody is "out of service".
      isInService: commerceMode !== "quick" || isInService,
      isOutOfService: commerceMode === "quick" && isOutOfService,
      zoneLoading,
      zoneError,
      refreshZone,
      commerceMode,
      setCommerceMode,
    }),
    [
      liveLocation,
      effectiveLocation,
      deliveryAddressMode,
      displayAddressText,
      savedAddressText,
      defaultSavedAddress,
      loading,
      requestLocation,
      requestLiveLocation,
      zoneId,
      zone,
      zoneStatus,
      isInService,
      isOutOfService,
      zoneLoading,
      zoneError,
      refreshZone,
      commerceMode,
      setCommerceMode,
    ],
  )

  return (
    <DeliveryLocationContext.Provider value={value}>
      {children}
    </DeliveryLocationContext.Provider>
  )
}

export function useDeliveryLocation() {
  const context = useContext(DeliveryLocationContext)
  return context
}
