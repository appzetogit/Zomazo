import { Link } from "react-router-dom"
import { useState } from "react"

import { Heart, Star, Clock, MapPin, ArrowRight, ArrowLeft, Bookmark } from "lucide-react"
import AnimatedPage from "@store/components/user/AnimatedPage"
import ScrollReveal from "@store/components/user/ScrollReveal"
import { Card, CardHeader, CardTitle, CardContent } from "@store/components/ui/card"
import { Button } from "@store/components/ui/button"
import { useProfile } from "@store/context/ProfileContext"
import { toast } from "sonner"
import { imagePlaceholder } from "@store/constants/images"

export default function Favorites() {
  const { getFavorites, removeFavorite, getDishFavorites, removeDishFavorite } = useProfile()
  const sellerFavorites = getFavorites()
  const dishFavorites = getDishFavorites()
  const [activeTab, setActiveTab] = useState("sellers")

  const handleRemoveFavorite = (e, slug) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm("Remove this seller from favorites?")) {
      removeFavorite(slug)
      toast.success("Seller removed from favorites")
    }
  }

  const handleRemoveDishFavorite = (e, dishId, sellerId) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm("Remove this item from favorites?")) {
      removeDishFavorite(dishId, sellerId)
      toast.success("Dish removed from favorites")
    }
  }

  const totalFavorites = sellerFavorites.length + dishFavorites.length

  if (totalFavorites === 0) {
    return (
      <><AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 dark:from-[#0a0a0a] dark:via-[#0a0a0a] dark:to-[#0a0a0a] p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <ScrollReveal>
            <div className="flex items-center gap-3 sm:gap-4">
              <Link to="/user/profile">
                <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 sm:h-10 sm:w-10">
                  <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
          </Link>
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold">My Favorites</h1>
        </div>
      </ScrollReveal>
      <Card>
          <CardContent className="py-12 text-center">
            <Heart
              className="h-16 w-16 mx-auto mb-4"
              style={{ color: "var(--module-theme-ink, #B45309)" }}
            />
            <p className="text-muted-foreground text-lg mb-4">You haven't added any favorites yet</p>
            <Link to="/user">
              <Button
                className="text-wh-text border-0"
                style={{
                  background: "linear-gradient(135deg, rgba(var(--module-theme-rgb,253,146,11),0.92), var(--module-theme-color,#FD920B))",
                  boxShadow: "0 8px 18px rgba(var(--module-theme-rgb,253,146,11),0.25)",
                }}
              >
                Explore Sellers
              </Button>
            </Link>
          </CardContent>
        </Card>
        </div>
      </AnimatedPage></>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 dark:from-[#0a0a0a] dark:via-[#0a0a0a] dark:to-[#0a0a0a] p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <ScrollReveal>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link to="/user/profile">
                <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 sm:h-10 sm:w-10">
                  <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold">My Favorites</h1>
                <p className="text-gray-700 dark:text-gray-300 mt-1 text-sm font-semibold">
                  {dishFavorites.length || 0} {dishFavorites.length === 1 ? "dish" : "dishes"} • {sellerFavorites.length || 0} {sellerFavorites.length === 1 ? "seller" : "sellers"}
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setActiveTab("sellers")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "sellers"
                ? "border-b-2 border-wh-brand text-wh-brand-ink"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Sellers ({sellerFavorites.length})
          </button>
          <button
            onClick={() => setActiveTab("dishes")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "dishes"
                ? "border-b-2 border-wh-brand text-wh-brand-ink"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            Dishes ({dishFavorites.length})
          </button>
        </div>

        {/* Sellers Tab */}
        {activeTab === "sellers" && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {sellerFavorites.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <Heart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-lg mb-4">No sellers saved yet</p>
                <Link to="/user">
                  <Button
                    className="text-wh-text border-0"
                    style={{
                      background: "linear-gradient(135deg, rgba(var(--module-theme-rgb,253,146,11),0.92), var(--module-theme-color,#FD920B))",
                      boxShadow: "0 8px 18px rgba(var(--module-theme-rgb,253,146,11),0.25)",
                    }}
                  >
                    Explore Sellers
                  </Button>
                </Link>
              </div>
            ) : (
              sellerFavorites.map((seller, index) => (
            <ScrollReveal key={seller.slug} delay={index * 0.1}>
              <Link to={`/user/sellers/${seller.slug}`}>
                <Card className="overflow-hidden h-full">
                  <div className="h-32 w-full relative overflow-hidden">
                    <img
                      src={seller.image}
                      alt={seller.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src = imagePlaceholder
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                    <div className="absolute top-2 right-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm hover:bg-white text-red-500"
                        onClick={(e) => handleRemoveFavorite(e, seller.slug)}
                      >
                        <Heart className="h-4 w-4 fill-red-500" />
                      </Button>
                    </div>
                    <div className="absolute bottom-2 left-2">
                      <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span className="font-bold text-xs">{seller.rating}</span>
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <div>
                      <CardTitle className="text-sm font-bold mb-0.5 line-clamp-1">
                        {seller.name}
                      </CardTitle>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span className="font-medium">{seller.deliveryTime}</span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span className="font-medium">{seller.distance}</span>
                      </div>
                    </div>
                    <Button className="w-full bg-gradient-to-r bg-wh-brand hover:opacity-90 text-wh-text text-xs py-1.5 h-8">
                      View Seller
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            </ScrollReveal>
              ))
            )}
          </div>
        )}

        {/* Dishes Tab */}
        {activeTab === "dishes" && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {dishFavorites.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <Bookmark className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-lg mb-4">No items saved yet</p>
                <Link to="/user">
                  <Button
                    className="text-wh-text border-0"
                    style={{
                      background: "linear-gradient(135deg, rgba(var(--module-theme-rgb,253,146,11),0.92), var(--module-theme-color,#FD920B))",
                      boxShadow: "0 8px 18px rgba(var(--module-theme-rgb,253,146,11),0.25)",
                    }}
                  >
                    Explore Dishes
                  </Button>
                </Link>
              </div>
            ) : (
              dishFavorites.map((dish, index) => {
                const sellerSlug = dish.sellerSlug || ""
                return (
                  <ScrollReveal key={`${dish.id}-${dish.sellerId}`} delay={index * 0.1}>
                    <Link to={`/sellers/${sellerSlug}?dish=${dish.id}`}>
                      <Card className="overflow-hidden h-full cursor-pointer hover:shadow-lg transition-shadow">
                        <div className="h-32 w-full relative overflow-hidden">
                          <img
                            src={dish.image || imagePlaceholder}
                            alt={dish.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.target.src = imagePlaceholder
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                          <div className="absolute top-2 right-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm hover:bg-white text-red-500"
                              onClick={(e) => handleRemoveDishFavorite(e, dish.id, dish.sellerId)}
                            >
                              <Bookmark className="h-4 w-4 fill-red-500" />
                            </Button>
                          </div>
                        </div>
                        <CardContent className="p-3 space-y-2">
                          <div>
                            <CardTitle className="text-sm font-bold mb-0.5 line-clamp-1">
                              {dish.name}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {dish.sellerName || "Seller"}
                            </p>
                          </div>
                          <div className="flex items-center justify-between text-xs pt-2 border-t">
                            <div className="flex items-center gap-1">
                              {dish.foodType === "Veg" ? (
                                <div className="w-3 h-3 border-2 border-green-600 flex items-center justify-center rounded-sm">
                                  <div className="w-1.5 h-1.5 bg-green-600 rounded-full"></div>
                                </div>
                              ) : dish.foodType === "Non-Veg" ? (
                                <div className="w-3 h-3 border-2 border-orange-600 flex items-center justify-center rounded-sm">
                                  <div className="w-1.5 h-1.5 bg-orange-600 rounded-full"></div>
                                </div>
                              ) : null}
                              {(dish.foodType === "Veg" || dish.foodType === "Non-Veg") && (
                                <span className="text-muted-foreground font-medium text-xs">{dish.foodType}</span>
                              )}
                            </div>
                            <div className="text-sm font-bold text-wh-brand-ink">
                              {"\u20B9"}{Math.round(dish.price || 0)}
                            </div>
                          </div>
                          <Button className="w-full bg-gradient-to-r bg-wh-brand hover:opacity-90 text-wh-text text-xs py-1.5 h-8">
                            View Dish
                            <ArrowRight className="h-3 w-3 ml-1" />
                          </Button>
                        </CardContent>
                      </Card>
                    </Link>
                  </ScrollReveal>
                )
              })
            )}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}
