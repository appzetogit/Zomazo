import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, ChevronRight, Heart, Search, Share2, ShoppingCart, Star, Store, Truck, Zap } from "lucide-react"
import { toast } from "sonner"
import { useProfile } from "@store/context/ProfileContext"
import { useCart } from "@store/context/CartContext"
import RecommendationRail from "@store/components/user/RecommendationRail"
import ProductReviews from "@store/components/user/reviews/ProductReviews"
import { formatDeliveryWindow, useQuickEta, useShopDeliveryEstimate } from "../desktop/useDeliveryEstimates"
import { ImagePlaceholder, isRealImage } from "../desktop/ui"

/**
 * The product page from the mobile mockup (screen 4). ProductDetail owns the
 * data, the variant choice and the add; this only lays it out for a phone:
 * a swipeable gallery under floating buttons, the price and delivery, size and
 * colour, details, then a pinned Add to Cart.
 */

const round = "flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-md active:scale-95"

export default function MobileProductView({
  product,
  seller,
  storePath,
  isQuick,
  altChannel,
  altPath,
  avail,
  isAvailable,
  notInThisStore,
  currentVariant,
  selectedAttrs,
  onSelectAttribute,
  isValueEnabled,
  allImages = [],
  displayPrice,
  displayMrp,
  discountPercent,
  onAddToCart,
}) {
  const navigate = useNavigate()
  const { addDishFavorite, removeDishFavorite, isDishFavorite } = useProfile()
  const { getCartCount } = useCart()
  const eta = useQuickEta()
  const estimate = useShopDeliveryEstimate({ enabled: !isQuick })
  const gallery = useRef(null)
  const [index, setIndex] = useState(0)
  const [justAdded, setJustAdded] = useState(false)

  const id = String(product?._id || "")
  const sellerId = String(seller?._id || product?.sellerId || "")
  const sellerName = seller?.sellerName || seller?.name || ""
  const liked = isDishFavorite(id, sellerId)
  const rating = Number(product?.rating) > 0 ? Number(product.rating) : null
  const ratingCount = Number(product?.totalRatings) || 0
  const bullets = String(product?.description || "")
    .split(/\r?\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .slice(0, 8)
  const images = allImages.filter(isRealImage)
  const cartCount = getCartCount()

  // A colour's swatch is a photo of that colour when a variant has one.
  const colourImage = (value) => {
    const v = (product?.variants || []).find((x) =>
      (x.attributes || []).some((a) => /^colou?r$/i.test(a.name) && String(a.value) === String(value)),
    )
    const img = v?.images?.[0]
    return typeof img === "string" ? img : img?.url || ""
  }

  const toggleLike = () => {
    if (liked) {
      removeDishFavorite(id, sellerId)
      toast("Removed from wishlist")
    } else {
      addDishFavorite({ id, sellerId, name: product?.name, image: images[0], price: displayPrice, mrp: displayMrp, sellerName, mode: isQuick ? "quick" : "shop" })
      toast.success("Saved to wishlist")
    }
  }

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) await navigator.share({ title: product?.name, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success("Link copied")
      }
    } catch {
      /* the share sheet was dismissed */
    }
  }

  const add = () => {
    if (onAddToCart()) {
      setJustAdded(true)
    }
  }

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden">
      {/* Gallery with floating actions */}
      <div className="relative">
        <div
          ref={gallery}
          onScroll={(e) => {
            const el = e.currentTarget
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
          }}
          className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto bg-[#F5F5F5] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.length ? (
            images.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={i === 0 ? product?.name : ""}
                loading={i === 0 ? "eager" : "lazy"}
                className="h-full w-full shrink-0 snap-center object-cover"
              />
            ))
          ) : (
            <ImagePlaceholder name={product?.name} />
          )}
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Back" className={round}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex gap-2">
            <Link to={storePath("/search")} aria-label="Search" className={round}>
              <Search className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button type="button" onClick={toggleLike} aria-label={liked ? "Remove from wishlist" : "Save to wishlist"} aria-pressed={liked} className={round}>
              <Heart className={`h-4 w-4 ${liked ? "fill-[#E4322B] text-[#E4322B]" : ""}`} aria-hidden="true" />
            </button>
            <button type="button" onClick={share} aria-label="Share" className={round}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {images.length > 1 ? (
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
            {images.map((src, i) => (
              <span key={src} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-4 px-4 pt-4">
        <div>
          <h1 className="text-[19px] font-bold leading-snug text-gray-900">{product?.name}</h1>
          {sellerName ? (
            <Link to={storePath(`/sellers/${seller?.slug || sellerId}`)} className="mt-0.5 inline-flex items-center gap-0.5 text-[13px] font-medium text-[#EA580C]">
              By {sellerName} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : null}
          {rating ? (
            <a href="#pd-reviews" className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-600">
              <span className="flex items-center gap-0.5 rounded bg-[#1E9E48] px-1.5 py-0.5 text-[11px] font-bold text-white">
                {rating.toFixed(1)} <Star className="h-3 w-3 fill-white" aria-hidden="true" />
              </span>
              {ratingCount ? `${ratingCount.toLocaleString("en-IN")} review${ratingCount === 1 ? "" : "s"}` : null}
            </a>
          ) : null}
        </div>

        <div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[26px] font-bold text-gray-900">₹{Number(displayPrice || 0).toLocaleString("en-IN")}</span>
            {displayMrp > displayPrice ? (
              <span className="text-[14px] text-gray-400 line-through">₹{Number(displayMrp).toLocaleString("en-IN")}</span>
            ) : null}
            {discountPercent > 0 ? <span className="text-[14px] font-bold text-[#1E9E48]">{discountPercent}% OFF</span> : null}
          </p>
          <p className="text-[12px] text-gray-500">Inclusive of all taxes</p>
        </div>

        {/* Delivery */}
        <div className="flex items-center gap-3 rounded-xl border border-[#BFE6CB] bg-[#EFFAF2] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#1E9E48]">
            {isQuick ? <Zap className="h-4 w-4" aria-hidden="true" /> : <Truck className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span className="min-w-0 text-[13px]">
            <span className="block font-bold text-[#157A38]">
              {isQuick ? `Delivery in ${eta} minutes` : formatDeliveryWindow(estimate)}
            </span>
            {sellerName ? (
              <span className="flex items-center gap-1 text-[12px] text-gray-600">
                <Store className="h-3 w-3" aria-hidden="true" /> From {sellerName}
                {seller?.location?.area ? ` · ${seller.location.area}` : ""}
              </span>
            ) : null}
          </span>
        </div>

        {notInThisStore ? (
          <div className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
            Not sold in {isQuick ? "Quick" : "Shop"}.{" "}
            {altPath ? (
              <Link to={altPath} className="font-bold underline">
                See it in {altChannel === "quick" ? "Quick" : "Shop"}
              </Link>
            ) : null}
          </div>
        ) : avail?.low && avail?.qty != null ? (
          <p className="text-[13px] font-semibold text-[#CC0C39]">Only {avail.qty} left in stock</p>
        ) : null}

        {/* Options */}
        {(product?.options || []).map((opt) => {
          const isColour = /^colou?r$/i.test(opt.name)
          return (
            <fieldset key={opt.name}>
              <legend className="mb-2 flex w-full items-center justify-between text-[15px] font-bold text-gray-900">
                Select {opt.name}
                {selectedAttrs?.[opt.name] ? <span className="text-[13px] font-medium text-gray-500">{selectedAttrs[opt.name]}</span> : null}
              </legend>
              <div className="flex flex-wrap gap-2">
                {(opt.values || []).map((raw) => {
                  const value = typeof raw === "object" ? raw.value : raw
                  const hex = typeof raw === "object" ? raw.hex : null
                  const selected = selectedAttrs?.[opt.name] === value
                  const enabled = isValueEnabled(opt.name, value)
                  if (isColour) {
                    const photo = colourImage(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!enabled}
                        aria-pressed={selected}
                        aria-label={value}
                        onClick={() => onSelectAttribute(opt.name, value)}
                        className={`h-14 w-12 overflow-hidden rounded-lg border-2 p-0.5 disabled:opacity-35 ${selected ? "border-[#EA580C]" : "border-gray-200"}`}
                      >
                        {photo ? (
                          <img src={photo} alt="" className="h-full w-full rounded-md object-cover" />
                        ) : (
                          <span className="block h-full w-full rounded-md" style={{ background: hex || "#ccc" }} />
                        )}
                      </button>
                    )
                  }
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={!enabled}
                      aria-pressed={selected}
                      onClick={() => onSelectAttribute(opt.name, value)}
                      className={`min-w-[46px] rounded-lg border px-3 py-2 text-[14px] font-semibold transition-colors disabled:line-through disabled:opacity-35 ${
                        selected ? "border-[#EA580C] bg-[#FFF1E7] text-[#C2410C]" : "border-gray-200 text-gray-800"
                      }`}
                    >
                      {value}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )
        })}

        {bullets.length ? (
          <section>
            <h2 className="mb-2 text-[15px] font-bold text-gray-900">Product Details</h2>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-gray-700">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="mt-6 space-y-6">
        <RecommendationRail productId={product._id} type="similar" title="You may also like" limit={10} />
        <div id="pd-reviews" className="px-4">
          <ProductReviews productId={product._id} productName={product.name} variant="mobile" />
        </div>
      </div>

      {/* Pinned add bar */}
      <div className="fixed inset-x-0 bottom-0 z-[95] border-t border-gray-100 bg-white p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] lg:hidden">
        {justAdded ? (
          <div className="flex gap-2">
            <button type="button" onClick={add} className="h-12 flex-1 rounded-xl border-2 border-[#EA580C] text-[14px] font-bold text-[#EA580C]">
              Add one more
            </button>
            <Link
              to={storePath("/cart")}
              className="wh-pop flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#EA580C] text-[14px] font-bold text-white shadow-md"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Go to cart ({cartCount})
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={add}
            disabled={notInThisStore || !isAvailable}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#EA580C] text-[15px] font-bold text-white shadow-md active:scale-[0.99] disabled:bg-gray-300"
          >
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            {notInThisStore ? "Not sold here" : !isAvailable ? (currentVariant ? "Out of stock" : "Select options") : "Add to Cart"}
          </button>
        )}
      </div>
    </div>
  )
}
