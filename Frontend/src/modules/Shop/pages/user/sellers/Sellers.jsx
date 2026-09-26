import { useEffect, useMemo, useState } from "react"
import { useStoreMode } from "@store/context/StoreModeContext"
import { Link } from "react-router-dom"
import { ArrowLeft, Clock, MapPin, Heart, Star } from "lucide-react"
import AnimatedPage from "@store/components/user/AnimatedPage"
import Footer from "@store/components/user/Footer"
import ScrollReveal from "@store/components/user/ScrollReveal"
import TextReveal from "@store/components/user/TextReveal"
import { Card, CardTitle, CardContent } from "@store/components/ui/card"
import { Button } from "@store/components/ui/button"
import { SellerGridSkeleton } from "@store/components/ui/loading-skeletons"
import { useProfile } from "@store/context/ProfileContext"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { sellerAPI } from "@store/api"
import { API_BASE_URL } from "@store/api/config"
import { useDelayedLoading } from "@store/hooks/useDelayedLoading"
import { useStorefrontLayout } from "@store/components/user/desktop/useIsDesktop"
import { StoresDesktop } from "@store/components/user/desktop/IndexDesktop"
import { imagePlaceholder } from "@store/constants/images"

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "")

const normalizeImageUrl = (imageUrl) => {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return ""
  const trimmed = imageUrl.trim()
  if (/^(https?:)?\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed
  }
  return trimmed.startsWith("/")
    ? `${BACKEND_ORIGIN}${trimmed}`
    : `${BACKEND_ORIGIN}/${trimmed}`
}

const pickSellerImage = (seller) => {
  const candidates = [
    seller?.coverImage?.url,
    seller?.coverImage,
    ...(Array.isArray(seller?.coverImages) ? seller.coverImages.map((img) => img?.url || img) : []),
    ...(Array.isArray(seller?.menuImages) ? seller.menuImages.map((img) => img?.url || img) : []),
    seller?.profileImage?.url,
    seller?.profileImage,
  ]
  const firstValid = candidates.find((value) => typeof value === "string" && value.trim())
  return normalizeImageUrl(firstValid || "")
}

