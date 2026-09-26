import { useState, useEffect } from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Share2, Trash2, Heart, Star, Clock, MapPin } from "lucide-react"
import AnimatedPage from "@store/components/user/AnimatedPage"
import ScrollReveal from "@store/components/user/ScrollReveal"
import { Card, CardContent } from "@store/components/ui/card"
import { Button } from "@store/components/ui/button"
import { Badge } from "@store/components/ui/badge"
import { useProfile } from "@store/context/ProfileContext"
import useAppBackNavigation from "@store/hooks/useAppBackNavigation"
import { imagePlaceholder } from "@store/constants/images"

export default function CollectionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { getFavorites, removeFavorite } = useProfile()
  
  // Mock collection data - in real app, fetch from API based on id
  const [collection, setCollection] = useState({
    id: id,
    name: "My Collection",
    dishes: 0,
    sellers: 0,
    items: []
  })

  // For now, use favorites as collection items
  // In real app, fetch collection items from API
  const favorites = getFavorites()
  
  useEffect(() => {
    // In real app, fetch collection data from API
    // For now, use favorites as placeholder
    setCollection(prev => ({
      ...prev,
      name: `Collection ${id}`,
      items: favorites,
      sellers: favorites.length,
      dishes: 0
    }))
  }, [id, favorites])

  const handleRemoveItem = (e, slug) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm("Remove this seller from collection?")) {
      removeFavorite(slug)
      // Update collection state
      setCollection(prev => ({
        ...prev,
        items: prev.items.filter(item => item.slug !== slug),
        sellers: prev.sellers - 1
      }))
    }
  }

  if (collection.items.length === 0) {
    return (
      <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <ScrollReveal>
            <div className="flex items-center gap-3 sm:gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full h-8 w-8 sm:h-10 sm:w-10"
                onClick={goBack}
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold">{collection.name}</h1>
            </div>
          </ScrollReveal>
          <Card>
            <CardContent className="py-12 text-center">
              <Heart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-lg mb-4">This collection is empty</p>
              <Link to="/user">
                <Button className="bg-gradient-to-r bg-wh-brand hover:opacity-90 text-wh-text">
                  Explore Sellers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 via-white to-orange-50/20 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <ScrollReveal>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full h-8 w-8 sm:h-10 sm:w-10"
                onClick={goBack}
              >
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold">{collection.name}</h1>
                <p className="text-muted-foreground mt-1">
                  {collection.sellers} {collection.sellers === 1 ? "seller" : "sellers"}
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
          {collection.items.map((seller, index) => (
            <ScrollReveal key={seller.slug} delay={index * 0.1}>
              <Link to={`/user/sellers/${seller.slug}`}>
                <Card className="overflow-hidden h-full p-0 gap-0">
                  <div className="h-48 w-full relative overflow-hidden">
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
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full bg-white/90 backdrop-blur-sm hover:bg-white text-red-500"
                        onClick={(e) => handleRemoveItem(e, seller.slug)}
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-bold line-clamp-1 flex-1">{seller.name}</h3>
                      <div className="flex items-center gap-1 bg-green-600 text-white px-2 py-1 rounded-lg ml-2">
                        <Star className="h-3 w-3 fill-white" />
                        <span className="text-sm font-bold">{seller.rating || "4.5"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                      <Clock className="h-4 w-4" />
                      <span>{seller.deliveryTime || "25-30 mins"}</span>
                      <span>�</span>
                      <MapPin className="h-4 w-4" />
                      <span>{seller.distance || "2.5 km"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </AnimatedPage>
  )
}

