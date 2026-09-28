import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from "react"
import { toast } from "sonner"
import { authAPI, userAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const ProfileContext = createContext(null)
const USER_SESSION_PREFERENCE_KEYS = ["userVegMode", "food-under-250-filters"]

const GUEST_FAVORITES_KEY = "userFavorites"
const GUEST_DISH_FAVORITES_KEY = "userDishFavorites"

const hasUserSession = () =>
  localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken")

const readGuestFavorites = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeGuestFavorites = (key, list) => {
  try {
    if (list?.length) localStorage.setItem(key, JSON.stringify(list))
    else localStorage.removeItem(key)
  } catch {
    // Storage full or blocked: the favourite still shows for this visit.
  }
}

// The server keys favourites by Mongo id. Cards built from mock or legacy data
// can carry a numeric id, which the server would reject, so only a real id is sent.
const isObjectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ""))

const restaurantIdOf = (fav) =>
  [fav?.restaurantId, fav?.mongoId, fav?._id, fav?.id].map((v) => String(v || "")).find(isObjectId) || null

// The same slug the restaurant cards fall back to when a restaurant has none,
// so a heart loaded from the server lights up on the card it came from.
const slugFromName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-")

const restaurantFavoriteFromServer = (r) => {
  const cuisine = Array.isArray(r?.cuisines) ? r.cuisines.filter(Boolean).join(", ") : ""
  const minutes = Number(r?.estimatedDeliveryTimeMinutes)
  return {
    id: String(r._id),
    restaurantId: String(r._id),
    slug: slugFromName(r.restaurantName) || String(r._id),
    name: r.restaurantName || "Restaurant",
    cuisine,
    rating: Number(r?.rating) || 0,
    deliveryTime: Number.isFinite(minutes) && minutes > 0 ? `${minutes} mins` : "",
    distance: "",
    image:
      r?.profileImage?.url || r?.profileImage ||
      r?.coverImage?.url || r?.coverImage ||
      (Array.isArray(r?.coverImages) ? r.coverImages[0]?.url || r.coverImages[0] : "") || "",
  }
}

const dishFavoriteFromServer = (f, restaurantById) => {
  const restaurant = restaurantById.get(String(f?.restaurantId || ""))
  return {
    id: String(f._id),
    name: f.name,
    description: f.description,
    price: f.price,
    originalPrice: f.otherPrice,
    image: f.image || (Array.isArray(f.images) ? f.images[0] : "") || "",
    restaurantId: String(f.restaurantId || ""),
    restaurantName: restaurant?.restaurantName || "",
    restaurantSlug: restaurant ? slugFromName(restaurant.restaurantName) : String(f.restaurantId || ""),
    foodType: f.foodType,
  }
}

