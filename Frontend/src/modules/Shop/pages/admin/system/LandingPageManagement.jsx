import { useState, useEffect, useRef, useMemo } from "react"
import { Upload, Trash2, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, ArrowUp, ArrowDown, Layout, Megaphone, Search } from "lucide-react"
import api from "@store/api"
import { adminAPI } from "@store/api"
import { getModuleToken } from "@store/utils/auth"
import { Input } from "@store/components/ui/input"
import { Label } from "@store/components/ui/label"
import { Button } from "@store/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@store/components/ui/dialog"
import { Checkbox } from "@store/components/ui/checkbox"
import { resolveMediaUrl } from "../../../../../shared/utils/mediaUrl.js"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function LandingPageManagement() {
  const [activeTab, setActiveTab] = useState('top-banners')
  const [exploreMoreSubTab, setExploreMoreSubTab] = useState('icons')


  // Top Banners
  const [topBanners, setTopBanners] = useState([])
  const [topBannersLoading, setTopBannersLoading] = useState(true)
  const [topBannersUploading, setTopBannersUploading] = useState(false)
  const [topBannersUploadProgress, setTopBannersUploadProgress] = useState({ current: 0, total: 0 })
  const [topBannersDeleting, setTopBannersDeleting] = useState(null)
  const topBannersFileInputRef = useRef(null)

  // Hero Banners
  const [banners, setBanners] = useState([])
  const [bannersLoading, setBannersLoading] = useState(true)
  const [bannersUploading, setBannersUploading] = useState(false)
  const [bannersUploadProgress, setBannersUploadProgress] = useState({ current: 0, total: 0 })
  const [bannersDeleting, setBannersDeleting] = useState(null)
  const bannersFileInputRef = useRef(null)

  // Explore More
  const [exploreMore, setExploreMore] = useState([])
  const [exploreMoreLoading, setExploreMoreLoading] = useState(true)
  const [exploreMoreUploading, setExploreMoreUploading] = useState(false)
  const [exploreMoreDeleting, setExploreMoreDeleting] = useState(null)
  const [exploreMoreLabel, setExploreMoreLabel] = useState("")
  const [exploreMoreLink, setExploreMoreLink] = useState("")
  const [exploreIconsUploading, setExploreIconsUploading] = useState({})
  const exploreMoreFileInputRef = useRef(null)

  // Settings
  const [settings, setSettings] = useState({ exploreMoreHeading: "Explore More", recommendedSellerIds: [] })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [recommendedSearchQuery, setRecommendedSearchQuery] = useState("")

  const [allSellers, setAllSellers] = useState([])
  const [sellersLoading, setSellersLoading] = useState(false)

  // Common
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Seller Selection Modal for Banner Advertising
  const [showSellerModal, setShowSellerModal] = useState(false)
  const [selectedBannerId, setSelectedBannerId] = useState(null)
  const [selectedSellerIds, setSelectedSellerIds] = useState([])
  const [sellerSearchQuery, setSellerSearchQuery] = useState("")
  const [linkingSellers, setLinkingSellers] = useState(false)

  // Helper function to filter out token-related errors
  const setErrorSafely = (errorMessage) => {
    if (!errorMessage) {
      setError(null)
      return
    }
    const lowerMessage = errorMessage.toLowerCase()
    // Don't show token/unauthorized/auth errors
    if (lowerMessage.includes('token') ||
      lowerMessage.includes('unauthorized') ||
      lowerMessage.includes('no token') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('session expired') ||
      lowerMessage.includes('insufficient permissions for this action')) {
      setError(null)
    } else {
      setError(errorMessage)
    }
  }

  // Helper function to get admin token and add to request config
  const getAuthConfig = (additionalConfig = {}) => {
    const adminToken = getModuleToken('admin')

    // Debug logging in development
    if (import.meta.env.DEV) {
      debugLog('[LandingPageManagement] Token check:', {
        token: adminToken ? 'exists' : 'missing',
        tokenLength: adminToken?.length || 0,
        path: window.location.pathname
      })
    }

    if (!adminToken || adminToken.trim() === '' || adminToken === 'null' || adminToken === 'undefined') {
      // Token not found, return config without auth header (will be handled by error)
      debugWarn('[LandingPageManagement] Admin token not found!')
      return additionalConfig
    }

    // Merge headers properly - ensure Authorization is always set
    const mergedHeaders = {
      ...additionalConfig.headers,
      Authorization: `Bearer ${adminToken.trim()}`,
    }

    return {
      ...additionalConfig,
      headers: mergedHeaders,
    }
  }

  // Fetch data on mount (authentication is handled by ProtectedRoute)
  useEffect(() => {

    fetchTopBanners()
    fetchBanners()
    fetchSettings()
  }, [])

  // Fetch explore icons when Explore More tab is active; refetch sellers so dropdown is populated
  useEffect(() => {
    if (activeTab === 'explore-more') {
      if (allSellers.length === 0) {
        fetchAllSellers()
      }
      if (exploreMoreSubTab === 'icons') {
        fetchExploreMore()
      }
    }
  }, [activeTab, exploreMoreSubTab])


  // ==================== TOP BANNERS ====================
  const fetchTopBanners = async () => {
    try {
      setTopBannersLoading(true)
      setError(null)
      const response = await api.get('/content/top-banners', getAuthConfig())
      if (response.data.success) {
        setTopBanners(response.data.data.banners || [])
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setTopBanners([])
        setError(null)
      } else if (err.response?.status === 404) {
        setTopBanners([])
        setError(null)
      } else {
        setErrorSafely(err.response?.data?.message || 'Failed to load top banners')
      }
    } finally {
      setTopBannersLoading(false)
    }
  }

  const handleTopBannerFileSelect = (e) => {
    const files = Array.from(e.target?.files || e.files || [])
    if (files.length === 0) return
    if (files.length > 5) {
      setError('You can upload a maximum of 5 images at once')
      return
    }
    uploadTopBanners(files)
  }

  const uploadTopBanners = async (files) => {
    try {
      const adminToken = getModuleToken('admin')
      if (!adminToken || adminToken.trim() === '' || adminToken === 'null' || adminToken === 'undefined') {
        setErrorSafely('Authentication required. Please login again.')
        return
      }

      setTopBannersUploading(true)
      setError(null)
      setSuccess(null)
      setTopBannersUploadProgress({ current: 0, total: files.length })

      const formData = new FormData()
      files.forEach((file) => {
        formData.append('files', file)
      })

      const config = getAuthConfig()
      const response = await api.post('/content/top-banners/multiple', formData, config)

      if (response.data.success) {
        const uploadedBanners = response.data.data?.banners || []
        const errors = response.data.data?.errors || []
        const successCount = uploadedBanners.length
        const failCount = errors.length

        await fetchTopBanners()
        if (topBannersFileInputRef.current) topBannersFileInputRef.current.value = ''

        if (failCount === 0) {
          setSuccess(`${successCount} top banner${successCount > 1 ? 's' : ''} uploaded successfully!`)
          setTimeout(() => setSuccess(null), 5000)
        } else if (successCount > 0) {
          setSuccess(`${successCount} banner${successCount > 1 ? 's' : ''} uploaded, ${failCount} failed.`)
          setErrorSafely(errors.join(', '))
          setTimeout(() => { setSuccess(null); setError(null) }, 5000)
        } else {
          setErrorSafely(`Failed to upload banners. ${errors.join(', ')}`)
        }
      } else {
        setErrorSafely(response.data.message || 'Failed to upload banners')
      }

      setTopBannersUploadProgress({ current: 0, total: 0 })
    } catch (err) {
      if (err.response?.status === 401 || err.message === 'Authentication token not found') {
        setError(null)
      } else {
        setErrorSafely(err.response?.data?.message || 'Failed to upload banners')
      }
      setTopBannersUploadProgress({ current: 0, total: 0 })
    } finally {
      setTopBannersUploading(false)
    }
  }

  const handleDeleteTopBanner = async (id) => {
    if (!window.confirm('Are you sure you want to delete this top banner?')) return
    try {
      setTopBannersDeleting(id)
      setError(null)
      setSuccess(null)
      const response = await api.delete(`/content/top-banners/${id}`, getAuthConfig())
      if (response.data.success) {
        setSuccess('Top banner deleted successfully!')
        await fetchTopBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to delete banner.')
    } finally {
      setTopBannersDeleting(null)
    }
  }

  const handleToggleTopBannerStatus = async (id, currentStatus) => {
    try {
      setError(null)
      setSuccess(null)
      const response = await api.patch(`/content/top-banners/${id}/status`, {}, getAuthConfig())
      if (response.data.success) {
        setSuccess(`Banner ${currentStatus ? 'deactivated' : 'activated'} successfully!`)
        await fetchTopBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to update banner status.')
    }
  }

  const handleTopBannerOrderChange = async (id, direction) => {
    const banner = topBanners.find(b => b._id === id)
    if (!banner) return
    const newOrder = direction === 'up' ? banner.order - 1 : banner.order + 1
    const otherBanner = topBanners.find(b => b.order === newOrder && b._id !== id)
    if (!otherBanner && newOrder < 0) return
    try {
      setError(null)
      await api.patch(`/content/top-banners/${id}/order`, { order: newOrder }, getAuthConfig())
      if (otherBanner) {
        await api.patch(`/content/top-banners/${otherBanner._id}/order`, { order: banner.order }, getAuthConfig())
      }
      await fetchTopBanners()
    } catch (err) {
      setErrorSafely('Failed to update banner order.')
    }
  }

  // ==================== HERO BANNERS ====================
  const fetchBanners = async () => {
    try {
      setBannersLoading(true)
      setError(null)
      const response = await api.get('/content/hero-banners', getAuthConfig())
      if (response.data.success) {
        setBanners(response.data.data.banners || [])
      }
    } catch (err) {
      // Handle 401/404 errors gracefully - don't show error messages
      if (err.response?.status === 401) {
        // Token expired or invalid - will be handled by axios interceptor
        // Don't show error message or set banners
        setBanners([])
        setError(null)
      } else if (err.response?.status === 404) {
        // Endpoint doesn't exist, set empty array
        setBanners([])
        setError(null)
      } else {
        // Filter out token-related errors
        const errorMessage = err.response?.data?.message || 'Failed to load hero banners'
        setErrorSafely(errorMessage)
      }
    } finally {
      setBannersLoading(false)
    }
  }

  /**
   * Server ceiling, mirrored here so an oversized file is rejected instantly
   * rather than after uploading megabytes only to be refused.
   *
   * Animated GIFs are the reason this matters — they are by far the largest
   * thing a banner upload carries, and a slow connection can spend minutes on
   * one before the server says no.
   */
  const MAX_BANNER_MB = 50

  const oversizedFile = (files) =>
    files.find((file) => file.size > MAX_BANNER_MB * 1024 * 1024)

  const handleBannerFileSelect = (e) => {
    const files = Array.from(e.target?.files || e.files || [])
    if (files.length === 0) return
    if (files.length > 5) {
      setError('You can upload a maximum of 5 images at once')
      return
    }
    const tooBig = oversizedFile(files)
    if (tooBig) {
      setError(
        `"${tooBig.name}" is ${(tooBig.size / (1024 * 1024)).toFixed(1)}MB. Maximum is ${MAX_BANNER_MB}MB.`,
      )
      return
    }
    uploadBanners(files)
  }

  const uploadBanners = async (files) => {
    try {
      // Check token first before proceeding
      const adminToken = getModuleToken('admin')
      if (!adminToken || adminToken.trim() === '' || adminToken === 'null' || adminToken === 'undefined') {
        setErrorSafely('Authentication required. Please login again.')
        return
      }

      setBannersUploading(true)
      setError(null)
      setSuccess(null)
      setBannersUploadProgress({ current: 0, total: files.length })

      // Use batch upload endpoint for multiple files
      const formData = new FormData()
      files.forEach((file) => {
        // Backend expects field name "files" (upload.array('files'))
        formData.append('files', file)
      })

      // Use getAuthConfig to ensure proper Authorization header
      // Don't set Content-Type - axios will set it automatically with boundary for FormData
      const config = getAuthConfig()

      // Debug: Log the config to verify Authorization header is set
      if (import.meta.env.DEV) {
        debugLog('[uploadBanners] Request config:', {
          hasAuthHeader: !!config.headers?.Authorization,
          authHeaderPrefix: config.headers?.Authorization?.substring(0, 20),
          hasFormData: formData instanceof FormData
        })
      }

      const response = await api.post('/content/hero-banners/multiple', formData, config)

      if (response.data.success) {
        const uploadedBanners = response.data.data?.banners || []
        const errors = response.data.data?.errors || []
        const successCount = uploadedBanners.length
        const failCount = errors.length

        await fetchBanners()
        if (bannersFileInputRef.current) bannersFileInputRef.current.value = ''

        if (failCount === 0) {
          setSuccess(`${successCount} hero banner${successCount > 1 ? 's' : ''} uploaded successfully!`)
          setTimeout(() => setSuccess(null), 5000)
        } else if (successCount > 0) {
          setSuccess(`${successCount} banner${successCount > 1 ? 's' : ''} uploaded, ${failCount} failed.`)
          setErrorSafely(errors.join(', '))
          setTimeout(() => { setSuccess(null); setError(null) }, 5000)
        } else {
          setErrorSafely(`Failed to upload banners. ${errors.join(', ')}`)
        }
      } else {
        setErrorSafely(response.data.message || 'Failed to upload banners')
      }

      setBannersUploadProgress({ current: 0, total: 0 })
    } catch (err) {
      debugError('Error uploading banners:', err)

      // Handle 401 unauthorized errors - don't show token-related errors
      if (err.response?.status === 401 || err.message === 'Authentication token not found') {
        // Don't show error - let axios interceptor handle logout
        setError(null)
      } else {
        // Filter out token-related errors
        const errorMessage = err.response?.data?.message || 'Failed to upload banners'
        setErrorSafely(errorMessage)
      }

      setBannersUploadProgress({ current: 0, total: 0 })
    } finally {
      setBannersUploading(false)
    }
  }

  const handleDeleteBanner = async (id) => {
    if (!window.confirm('Are you sure you want to delete this hero banner?')) return
    try {
      setBannersDeleting(id)
      setError(null)
      setSuccess(null)
      const response = await api.delete(`/content/hero-banners/${id}`, getAuthConfig())
      if (response.data.success) {
        setSuccess('Hero banner deleted successfully!')
        await fetchBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to delete banner.')
    } finally {
      setBannersDeleting(null)
    }
  }

  const handleToggleBannerStatus = async (id, currentStatus) => {
    try {
      setError(null)
      setSuccess(null)
      const response = await api.patch(`/content/hero-banners/${id}/status`, {}, getAuthConfig())
      if (response.data.success) {
        setSuccess(`Banner ${currentStatus ? 'deactivated' : 'activated'} successfully!`)
        await fetchBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to update banner status.')
    }
  }

  const handleBannerOrderChange = async (id, direction) => {
    const banner = banners.find(b => b._id === id)
    if (!banner) return
    const newOrder = direction === 'up' ? banner.order - 1 : banner.order + 1
    const otherBanner = banners.find(b => b.order === newOrder && b._id !== id)
    if (!otherBanner && newOrder < 0) return
    try {
      setError(null)
      await api.patch(`/content/hero-banners/${id}/order`, { order: newOrder }, getAuthConfig())
      if (otherBanner) {
        await api.patch(`/content/hero-banners/${otherBanner._id}/order`, { order: banner.order }, getAuthConfig())
      }
      await fetchBanners()
    } catch (err) {
      setErrorSafely('Failed to update banner order.')
    }
  }

  // Handle seller selection for banner advertising
  const handleLinkSellers = async () => {
    if (!selectedBannerId) return

    try {
      setLinkingSellers(true)
      setError(null)
      setSuccess(null)

      const response = await api.patch(
        `/content/hero-banners/${selectedBannerId}/link-sellers`,
        { sellerIds: selectedSellerIds },
        getAuthConfig()
      )

      if (response.data.success) {
        setSuccess('Sellers linked to banner successfully!')
        setShowSellerModal(false)
        setSelectedBannerId(null)
        setSelectedSellerIds([])
        setSellerSearchQuery("")
        await fetchBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to link sellers to banner.')
    } finally {
      setLinkingSellers(false)
    }
  }

  const toggleSellerSelection = (sellerId) => {
    setSelectedSellerIds(prev => {
      if (prev.includes(sellerId)) {
        return prev.filter(id => id !== sellerId)
      } else {
        return [...prev, sellerId]
      }
    })
  }

  const filteredSellersForModal = allSellers.filter(seller => {
    if (!sellerSearchQuery.trim()) return true
    const query = sellerSearchQuery.toLowerCase()
    return seller.name?.toLowerCase().includes(query) ||
      seller.sellerId?.toLowerCase().includes(query)
  })

  const filteredSellersForRecommended = useMemo(() => {
    const query = recommendedSearchQuery.trim().toLowerCase()
    return allSellers
      .filter((seller) => {
        if (!query) return true
        return seller.name?.toLowerCase().includes(query) ||
          seller.sellerId?.toLowerCase().includes(query)
      })
      .slice(0, 80)
  }, [allSellers, recommendedSearchQuery])

  const recommendedSellersSelected = useMemo(() => {
    const selectedIds = new Set(settings.recommendedSellerIds || [])
    return allSellers.filter((seller) => selectedIds.has(seller._id))
  }, [allSellers, settings.recommendedSellerIds])

  const toggleRecommendedSeller = (sellerId) => {
    setSettings((prev) => {
      const previousIds = Array.isArray(prev.recommendedSellerIds) ? prev.recommendedSellerIds : []
      const alreadySelected = previousIds.includes(sellerId)
      return {
        ...prev,
        recommendedSellerIds: alreadySelected
          ? previousIds.filter((id) => id !== sellerId)
          : [...previousIds, sellerId],
      }
    })
  }

  // ==================== EXPLORE MORE ====================
  const fetchExploreMore = async () => {
    try {
      setExploreMoreLoading(true)
      setError(null)
      const response = await api.get('/content/hero-banners/landing/explore-more', getAuthConfig())
      if (response.data.success) {
        setExploreMore(response.data.data.items || [])
      }
    } catch (err) {
      // Silently handle 401/404 errors - endpoints may not exist yet
      if (err.response?.status === 401 || err.response?.status === 404) {
        setExploreMore([]) // Set empty array if endpoint doesn't exist
        setError(null) // Clear any previous error
      } else {
        // Filter out token-related errors
        const errorMessage = err.response?.data?.message || 'Failed to load explore more items'
        setErrorSafely(errorMessage)
      }
    } finally {
      setExploreMoreLoading(false)
    }
  }

  const handleExploreMoreFileSelect = async (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    if (!exploreMoreLabel.trim() || !exploreMoreLink.trim()) {
      setError('Please enter both label and link')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size exceeds 5MB')
      return
    }

    try {
      setExploreMoreUploading(true)
      setError(null)
      setSuccess(null)
      const formData = new FormData()
      formData.append('image', file)
      formData.append('label', exploreMoreLabel.trim())
      formData.append('link', exploreMoreLink.trim())
      const response = await api.post('/content/hero-banners/landing/explore-more', formData, getAuthConfig({
        headers: { 'Content-Type': 'multipart/form-data' },
      }))
      if (response.data.success) {
        setSuccess('Explore more item created successfully!')
        setExploreMoreLabel("")
        setExploreMoreLink("")
        if (exploreMoreFileInputRef.current) exploreMoreFileInputRef.current.value = ''
        await fetchExploreMore()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to create explore more item.')
    } finally {
      setExploreMoreUploading(false)
    }
  }

  const handleDeleteExploreMore = async (id) => {
    if (!window.confirm('Are you sure you want to delete this explore more item?')) return
    try {
      setExploreMoreDeleting(id)
      setError(null)
      setSuccess(null)
      const response = await api.delete(`/content/hero-banners/landing/explore-more/${id}`, getAuthConfig())
      if (response.data.success) {
        setSuccess('Explore more item deleted successfully!')
        await fetchExploreMore()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to delete explore more item.')
    } finally {
      setExploreMoreDeleting(null)
    }
  }

  const handleToggleExploreMoreStatus = async (id, currentStatus) => {
    try {
      setError(null)
      setSuccess(null)
      const response = await api.patch(`/content/hero-banners/landing/explore-more/${id}/status`, {}, getAuthConfig())
      if (response.data.success) {
        setSuccess(`Explore more item ${currentStatus ? 'deactivated' : 'activated'} successfully!`)
        await fetchExploreMore()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to update explore more status.')
    }
  }



  const handleIconUpdate = async (file, label, link, itemId) => {
    if (!file) return

    // Find existing item by label
    const existingItem = exploreMore.find(item => item.label?.toLowerCase() === label.toLowerCase())

    // Create FormData
    const formData = new FormData()
    formData.append('image', file)

    try {
      setExploreIconsUploading(prev => ({ ...prev, [itemId]: true }))
      let res;

      if (existingItem) {
        // Update existing
        res = await api.patch(`/content/hero-banners/landing/explore-more/${existingItem._id}`, formData, getAuthConfig({
          headers: { 'Content-Type': 'multipart/form-data' }
        }))
      } else {
        // Create new
        formData.append('label', label)
        formData.append('link', link)
        res = await api.post('/content/hero-banners/landing/explore-more', formData, getAuthConfig({
          headers: { 'Content-Type': 'multipart/form-data' }
        }))
      }

      if (res.data?.success) {
        setSuccess(`${label} icon updated successfully!`)
        setTimeout(() => setSuccess(null), 3000)
        await fetchExploreMore()
      }
    } catch (err) {
      debugError('Upload failed', err)
      setErrorSafely(err.response?.data?.message || 'Failed to update icon')
    } finally {
      setExploreIconsUploading(prev => ({ ...prev, [itemId]: false }))
    }
  }

  const handleExploreMoreOrderChange = async (id, direction) => {
    const item = exploreMore.find(e => e._id === id)
    if (!item) return
    const newOrder = direction === 'up' ? item.order - 1 : item.order + 1
    const otherItem = exploreMore.find(e => e.order === newOrder && e._id !== id)
    if (!otherItem && newOrder < 0) return
    try {
      setError(null)
      await api.patch(`/content/hero-banners/landing/explore-more/${id}/order`, { order: newOrder }, getAuthConfig())
      if (otherItem) {
        await api.patch(`/content/hero-banners/landing/explore-more/${otherItem._id}/order`, { order: item.order }, getAuthConfig())
      }
      await fetchExploreMore()
    } catch (err) {
      setErrorSafely('Failed to update explore more order.')
    }
  }

  // ==================== SETTINGS ====================
  const fetchSettings = async () => {
    try {
      setSettingsLoading(true)
      setError(null)
      const response = await api.get('/content/hero-banners/landing/settings', getAuthConfig())
      if (response.data.success) {
        const nextSettings = response.data.data.settings || {}
        setSettings({
          exploreMoreHeading: nextSettings.exploreMoreHeading || "Explore More",
          recommendedSellerIds: Array.isArray(nextSettings.recommendedSellerIds) ? nextSettings.recommendedSellerIds : []
        })
      }
    } catch (err) {
      // Silently handle 401/404 errors - endpoints may not exist yet, use default settings
      if (err.response?.status === 401 || err.response?.status === 404) {
        setSettings({ exploreMoreHeading: "Explore More", recommendedSellerIds: [] }) // Use default settings
        setError(null) // Clear any previous error
      } else {
        // Filter out token-related errors
        const errorMessage = err.response?.data?.message || 'Failed to load settings'
        setErrorSafely(errorMessage)
      }
    } finally {
      setSettingsLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    try {
      setSettingsSaving(true)
      setError(null)
      setSuccess(null)
      const response = await api.patch('/content/hero-banners/landing/settings', {
        exploreMoreHeading: settings.exploreMoreHeading,
        recommendedSellerIds: Array.isArray(settings.recommendedSellerIds) ? settings.recommendedSellerIds : []
      }, getAuthConfig())
      if (response.data.success) {
        const savedSettings = response.data.data?.settings || {}
        setSettings((prev) => ({
          ...prev,
          exploreMoreHeading: savedSettings.exploreMoreHeading || prev.exploreMoreHeading,
          recommendedSellerIds: Array.isArray(savedSettings.recommendedSellerIds)
            ? savedSettings.recommendedSellerIds
            : prev.recommendedSellerIds
        }))
        setSuccess('Settings saved successfully!')
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to save settings.')
    } finally {
      setSettingsSaving(false)
    }
  }

  // ==================== ALL SELLERS ====================
  const fetchAllSellers = async () => {
    try {
      setSellersLoading(true)
      setError(null)
      const response = await adminAPI.getSellers({ limit: 1000 })
      const data = response?.data?.data
      if (response?.data?.success && data) {
        const raw = Array.isArray(data) ? data : (data.sellers || [])
        const sellers = raw.map((r) => ({
          ...r,
          name: r.name || r.sellerName || ''
        }))
        setAllSellers(sellers)
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403 || err.response?.status === 404) {
        setAllSellers([])
        setError(null)
      } else {
        const errorMessage = err.response?.data?.message || 'Failed to load sellers'
        setErrorSafely(errorMessage)
      }
    } finally {
      setSellersLoading(false)
    }
  }

  // ==================== RENDER ====================

  const tabs = [
    { id: 'top-banners', label: 'Top Banners', icon: ImageIcon },
    { id: 'banners', label: 'Hero Banners', icon: ImageIcon },
    { id: 'explore-more', label: 'Explore More', icon: Layout },
  ]

  const exploreMoreTabs = [
    { id: 'icons', label: 'Icons', icon: ImageIcon },
  ]

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Page Title */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Layout className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Landing Page Management</h1>
              <p className="text-sm text-slate-600 mt-1">Manage hero banners</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 mb-6">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${activeTab === tab.id
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {/* Hero Banners Tab */}
        {activeTab === 'top-banners' && (
          <>
            {/* Upload Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Upload New Top Banner(s) (800x680 pixels)</h2>
              <div
                className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50/30 cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50/50"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const files = Array.from(e.dataTransfer.files)
                  if (files.length > 0) handleTopBannerFileSelect({ files })
                }}
                onClick={() => topBannersFileInputRef.current?.click()}
              >
                <input
                  ref={topBannersFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                  multiple
                  onChange={handleTopBannerFileSelect}
                  className="hidden"
                  disabled={topBannersUploading}
                />
                {topBannersUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <p className="text-blue-600 font-medium">
                      Uploading image {topBannersUploadProgress.current} of {topBannersUploadProgress.total}...
                    </p>
                    {topBannersUploadProgress.total > 0 && (
                      <div className="w-full max-w-xs">
                        <div className="w-full bg-blue-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(topBannersUploadProgress.current / topBannersUploadProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-8 h-8 text-blue-600" />
                    <div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); topBannersFileInputRef.current?.click(); }}
                        className="text-blue-600 font-medium hover:text-blue-700 underline"
                      >
                        Click to upload
                      </button>
                      <span className="text-slate-600"> or drag and drop</span>
                    </div>
                    <p className="text-xs text-slate-500">Images (PNG, JPG, WEBP, GIF) or MP4/WebM video, up to {MAX_BANNER_MB}MB each (max 5 at once)</p>
                  </div>
                )}
              </div>
            </div>

            {/* Banners List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Top Banner List ({topBanners.length})</h2>
              {topBannersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : topBanners.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                  <p>No banners uploaded yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {topBanners.map((banner, index) => (
                    <div key={banner._id} className="border border-slate-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <div className="relative aspect-video bg-slate-100">
                        <img src={resolveMediaUrl(banner.image || banner.imageUrl) || undefined} alt={`Top Banner ${index + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute top-2 right-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${banner.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {banner.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="absolute top-2 left-2">
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">Order: {banner.order}</span>
                        </div>
                      </div>
                      <div className="p-4 bg-white">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleTopBannerOrderChange(banner._id, 'up')} disabled={index === 0} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50">
                              <ArrowUp className="w-4 h-4 text-slate-600" />
                            </button>
                            <button onClick={() => handleTopBannerOrderChange(banner._id, 'down')} disabled={index === topBanners.length - 1} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50">
                              <ArrowDown className="w-4 h-4 text-slate-600" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* <button
                              onClick={() => {
                                setSelectedBannerId(banner._id)
                                setSelectedSellerIds(banner.linkedSellers?.map(r => r._id || r) || [])
                                setShowSellerModal(true)
                              }}
                              className="px-3 py-1.5 rounded text-sm font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 flex items-center gap-1"
                            >
                              <Megaphone className="w-4 h-4" />
                              Advertise
                            </button> */}
                            <button onClick={() => handleToggleTopBannerStatus(banner._id, banner.isActive)} className={`px-3 py-1.5 rounded text-sm font-medium ${banner.isActive ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                              {banner.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => handleDeleteTopBanner(banner._id)} disabled={topBannersDeleting === banner._id} className="p-1.5 rounded hover:bg-red-100 text-red-600 disabled:opacity-50">
                              {topBannersDeleting === banner._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        {banner.linkedSellers && banner.linkedSellers.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200">
                            <p className="text-xs text-slate-600 mb-1">Linked Sellers ({banner.linkedSellers.length}):</p>
                            <div className="flex flex-wrap gap-1">
                              {banner.linkedSellers.slice(0, 3).map((seller) => (
                                <span key={seller._id || seller} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                                  {seller.name || 'Seller'}
                                </span>
                              ))}
                              {banner.linkedSellers.length > 3 && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                                  +{banner.linkedSellers.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Hero Banners Tab */}
        
        {activeTab === 'banners' && (
          <>
            {/* Upload Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Upload New Banner(s)</h2>
              <div
                className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50/30 cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50/50"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const files = Array.from(e.dataTransfer.files)
                  if (files.length > 0) handleBannerFileSelect({ files })
                }}
                onClick={() => bannersFileInputRef.current?.click()}
              >
                <input
                  ref={bannersFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                  multiple
                  onChange={handleBannerFileSelect}
                  className="hidden"
                  disabled={bannersUploading}
                />
                {bannersUploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <p className="text-blue-600 font-medium">
                      Uploading image {bannersUploadProgress.current} of {bannersUploadProgress.total}...
                    </p>
                    {bannersUploadProgress.total > 0 && (
                      <div className="w-full max-w-xs">
                        <div className="w-full bg-blue-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(bannersUploadProgress.current / bannersUploadProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-8 h-8 text-blue-600" />
                    <div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); bannersFileInputRef.current?.click(); }}
                        className="text-blue-600 font-medium hover:text-blue-700 underline"
                      >
                        Click to upload
                      </button>
                      <span className="text-slate-600"> or drag and drop</span>
                    </div>
                    <p className="text-xs text-slate-500">Images (PNG, JPG, WEBP, GIF) or MP4/WebM video, up to {MAX_BANNER_MB}MB each (max 5 at once)</p>
                  </div>
                )}
              </div>
            </div>

            {/* Banners List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Banner List ({banners.length})</h2>
              {bannersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : banners.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 text-slate-400" />
                  <p>No banners uploaded yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {banners.map((banner, index) => (
                    <div key={banner._id} className="border border-slate-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <div className="relative aspect-video bg-slate-100">
                        <img src={resolveMediaUrl(banner.imageUrl) || undefined} alt={`Hero Banner ${index + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute top-2 right-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${banner.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {banner.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="absolute top-2 left-2">
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">Order: {banner.order}</span>
                        </div>
                      </div>
                      <div className="p-4 bg-white">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleBannerOrderChange(banner._id, 'up')} disabled={index === 0} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50">
                              <ArrowUp className="w-4 h-4 text-slate-600" />
                            </button>
                            <button onClick={() => handleBannerOrderChange(banner._id, 'down')} disabled={index === banners.length - 1} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50">
                              <ArrowDown className="w-4 h-4 text-slate-600" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* <button
                              onClick={() => {
                                setSelectedBannerId(banner._id)
                                setSelectedSellerIds(banner.linkedSellers?.map(r => r._id || r) || [])
                                setShowSellerModal(true)
                              }}
                              className="px-3 py-1.5 rounded text-sm font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 flex items-center gap-1"
                            >
                              <Megaphone className="w-4 h-4" />
                              Advertise
                            </button> */}
                            <button onClick={() => handleToggleBannerStatus(banner._id, banner.isActive)} className={`px-3 py-1.5 rounded text-sm font-medium ${banner.isActive ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                              {banner.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => handleDeleteBanner(banner._id)} disabled={bannersDeleting === banner._id} className="p-1.5 rounded hover:bg-red-100 text-red-600 disabled:opacity-50">
                              {bannersDeleting === banner._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        {banner.linkedSellers && banner.linkedSellers.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-200">
                            <p className="text-xs text-slate-600 mb-1">Linked Sellers ({banner.linkedSellers.length}):</p>
                            <div className="flex flex-wrap gap-1">
                              {banner.linkedSellers.slice(0, 3).map((seller) => (
                                <span key={seller._id || seller} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                                  {seller.name || 'Seller'}
                                </span>
                              ))}
                              {banner.linkedSellers.length > 3 && (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                                  +{banner.linkedSellers.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Explore More Tab */}
        {activeTab === 'explore-more' && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold text-slate-900">Landing Settings</h2>
                <Button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving || settingsLoading}
                  className="bg-blue-500 hover:bg-blue-600 text-white"
                >
                  {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save Settings
                </Button>
              </div>

              {settingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="explore-more-heading">Explore More Heading</Label>
                    <Input
                      id="explore-more-heading"
                      value={settings.exploreMoreHeading || ""}
                      onChange={(e) => setSettings((prev) => ({ ...prev, exploreMoreHeading: e.target.value }))}
                      className="mt-2"
                      placeholder="Explore More"
                    />
                  </div>

                  <div>
                    <Label htmlFor="recommended-search">Recommended For You Sellers</Label>
                    <p className="text-xs text-slate-500 mt-1 mb-2">
                      Choose multiple sellers to display below filters on the user home page.
                    </p>

                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        id="recommended-search"
                        value={recommendedSearchQuery}
                        onChange={(e) => setRecommendedSearchQuery(e.target.value)}
                        placeholder="Search sellers..."
                        className="pl-9"
                      />
                    </div>

                    {recommendedSellersSelected.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {recommendedSellersSelected.map((seller) => (
                          <button
                            key={seller._id}
                            type="button"
                            onClick={() => toggleRecommendedSeller(seller._id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs hover:bg-blue-100"
                          >
                            <span>{seller.name}</span>
                            <span className="text-blue-500">x</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {filteredSellersForRecommended.length === 0 ? (
                        <div className="p-4 text-sm text-slate-500 text-center">No sellers found</div>
                      ) : (
                        filteredSellersForRecommended.map((seller) => {
                          const isChecked = (settings.recommendedSellerIds || []).includes(seller._id)
                          return (
                            <label
                              key={seller._id}
                              className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{seller.name}</p>
                                 <p className="text-xs text-slate-500 truncate">{seller._id || "No ID"}</p>
                              </div>
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleRecommendedSeller(seller._id)}
                              />
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sub-tabs for Explore More */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 mb-6">
              <div className="flex gap-2 overflow-x-auto">
                {exploreMoreTabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setExploreMoreSubTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${exploreMoreSubTab === tab.id
                        ? 'bg-blue-500 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  )
                })}
              </div>
            </div>



            {/* Icons Tab Content */}
            {exploreMoreSubTab === 'icons' && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-6">Manage Explore More Icons</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { id: 'offers', label: 'Offers', link: '/user/offers' },
                    { id: 'collection', label: 'Collections', link: '/user/profile/favorites' }
                  ].map((item) => {
                    // Find matching item from DB
                    const dbItem = exploreMore.find(i => i.label?.toLowerCase() === item.label.toLowerCase())

                    return (
                      <div key={item.id} className="border border-slate-200 rounded-lg p-4 flex flex-col items-center relative">
                        <span className="text-sm font-semibold text-slate-700 mb-3">{item.label}</span>

                        <div className="w-24 h-24 mb-4 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden relative group">
                          {dbItem?.imageUrl ? (
                            <img
                              src={resolveMediaUrl(dbItem.imageUrl) || undefined}
                              alt={item.label}
                              className="w-full h-full object-contain p-2"
                            />
                          ) : (
                            <ImageIcon className="w-8 h-8 text-slate-300" />
                          )}

                          {exploreIconsUploading[item.id] && (
                            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                              <Loader2 className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                        </div>

                        <div className="w-full mt-auto">
                          <input
                            type="file"
                            id={`file-${item.id}`}
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => {
                              if (e.target.files?.[0]) {
                                handleIconUpdate(e.target.files[0], item.label, item.link, item.id)
                              }
                            }}
                            disabled={exploreIconsUploading[item.id]}
                          />
                          <label
                            htmlFor={`file-${item.id}`}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer ${exploreIconsUploading[item.id] ? 'opacity-50 pointer-events-none' : ''}`}
                          >
                            <Upload className="w-3 h-3" />
                            {dbItem ? 'Change Icon' : 'Upload Icon'}
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Seller Selection Modal */}
        <Dialog open={showSellerModal} onOpenChange={setShowSellerModal}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
            <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
              <DialogTitle className="text-2xl font-bold text-slate-900">Select Sellers to Link with Banner</DialogTitle>
              <DialogDescription className="text-slate-600 mt-2">
                Select sellers that will be linked to this banner. When users click on this banner, they will be redirected to the selected sellers.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Search Bar and Selected Count */}
              <div className="px-6 pt-4 pb-3 space-y-3 bg-slate-50 border-b border-slate-200">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search sellers by name or ID..."
                    value={sellerSearchQuery}
                    onChange={(e) => setSellerSearchQuery(e.target.value)}
                    className="pl-10 h-11 bg-white border-slate-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                {selectedSellerIds.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                      {selectedSellerIds.length} seller{selectedSellerIds.length > 1 ? 's' : ''} selected
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedSellerIds([])}
                      className="text-xs text-slate-600 hover:text-slate-900"
                    >
                      Clear selection
                    </Button>
                  </div>
                )}
              </div>

              {/* Seller List */}
              <div className="flex-1 overflow-y-auto bg-white">
                {sellersLoading ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
                    <p className="text-slate-500">Loading sellers...</p>
                  </div>
                ) : filteredSellersForModal.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <ImageIcon className="w-16 h-16 text-slate-300 mb-4" />
                    <p className="text-slate-600 font-medium mb-1">No sellers found</p>
                    <p className="text-sm text-slate-500">
                      {sellerSearchQuery ? 'Try a different search term' : 'No sellers available'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredSellersForModal.map((seller) => {
                      const isSelected = selectedSellerIds.includes(seller._id)
                      const profileImageUrl = seller.profileImage?.url || seller.profileImage || null

                      return (
                        <div
                          key={seller._id}
                          className={`px-6 py-4 transition-all cursor-pointer ${isSelected
                            ? 'bg-blue-50 border-l-4 border-l-blue-500'
                            : 'hover:bg-slate-50'
                            }`}
                          onClick={() => toggleSellerSelection(seller._id)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex-shrink-0">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSellerSelection(seller._id)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-5 h-5"
                              />
                            </div>

                            {/* Seller Image */}
                            <div className="flex-shrink-0">
                              {profileImageUrl ? (
                                <img
                                  src={profileImageUrl}
                                  alt={seller.name}
                                  className="w-16 h-16 rounded-xl object-cover border-2 border-slate-200"
                                  onError={(e) => {
                                    e.target.style.display = 'none'
                                    e.target.nextSibling.style.display = 'flex'
                                  }}
                                />
                              ) : null}
                              <div
                                className={`w-16 h-16 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-lg ${profileImageUrl ? 'hidden' : 'flex'
                                  }`}
                              >
                                {seller.name?.charAt(0)?.toUpperCase() || 'R'}
                              </div>
                            </div>

                            {/* Seller Info */}
                            <div className="flex-1 min-w-0">
                              <h3 className={`font-semibold text-base mb-1 ${isSelected ? 'text-blue-900' : 'text-slate-900'
                                }`}>
                                {seller.name || 'Unnamed Seller'}
                              </h3>
                              <p className="text-sm text-slate-500 truncate">
                                ID: {seller.sellerId || seller._id}
                              </p>
                              {seller.rating && (
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-xs text-slate-400">?</span>
                                  <span className="text-xs text-slate-600">{seller.rating}</span>
                                </div>
                              )}
                            </div>

                            {/* Selected Indicator */}
                            {isSelected && (
                              <div className="flex-shrink-0">
                                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                                  <CheckCircle2 className="w-5 h-5 text-white" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
                <div className="text-sm text-slate-600">
                  {filteredSellersForModal.length} seller{filteredSellersForModal.length !== 1 ? 's' : ''} available
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowSellerModal(false)
                      setSelectedBannerId(null)
                      setSelectedSellerIds([])
                      setSellerSearchQuery("")
                    }}
                    className="px-6"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleLinkSellers}
                    disabled={linkingSellers || selectedSellerIds.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 min-w-[140px]"
                  >
                    {linkingSellers ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Linking...
                      </>
                    ) : (
                      <>
                        <Megaphone className="w-4 h-4 mr-2" />
                        Link {selectedSellerIds.length > 0 ? `(${selectedSellerIds.length})` : ''} Seller{selectedSellerIds.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div >
    </div >
  )
}