export default function Sellers() {
  const { storePath, fulfilmentMode } = useStoreMode()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const { effectiveLocation: userLocation, zoneId } = useDeliveryLocation()
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const showSellersSkeleton = useDelayedLoading(loading)
  const isDesktop = useStorefrontLayout()

  useEffect(() => {
    let cancelled = false

    const fetchSellers = async () => {
      try {
        setLoading(true)
        const params = { limit: 300, fulfilmentMode, _ts: Date.now() }
        if (zoneId) {
          params.zoneId = zoneId
        }
        const response = await sellerAPI.getSellers(params, { noCache: true })
        const list =
          response?.data?.data?.sellers ||
          response?.data?.sellers ||
          []
        if (cancelled) return

        const transformed = list.map((seller) => {
          const slug =
            seller?.slug ||
            String(seller?.name || "")
              .toLowerCase()
              .trim()
              .replace(/\s+/g, "-")
          return {
            id: seller?._id || seller?.sellerId || slug,
            slug,
            name: seller?.name || "Unknown Seller",
            rating: Number(seller?.rating || 0) || 4.5,
            deliveryTime: seller?.estimatedDeliveryTime || (seller?.estimatedDeliveryTimeMinutes ? `${seller.estimatedDeliveryTimeMinutes} mins` : "25-30 mins"),
            distance: seller?.distance ? (typeof seller.distance === 'number' ? `${seller.distance.toFixed(1)} km` : seller.distance) : "1.2 km",
            priceRange: seller?.priceRange || "$$",
            image: pickSellerImage(seller),
          }
        })

        setSellers(transformed)
      } catch (error) {
        if (!cancelled) {
          setSellers([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchSellers()
    return () => {
      cancelled = true
    }
  }, [zoneId, fulfilmentMode])

  const hasSellers = useMemo(() => sellers.length > 0, [sellers.length])

  // Desktop (lg+): a grid of store cards; mobile below is unchanged.
  if (isDesktop) return <StoresDesktop stores={sellers} loading={loading} />

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 dark:from-[#0a0a0a] via-white dark:via-[#0a0a0a] to-orange-50/20 dark:to-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 space-y-4 sm:space-y-6 lg:space-y-8">
        <ScrollReveal>
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-5 mb-4 lg:mb-6">
            <Link to="/">
              <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 hover:bg-gray-100 dark:hover:bg-gray-800">
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-gray-900 dark:text-gray-100" />
              </Button>
            </Link>
            <TextReveal className="flex items-center gap-2 sm:gap-3 lg:gap-4">
              <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white">
                All Sellers
              </h1>
            </TextReveal>
          </div>
        </ScrollReveal>

        {showSellersSkeleton ? (
          <SellerGridSkeleton count={4} />
        ) : !hasSellers ? (
          <div className="py-16 text-center text-sm text-gray-500">No sellers available right now.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 xl:gap-6 pt-2 sm:pt-3 lg:pt-4">
            {sellers.map((seller, index) => {
              const favorite = isFavorite(seller.slug)

              const handleToggleFavorite = (e) => {
                e.preventDefault()
                e.stopPropagation()
                if (favorite) {
                  removeFavorite(seller.slug)
                } else {
                  addFavorite({
                    slug: seller.slug,
                    name: seller.name,
                    rating: seller.rating,
                    deliveryTime: seller.deliveryTime,
                    distance: seller.distance,
                    priceRange: seller.priceRange,
                    image: seller.image,
                  })
                }
              }

              return (
                <ScrollReveal key={seller.id} delay={index * 0.05}>
                  <Link to={storePath(`/sellers/${seller.slug}`)} className="h-full flex">
                    <Card className="overflow-hidden cursor-pointer border border-gray-200 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] hover:shadow-lg dark:hover:shadow-xl dark:hover:shadow-gray-900/50 pb-1 sm:pb-2 lg:pb-3 flex flex-col h-full w-full transition-all duration-300">
                      <div className="flex flex-row min-h-[120px] sm:min-h-[140px] md:min-h-[160px] lg:min-h-[180px] flex-1">
                        <CardContent className="flex-1 flex flex-col justify-between p-3 sm:p-4 md:p-5 lg:p-6 min-w-0 overflow-hidden">
                          <div className="flex-1 flex flex-col justify-between gap-2">
                            <div className="flex-shrink-0">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex-1 min-w-0 pr-2">
                                  <CardTitle className="text-base sm:text-lg md:text-xl mb-1 line-clamp-2 text-gray-900 dark:text-white">
                                    {seller.name}
                                  </CardTitle>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <div className="flex items-center gap-1 bg-yellow-50 dark:bg-yellow-900/30 px-1.5 py-0.5 rounded-full">
                                      <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-yellow-400 text-yellow-400" />
                                      <span className="font-bold text-xs sm:text-sm text-yellow-700 dark:text-yellow-400">{seller.rating.toFixed(1)}</span>
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-7 w-7 sm:h-8 sm:w-8 rounded-full flex-shrink-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${favorite ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"}`}
                                  onClick={handleToggleFavorite}
                                >
                                  <Heart className={`h-4 w-4 sm:h-5 sm:w-5 ${favorite ? "fill-red-500 dark:fill-red-400" : ""}`} />
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
                              <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex-wrap">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                                  <span className="font-medium whitespace-nowrap">{seller.deliveryTime}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                                  <span className="font-medium whitespace-nowrap">{seller.distance}</span>
                                </div>
                              </div>
                              <Button className="bg-wh-brand hover:opacity-90 dark:hover:opacity-80 text-wh-text text-xs sm:text-sm h-7 sm:h-8 px-3 sm:px-4 flex-shrink-0 transition-opacity">
                                Order Now
                              </Button>
                            </div>
                          </div>
                        </CardContent>

                        <div className="w-36 sm:w-44 md:w-56 lg:w-64 xl:w-72 flex-shrink-0 relative overflow-hidden group/image">
                          <img
                            src={seller.image || imagePlaceholder}
                            alt={seller.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-l from-black/20 dark:from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </Card>
                  </Link>
                </ScrollReveal>
              )
            })}
          </div>
        )}
      </div>
      <Footer />
    </AnimatedPage>
  )
}