export function ProfileProvider({ children }) {
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    const normalized = String(label || "").trim().toLowerCase()
    if (normalized === "home") return "Home"
    if (normalized === "office" || normalized === "work") return "Office"
    return "Other"
  }
  const normalizeAddress = (address) => {
    if (!address || typeof address !== "object") return null
    const id = getAddressId(address)
    return {
      ...address,
      label: normalizeAddressLabel(address.label),
      ...(id ? { id: String(id) } : {}),
    }
  }
  const dedupeAddressesByLabel = (addressList = []) => {
    const addressMap = new Map()
    addressList.forEach((addr, index) => {
      const normalizedAddress = normalizeAddress(addr)
      if (!normalizedAddress) return
      const key = normalizedAddress.label || getAddressId(normalizedAddress) || index
      // Keep latest address for each label so newly saved Home/Work/Other is visible immediately
      addressMap.set(key, normalizedAddress)
    })
    return Array.from(addressMap.values())
  }
  const [userProfile, setUserProfile] = useState(() => {
    const userStr = localStorage.getItem("user_user")
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch (e) {
        debugError("Error parsing user_user from localStorage:", e)
      }
    }
    const saved = localStorage.getItem("userProfile")
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        debugError("Error parsing userProfile from localStorage:", e)
      }
    }
    return null
  })
  
  const [loading, setLoading] = useState(true)

  const [addresses, setAddresses] = useState([])

  const [paymentMethods, setPaymentMethods] = useState(() => {
    const saved = localStorage.getItem("userPaymentMethods")
    return saved ? JSON.parse(saved) : []
  })

  // Favourites live on the server for a signed-in customer, so they follow them
  // to another phone. localStorage holds only what a signed-out visitor saves;
  // it is merged into the account on sign-in and then emptied, so one person's
  // favourites never show up for whoever signs in next on the same device.
  const [favorites, setFavorites] = useState(() => readGuestFavorites(GUEST_FAVORITES_KEY))
  const [dishFavorites, setDishFavorites] = useState(() => readGuestFavorites(GUEST_DISH_FAVORITES_KEY))
  // The latest lists, for the add/remove callbacks that must stay stable.
  const favoritesRef = useRef(favorites)
  favoritesRef.current = favorites
  const dishFavoritesRef = useRef(dishFavorites)
  dishFavoritesRef.current = dishFavorites

  /**
   * Load the account's favourites, first pushing up anything saved on this
   * device while signed out. Guest entries without a server id (built from
   * old or mock data) cannot be sent, so they stay on the device and in view.
   */
  const syncFavoritesFromServer = async () => {
    const guestRestaurants = readGuestFavorites(GUEST_FAVORITES_KEY)
    const guestDishes = readGuestFavorites(GUEST_DISH_FAVORITES_KEY)
    const sendable = (list, idOf) => list.filter((fav) => idOf(fav))
    const dishIdOf = (fav) => (isObjectId(fav?.id) ? String(fav.id) : null)

    const pushed = await Promise.allSettled([
      ...sendable(guestRestaurants, restaurantIdOf).map((fav) => userAPI.addFavoriteRestaurant(restaurantIdOf(fav))),
      ...sendable(guestDishes, dishIdOf).map((fav) => userAPI.addFavoriteFood(dishIdOf(fav))),
    ])
    // Clear the device copy only when every push landed; otherwise try again
    // on the next sign-in rather than lose a favourite.
    const leftRestaurants = guestRestaurants.filter((fav) => !restaurantIdOf(fav))
    const leftDishes = guestDishes.filter((fav) => !dishIdOf(fav))
    if (pushed.every((r) => r.status === "fulfilled")) {
      writeGuestFavorites(GUEST_FAVORITES_KEY, leftRestaurants)
      writeGuestFavorites(GUEST_DISH_FAVORITES_KEY, leftDishes)
    }

    const response = await userAPI.getFavorites()
    const data = response?.data?.data || {}
    const restaurants = Array.isArray(data.restaurants) ? data.restaurants : []
    const foods = Array.isArray(data.foods) ? data.foods : []
    const restaurantById = new Map(restaurants.map((r) => [String(r._id), r]))

    // Prefer the card the customer saved (it has distance, price range and the
    // exact slug) over the rebuilt one, when the device still has it.
    const localRestaurantById = new Map(
      [...favoritesRef.current, ...guestRestaurants]
        .map((fav) => [restaurantIdOf(fav), fav])
        .filter(([id]) => id),
    )
    const serverRestaurants = restaurants.map(
      (r) => localRestaurantById.get(String(r._id)) || restaurantFavoriteFromServer(r),
    )
    const localDishById = new Map(
      [...dishFavoritesRef.current, ...guestDishes].filter((fav) => dishIdOf(fav)).map((fav) => [String(fav.id), fav]),
    )
    const serverDishes = foods.map((f) => localDishById.get(String(f._id)) || dishFavoriteFromServer(f, restaurantById))

    const dedupe = (list, keyOf) => {
      const seen = new Set()
      return list.filter((item) => {
        const key = keyOf(item)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    setFavorites(dedupe([...serverRestaurants, ...leftRestaurants], (fav) => fav.slug))
    setDishFavorites(dedupe([...serverDishes, ...leftDishes], (fav) => `${fav.id}|${fav.restaurantId}`))
  }

  // VegMode state - stored in localStorage for persistence
  const [vegMode, setVegMode] = useState(() => {
    const saved = localStorage.getItem("userVegMode")
    // Default to false (OFF) if not set
    return saved !== null ? saved === "true" : false
  })

  // Helper to check if authenticated
  const isAuthenticated = useMemo(() => {
    return localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken")
  }, [userProfile])

  // Save to localStorage whenever userProfile, addresses or paymentMethods change
  useEffect(() => {
    if (userProfile || isAuthenticated) {
      localStorage.setItem("userProfile", JSON.stringify(userProfile))
    }
  }, [userProfile, isAuthenticated])

  useEffect(() => {
    if (addresses.length > 0 || isAuthenticated) {
      localStorage.setItem("userAddresses", JSON.stringify(addresses))
    }
  }, [addresses, isAuthenticated])

  useEffect(() => {
    if (paymentMethods.length > 0 || isAuthenticated) {
      localStorage.setItem("userPaymentMethods", JSON.stringify(paymentMethods))
    }
  }, [paymentMethods, isAuthenticated])

  // Only a signed-out visitor's favourites are kept on the device (see above).
  useEffect(() => {
    if (!hasUserSession()) writeGuestFavorites(GUEST_FAVORITES_KEY, favorites)
  }, [favorites])

  useEffect(() => {
    if (!hasUserSession()) writeGuestFavorites(GUEST_DISH_FAVORITES_KEY, dishFavorites)
  }, [dishFavorites])

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem("userVegMode", vegMode.toString())
    }
  }, [vegMode, isAuthenticated])

  // Fetch user profile and addresses from API on mount and when authentication changes
  useEffect(() => {
    const fetchUserProfile = async () => {
      // Check if user is authenticated
      const isAuthenticated = localStorage.getItem("user_authenticated") === "true" || 
                             localStorage.getItem("user_accessToken")
      
      if (!isAuthenticated) {
        setUserProfile(null)
        setAddresses([])
        setPaymentMethods([])
        setFavorites(readGuestFavorites(GUEST_FAVORITES_KEY))
        setDishFavorites(readGuestFavorites(GUEST_DISH_FAVORITES_KEY))
        setVegMode(false)
        USER_SESSION_PREFERENCE_KEYS.forEach((key) => {
          localStorage.removeItem(key)
        })
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        
        // Fetch user profile
        const response = await authAPI.getCurrentUser()
        const userData = response?.data?.data?.user || response?.data?.user || response?.data
        
        if (userData) {
          setUserProfile(userData)
          // Update localStorage
          localStorage.setItem("user_user", JSON.stringify(userData))
          localStorage.setItem("userProfile", JSON.stringify(userData))
        }

        // Favourites load alongside the addresses; a failure here leaves the
        // hearts as they were rather than blanking them.
        syncFavoritesFromServer().catch((favoritesError) => {
          debugError("Error fetching favorites:", favoritesError)
        })

        // Fetch addresses
        try {
          const addressesResponse = await userAPI.getAddresses()
          const addressesData = addressesResponse?.data?.data?.addresses || addressesResponse?.data?.addresses || []
          const normalizedAddresses = dedupeAddressesByLabel(addressesData)
          setAddresses(normalizedAddresses)
          localStorage.setItem("userAddresses", JSON.stringify(normalizedAddresses))
        } catch (addressError) {
          debugError("Error fetching addresses:", addressError)
          // Try to load from localStorage as fallback
          const saved = localStorage.getItem("userAddresses")
          if (saved) {
            try {
              setAddresses(dedupeAddressesByLabel(JSON.parse(saved)))
            } catch (e) {
              debugError("Error parsing saved addresses:", e)
            }
          }
        }
      } catch (error) {
        // Silently handle error - use existing profile from localStorage
        debugError("Error fetching user profile:", error)
        // Try to load from localStorage as fallback
        const saved = localStorage.getItem("userAddresses")
        if (saved) {
          try {
            setAddresses(dedupeAddressesByLabel(JSON.parse(saved)))
          } catch (e) {
            debugError("Error parsing saved addresses:", e)
          }
        }
      } finally {
        setLoading(false)
      }
    }

    fetchUserProfile()
    
    // Listen for auth changes
    const handleAuthChange = () => {
      fetchUserProfile()
    }
    
    window.addEventListener("userAuthChanged", handleAuthChange)
    
    return () => {
      window.removeEventListener("userAuthChanged", handleAuthChange)
    }
  }, [])

  // Address functions - memoized with useCallback
  const addAddress = useCallback(async (address) => {
    try {
      const response = await userAPI.addAddress(address)
      const newAddress = response?.data?.data?.address || response?.data?.address
      
      if (newAddress) {
        const normalizedNewAddress = normalizeAddress(newAddress)
        setAddresses((prev) => {
          const filtered = prev.filter(
            (addr) => normalizeAddressLabel(addr?.label) !== normalizeAddressLabel(normalizedNewAddress?.label)
          )
          const updated = dedupeAddressesByLabel([...filtered, normalizedNewAddress])
          localStorage.setItem("userAddresses", JSON.stringify(updated))
          return updated
        })
        return normalizedNewAddress
      }
    } catch (error) {
      debugError("Error adding address:", error)
      throw error
    }
  }, [])

  const updateAddress = useCallback(async (id, updatedAddress) => {
    try {
      const response = await userAPI.updateAddress(id, updatedAddress)
      const updatedAddr = response?.data?.data?.address || response?.data?.address
      
      if (updatedAddr) {
        const normalizedUpdatedAddress = normalizeAddress(updatedAddr)
        setAddresses((prev) => {
          const updated = dedupeAddressesByLabel(
            prev.map((addr) => (String(getAddressId(addr)) === String(id) ? normalizedUpdatedAddress : normalizeAddress(addr)))
          )
          localStorage.setItem("userAddresses", JSON.stringify(updated))
          return updated
        })
        return normalizedUpdatedAddress
      }
    } catch (error) {
      debugError("Error updating address:", error)
      throw error
    }
  }, [])

  const deleteAddress = useCallback(async (id) => {
    try {
      await userAPI.deleteAddress(id)
      setAddresses((prev) => {
        const newAddresses = prev.filter((addr) => String(getAddressId(addr)) !== String(id))
        localStorage.setItem("userAddresses", JSON.stringify(newAddresses))
        return newAddresses
      })
    } catch (error) {
      debugError("Error deleting address:", error)
      throw error
    }
  }, [])

  const setDefaultAddress = useCallback(async (id) => {
    // Optimistic UI update first
    setAddresses((prev) =>
      prev.map((addr) => ({
        ...addr,
        isDefault: String(getAddressId(addr)) === String(id),
      }))
    )

    try {
      await userAPI.setDefaultAddress(id)
    } catch (error) {
      debugError("Error setting default address:", error)
      // Keep UI stable even if backend call fails
    }
  }, [])

  const getDefaultAddress = useCallback(() => {
    return addresses.find((addr) => addr.isDefault) || addresses[0] || null
  }, [addresses])

  // Payment method functions - memoized with useCallback
  const addPaymentMethod = useCallback((payment) => {
    setPaymentMethods((prev) => {
      const newPayment = {
        ...payment,
        id: Date.now().toString(),
        isDefault: prev.length === 0 ? true : false,
      }
      return [...prev, newPayment]
    })
  }, [])

  const updatePaymentMethod = useCallback((id, updatedPayment) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => (pm.id === id ? { ...pm, ...updatedPayment } : pm))
    )
  }, [])

  const deletePaymentMethod = useCallback((id) => {
    setPaymentMethods((prev) => {
      const paymentToDelete = prev.find((pm) => pm.id === id)
      const newPayments = prev.filter((pm) => pm.id !== id)
      
      // If deleting default, set first remaining as default
      if (paymentToDelete?.isDefault && newPayments.length > 0) {
        newPayments[0].isDefault = true
      }
      
      return newPayments
    })
  }, [])

  const setDefaultPaymentMethod = useCallback((id) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => ({
        ...pm,
        isDefault: pm.id === id,
      }))
    )
  }, [])

  const getDefaultPaymentMethod = useCallback(() => {
    return paymentMethods.find((pm) => pm.isDefault) || paymentMethods[0] || null
  }, [paymentMethods])

  const getAddressById = useCallback((id) => {
    return addresses.find((addr) => String(getAddressId(addr)) === String(id))
  }, [addresses])

  const getPaymentMethodById = useCallback((id) => {
    return paymentMethods.find((pm) => pm.id === id)
  }, [paymentMethods])

  // Favorites functions - memoized with useCallback
  //
  // Hearts flip at once and the server is told afterwards; if the server says
  // no, the heart flips back and the customer is told, rather than showing a
  // favourite that will be gone on their next visit.
  const addFavorite = useCallback((restaurant) => {
    if (!restaurant?.slug) return
    setFavorites((prev) => {
      if (!prev.find(fav => fav.slug === restaurant.slug)) {
        return [...prev, restaurant]
      }
      return prev
    })
    const id = restaurantIdOf(restaurant)
    if (!hasUserSession() || !id) return
    userAPI.addFavoriteRestaurant(id).catch((error) => {
      debugError("Error saving favorite:", error)
      setFavorites((prev) => prev.filter(fav => fav.slug !== restaurant.slug))
      toast.error("Could not save this favourite. Please try again.")
    })
  }, [])

  const removeFavorite = useCallback((slug) => {
    const removed = favoritesRef.current.find(fav => fav.slug === slug) || null
    setFavorites((prev) => prev.filter(fav => fav.slug !== slug))
    // A device-only entry kept after sign-in must not come back on reload.
    writeGuestFavorites(
      GUEST_FAVORITES_KEY,
      readGuestFavorites(GUEST_FAVORITES_KEY).filter(fav => fav.slug !== slug),
    )
    const id = restaurantIdOf(removed)
    if (!hasUserSession() || !id) return
    userAPI.removeFavoriteRestaurant(id).catch((error) => {
      debugError("Error removing favorite:", error)
      setFavorites((prev) => (prev.some(fav => fav.slug === slug) ? prev : [...prev, removed]))
      toast.error("Could not remove this favourite. Please try again.")
    })
  }, [])

  const isFavorite = useCallback((slug) => {
    return favorites.some(fav => fav.slug === slug)
  }, [favorites])

  const getFavorites = useCallback(() => {
    return favorites
  }, [favorites])

  // Dish favorites functions - memoized with useCallback
  // Ids are compared as strings: the server sends strings, while a card may
  // hold the same id as an ObjectId-like value or a number.
  const sameDish = (fav, dishId, restaurantId) =>
    String(fav?.id) === String(dishId) && String(fav?.restaurantId) === String(restaurantId)

  const addDishFavorite = useCallback((dish) => {
    if (!dish?.id) return
    setDishFavorites((prev) => {
      if (!prev.find(fav => sameDish(fav, dish.id, dish.restaurantId))) {
        return [...prev, dish]
      }
      return prev
    })
    if (!hasUserSession() || !isObjectId(dish.id)) return
    userAPI.addFavoriteFood(String(dish.id)).catch((error) => {
      debugError("Error saving dish favorite:", error)
      setDishFavorites((prev) => prev.filter(fav => !sameDish(fav, dish.id, dish.restaurantId)))
      toast.error("Could not save this dish. Please try again.")
    })
  }, [])

  const removeDishFavorite = useCallback((dishId, restaurantId) => {
    const removed = dishFavoritesRef.current.find(fav => sameDish(fav, dishId, restaurantId)) || null
    setDishFavorites((prev) => prev.filter(fav => !sameDish(fav, dishId, restaurantId)))
    writeGuestFavorites(
      GUEST_DISH_FAVORITES_KEY,
      readGuestFavorites(GUEST_DISH_FAVORITES_KEY).filter(fav => !sameDish(fav, dishId, restaurantId)),
    )
    if (!hasUserSession() || !isObjectId(dishId)) return
    userAPI.removeFavoriteFood(String(dishId)).catch((error) => {
      debugError("Error removing dish favorite:", error)
      if (removed) {
        setDishFavorites((prev) => (prev.some(fav => sameDish(fav, dishId, restaurantId)) ? prev : [...prev, removed]))
      }
      toast.error("Could not remove this dish. Please try again.")
    })
  }, [])

  const isDishFavorite = useCallback((dishId, restaurantId) => {
    return dishFavorites.some(fav => sameDish(fav, dishId, restaurantId))
  }, [dishFavorites])

  const getDishFavorites = useCallback(() => {
    return dishFavorites
  }, [dishFavorites])

  // User profile functions - memoized with useCallback
  const updateUserProfile = useCallback((updatedProfile) => {
    setUserProfile((prev) => ({ ...prev, ...updatedProfile }))
  }, [])

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({
      userProfile,
      loading,
      updateUserProfile,
      addresses,
      paymentMethods,
      favorites,
      vegMode,
      setVegMode,
      addAddress,
      updateAddress,
      deleteAddress,
      setDefaultAddress,
      getDefaultAddress,
      getAddressById,
      addPaymentMethod,
      updatePaymentMethod,
      deletePaymentMethod,
      setDefaultPaymentMethod,
      getDefaultPaymentMethod,
      getPaymentMethodById,
      addFavorite,
      removeFavorite,
      isFavorite,
      getFavorites,
      dishFavorites,
      addDishFavorite,
      removeDishFavorite,
      isDishFavorite,
      getDishFavorites,
    }),
    [
      userProfile,
      loading,
      updateUserProfile,
      addresses,
      paymentMethods,
      favorites,
      dishFavorites,
      vegMode,
      setVegMode,
      addAddress,
      updateAddress,
      deleteAddress,
      setDefaultAddress,
      getDefaultAddress,
      getAddressById,
      addPaymentMethod,
      updatePaymentMethod,
      deletePaymentMethod,
      setDefaultPaymentMethod,
      getDefaultPaymentMethod,
      getPaymentMethodById,
      addFavorite,
      removeFavorite,
      isFavorite,
      getFavorites,
      addDishFavorite,
      removeDishFavorite,
      isDishFavorite,
      getDishFavorites,
    ]
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) {
    // Return fallback values instead of throwing error
    // This prevents crashes when ProfileProvider is not available
    debugWarn("useProfile called outside ProfileProvider - using fallback values")
    return {
      userProfile: null,
      loading: false,
      updateUserProfile: () => debugWarn("ProfileProvider not available"),
      addresses: [],
      paymentMethods: [],
      favorites: [],
      addAddress: () => debugWarn("ProfileProvider not available"),
      updateAddress: () => debugWarn("ProfileProvider not available"),
      deleteAddress: () => debugWarn("ProfileProvider not available"),
      setDefaultAddress: () => debugWarn("ProfileProvider not available"),
      getDefaultAddress: () => null,
      getAddressById: () => null,
      addPaymentMethod: () => debugWarn("ProfileProvider not available"),
      updatePaymentMethod: () => debugWarn("ProfileProvider not available"),
      deletePaymentMethod: () => debugWarn("ProfileProvider not available"),
      setDefaultPaymentMethod: () => debugWarn("ProfileProvider not available"),
      getDefaultPaymentMethod: () => null,
      getPaymentMethodById: () => null,
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      dishFavorites: [],
      addDishFavorite: () => debugWarn("ProfileProvider not available"),
      removeDishFavorite: () => debugWarn("ProfileProvider not available"),
      isDishFavorite: () => false,
      getDishFavorites: () => [],
      vegMode: false,
      setVegMode: () => debugWarn("ProfileProvider not available")
    }
  }
  return context
}


