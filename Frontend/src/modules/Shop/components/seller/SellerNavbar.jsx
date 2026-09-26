import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Search, ChevronRight, MapPin, X, Bell } from "lucide-react"
import { sellerAPI } from "@store/api"
import { getCachedSettings, getModuleLogoUrl, loadBusinessSettings } from "@store/utils/businessSettings"
import useNotificationInbox from "@store/hooks/useNotificationInbox"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const extractSellerPayload = (response) =>
  response?.data?.data?.seller ||
  response?.data?.seller ||
  response?.data?.data?.user ||
  response?.data?.user ||
  response?.data?.data ||
  null


export default function SellerNavbar({
  sellerName: propSellerName,
  location: propLocation,
  showSearch = true,
  showOfflineOnlineTag = true,
  showNotifications = true,
}) {
  const navigate = useNavigate()
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [status, setStatus] = useState("Offline")
  const [sellerData, setSellerData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState("")
  const [logoUrl, setLogoUrl] = useState(null)
  const { unreadCount } = useNotificationInbox("seller", { limit: 20, pollMs: 5 * 60 * 1000 })

  // Load business settings for branding
  useEffect(() => {
    const loadSettings = async () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resolvedLogo = getModuleLogoUrl("seller")
        if (resolvedLogo) setLogoUrl(resolvedLogo)
      } else {
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.companyName) setCompanyName(settings.companyName)
          const resolvedLogo = getModuleLogoUrl("seller")
          if (resolvedLogo) setLogoUrl(resolvedLogo)
        }
      }
    }
    loadSettings()

    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resolvedLogo = getModuleLogoUrl("seller")
        if (resolvedLogo) setLogoUrl(resolvedLogo)
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
  }, [])

  // Fetch seller data on mount
  useEffect(() => {
    const fetchSellerData = async () => {
      try {
        setLoading(true)
        const response = await sellerAPI.getCurrentSeller()
        const data = extractSellerPayload(response)
        if (data) {
          setSellerData(data)
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching seller data:", error)
        }
        // Continue with default values if fetch fails
      } finally {
        setLoading(false)
      }
    }

    fetchSellerData()
  }, [])

  // Format full address from location object - using stored data only, no live fetching
  const formatAddress = (location) => {
    if (!location) return ""
    
    // Priority 1: Use formattedAddress if available (stored address from database)
    if (location.formattedAddress && location.formattedAddress.trim() !== "" && location.formattedAddress !== "Select location") {
      // Check if it's just coordinates (latitude, longitude format)
      const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(location.formattedAddress.trim())
      if (!isCoordinates) {
        return location.formattedAddress.trim()
      }
    }
    
    // Priority 2: Use address field if available
    if (location.address && location.address.trim() !== "") {
      return location.address.trim()
    }
    
    // Priority 3: Build from individual components
    const parts = []
    
    // Add street address (addressLine1 or street)
    if (location.addressLine1) {
      parts.push(location.addressLine1.trim())
    } else if (location.street) {
      parts.push(location.street.trim())
    }
    
    // Add addressLine2 if available
    if (location.addressLine2) {
      parts.push(location.addressLine2.trim())
    }
    
    // Add area if available
    if (location.area) {
      parts.push(location.area.trim())
    }
    
    // Add landmark if available
    if (location.landmark) {
      parts.push(location.landmark.trim())
    }
    
    // Add city if available and not already in area
    if (location.city) {
      const city = location.city.trim()
      // Only add city if it's not already included in previous parts
      const cityAlreadyIncluded = parts.some(part => part.toLowerCase().includes(city.toLowerCase()))
      if (!cityAlreadyIncluded) {
        parts.push(city)
      }
    }
    
    // Add state if available
    if (location.state) {
      const state = location.state.trim()
      // Only add state if it's not already included
      const stateAlreadyIncluded = parts.some(part => part.toLowerCase().includes(state.toLowerCase()))
      if (!stateAlreadyIncluded) {
        parts.push(state)
      }
    }
    
    // Add zipCode/pincode if available
    if (location.zipCode || location.pincode || location.postalCode) {
      const zip = (location.zipCode || location.pincode || location.postalCode).trim()
      parts.push(zip)
    }
    
    return parts.length > 0 ? parts.join(", ") : ""
  }

  // Get store name (use prop if provided, otherwise use fetched data)
  const sellerName = propSellerName || sellerData?.name || "Seller"

  const [location, setLocation] = useState("")

  // Update location when sellerData or propLocation changes
  useEffect(() => {
    let newLocation = ""
    
    // Priority 1: Explicit prop takes highest priority
    if (propLocation && propLocation.trim() !== "") {
      newLocation = propLocation.trim()
    }
    // Priority 2: Check sellerData location
    else if (sellerData) {
      debugLog('?? Checking seller data for address:', {
        hasLocation: !!sellerData.location,
        locationKeys: sellerData.location ? Object.keys(sellerData.location) : [],
        formattedAddress: sellerData.location?.formattedAddress,
        address: sellerData.location?.address,
        directAddress: sellerData.address,
        fullLocation: sellerData.location
      })
      
      if (sellerData.location) {
        // Use stored formattedAddress first (from database)
        if (sellerData.location.formattedAddress && 
            sellerData.location.formattedAddress.trim() !== "" && 
            sellerData.location.formattedAddress !== "Select location") {
          // Check if it's just coordinates (latitude, longitude format)
          const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(sellerData.location.formattedAddress.trim())
          if (!isCoordinates) {
            newLocation = sellerData.location.formattedAddress.trim()
            debugLog('? Using formattedAddress:', newLocation)
          }
        }
        
        // If formattedAddress is not available or is coordinates, try formatAddress function
        if (!newLocation) {
          const formatted = formatAddress(sellerData.location)
          if (formatted && formatted.trim() !== "") {
            newLocation = formatted.trim()
            debugLog('? Using formatAddress result:', newLocation)
          }
        }
        
        // Additional fallback: check if address is directly on location
        if (!newLocation && sellerData.location.address && sellerData.location.address.trim() !== "") {
          newLocation = sellerData.location.address.trim()
          debugLog('? Using location.address:', newLocation)
        }
      }
      
      // Priority 3: Fallback - check if address is directly on sellerData (not in location object)
      if (!newLocation && sellerData.address && sellerData.address.trim() !== "") {
        newLocation = sellerData.address.trim()
        debugLog('? Using sellerData.address:', newLocation)
      }
    }
    
    setLocation(newLocation)
    
    // Debug log
    if (newLocation) {
      debugLog('?? Seller address displayed:', newLocation)
    } else if (sellerData) {
      debugLog('?? Seller data available but no address found')
    }
  }, [sellerData, propLocation])

  // Prefer effective operational status (toggle + outlet timings), then localStorage, then accepting flag
  useEffect(() => {
    const updateStatus = () => {
      const operational = sellerData?.operationalStatus
      if (operational && typeof operational.isEffectivelyOnline === "boolean") {
        setStatus(operational.isEffectivelyOnline ? "Online" : "Offline")
        return
      }

      try {
        const savedStatus = localStorage.getItem('seller_online_status')
        if (savedStatus !== null) {
          const isOnline = JSON.parse(savedStatus)
          setStatus(isOnline ? "Online" : "Offline")
          return
        }
      } catch (error) {
        debugError("Error loading seller status:", error)
      }

      const isOnline = Boolean(sellerData?.isAcceptingOrders)
      setStatus(isOnline ? "Online" : "Offline")
    }

    updateStatus()

    const handleStatusChange = (event) => {
      const isOnline =
        event.detail?.isEffectivelyOnline ??
        event.detail?.isOnline ??
        false
      setStatus(isOnline ? "Online" : "Offline")
    }

    window.addEventListener('sellerStatusChanged', handleStatusChange)
    
    return () => {
      window.removeEventListener('sellerStatusChanged', handleStatusChange)
    }
  }, [sellerData])

  const handleStatusClick = () => {
    navigate("/seller/status")
  }

  const handleSearchClick = () => {
    setIsSearchActive(true)
  }

  const handleSearchClose = () => {
    setIsSearchActive(false)
    setSearchValue("")
  }

  const handleSearchChange = (e) => {
    setSearchValue(e.target.value)
  }



  const handleNotificationsClick = () => {
    navigate("/seller/notifications")
  }

  // Show search input when search is active
  if (isSearchActive) {
    return (
      <div className="md:hidden w-full bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchValue}
            onChange={handleSearchChange}
            placeholder="Search by order ID"
            className="w-full px-4 py-2 text-gray-900 placeholder-gray-500 focus:outline-none"
            autoFocus
          />
        </div>

        {/* Close Button */}
        <button
          onClick={handleSearchClose}
          className="w-6 h-6 bg-black rounded-full flex items-center justify-center shrink-0"
          aria-label="Close search"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      </div>
    )
  }

  return (
    <div className="md:hidden w-full bg-white/95 backdrop-blur-md border-b border-gray-100 px-4 py-3.5 flex items-center justify-between sticky top-0 z-[60]">
      {/* Left Side - Seller Info */}
      <div className="flex-1 min-w-0 pr-2 flex items-center gap-2.5">
        {logoUrl && (
          <img 
            src={logoUrl} 
            alt="Logo" 
            onClick={() => window.location.reload()}
            className="h-9 w-9 object-contain rounded-lg shadow-sm cursor-pointer active:scale-95 transition-transform" 
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-[14px] font-bold text-gray-900 truncate leading-none">
              {loading ? "Loading..." : (sellerName || "Seller")}
            </h1>

          </div>
          {!loading && location && location.trim() !== "" && (
            <div className="flex items-center gap-1 mt-1 opacity-70">
              <MapPin className="w-2 h-2 text-gray-400 shrink-0" />
              <p className="text-[9px] text-gray-500 truncate font-medium max-w-[150px]" title={location}>
                {location}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Interactive Elements */}
      <div className="flex items-center gap-0.5">
        {showOfflineOnlineTag && (
          <button
            onClick={handleStatusClick}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-xl hover:opacity-80 transition-all ${
              status === "Online" 
                ? "bg-green-50 border-green-100" 
                : "bg-gray-50 border-gray-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              status === "Online" ? "bg-green-500 animate-pulse" : "bg-gray-400"
            }`}></span>
            <span className={`text-[12px] font-bold hidden sm:inline ${
              status === "Online" ? "text-green-700" : "text-gray-600"
            }`}>
              {status}
            </span>
            <ChevronRight className={`w-3.5 h-3.5 ${
              status === "Online" ? "text-green-500" : "text-gray-400"
            }`} />
          </button>
        )}

        <div className="flex items-center">
          {showSearch && (
            <button
              onClick={handleSearchClick}
              className="p-1.5 hover:bg-gray-50 rounded-full transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5 text-gray-600" />
            </button>
          )}

          {showNotifications && (
            <button
              onClick={handleNotificationsClick}
              className="relative p-1.5 hover:bg-gray-50 rounded-full transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5 text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500 border border-white" />
              )}
            </button>
          )}


        </div>
      </div>
    </div>
  )
}
