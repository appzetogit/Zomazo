/**
 * Desktop (lg+) product page layout per DESKTOP_THEME.md: breadcrumb, then
 * gallery | details | buy box, then rails, specifications and ratings.
 * Presentation only: all state and handlers come from ProductDetail.
 */
import { Link } from "react-router-dom"
import { ChevronRight, Coins, MapPin, RotateCcw, Star, Store, Tag } from "lucide-react"
import RecommendationRail from "@store/components/user/RecommendationRail"
import { useDeliveryLocation } from "@store/context/DeliveryLocationContext"
import { CHANNEL_COPY, productInChannel } from "@store/utils/channelStock"
import { ImagePlaceholder, isRealImage, CtaButton, DealBadge, DeliveryPromise, PriceTag } from "./ui"
import ProductReviews from "@store/components/user/reviews/ProductReviews"
import { formatDeliveryWindow, locationPincode, useQuickEta, useShopDeliveryEstimate } from "./useDeliveryEstimates"

const QTY_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

function Stars({ rating }) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0))
  return (
    <span className="inline-flex items-center gap-1 text-[14px]" aria-label={`Rated ${r.toFixed(1)} out of 5`}>
      <span className="text-wh-link">{r.toFixed(1)}</span>
      <span className="inline-flex" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={`h-4 w-4 ${i < Math.round(r) ? "fill-wh-brand text-wh-brand" : "text-wh-border"}`} />
        ))}
      </span>
    </span>
  )
}

export default function ProductDetailDesktop({
  product,
  seller,
  storePath,
  isQuick,
  channel,
  altChannel,
  altPath,
  avail,
  altAvail,
  isAvailable,
  notInThisStore,
  currentVariant,
  selectedAttrs,
  onSelectAttribute,
  isValueEnabled,
  allImages,
  activeImageIndex,
  setActiveImageIndex,
  quantity,
  setQuantity,
  displayPrice,
  displayMrp,
  discountPercent,
  onAddToCart,
  onBuyNow,
}) {
  const { displayAddressText, effectiveLocation } = useDeliveryLocation()
  const quickEta = useQuickEta()
  const shopEstimate = useShopDeliveryEstimate()
  const deliverTo = [effectiveLocation?.area || effectiveLocation?.city, locationPincode(effectiveLocation)]
    .filter(Boolean)
    .join(" ") || displayAddressText
  const storeLabel = CHANNEL_COPY[channel].label
  const rating = Number(product.rating) || 0
  const bullets = String(product.description || "")
    .split(/\r?\n|(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8)

  const specs = [
    ["Brand", product.brand],
    ["Pack size", product.packSize],
    ["Category", product.categoryName || product.category?.name],
    ...Object.entries(selectedAttrs || {}),
    ["SKU", currentVariant?.sku || product.sku],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")

  const disabled = !isAvailable || notInThisStore
  const stockLine = notInThisStore ? (
    <p className="text-[14px] font-medium text-wh-deal">
      {currentVariant && productInChannel(product, channel)
        ? `This option isn't sold in ${storeLabel}.`
        : `Not sold in ${storeLabel}.`}
    </p>
  ) : !isAvailable ? (
    <p className="text-[18px] text-wh-deal">Currently out of stock</p>
  ) : avail.low ? (
    <p className="text-[14px] font-medium text-wh-deal">Only {avail.qty} left in stock</p>
  ) : (
    <p className="text-[18px] text-wh-success">In stock</p>
  )

  const breadcrumb = [
    { label: isQuick ? "Quick" : "Home", to: storePath("/") },
    product.categoryName && { label: product.categoryName },
    { label: product.name },
  ].filter(Boolean)

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-wh-surface pb-10 text-[14px] leading-5 text-wh-text">
      <div className="mx-auto max-w-[1500px] px-3 sm:px-5">
        <nav aria-label="Breadcrumb" className="py-3 text-[12px] text-wh-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumb.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-wh-link-hover hover:underline">{b.label}</Link>
                ) : (
                  <span className={i === breadcrumb.length - 1 ? "line-clamp-1 max-w-[220px] sm:max-w-[480px]" : ""}>{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_260px] lg:gap-6 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)_300px]">
          {/* 1. Gallery */}
          <div className="flex w-full min-w-0 max-w-full flex-col-reverse gap-3 self-start sm:flex-row lg:sticky lg:top-28">
            {allImages.length > 1 && (
              <div className="flex w-full min-w-0 gap-2 overflow-x-auto sm:max-h-[520px] sm:w-[52px] sm:flex-col sm:overflow-x-visible sm:overflow-y-auto">
                {allImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseEnter={() => setActiveImageIndex(idx)}
                    onClick={() => setActiveImageIndex(idx)}
                    aria-label={`Show image ${idx + 1}`}
                    aria-pressed={activeImageIndex === idx}
                    className={`h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[8px] border bg-white focus-visible:outline-2 focus-visible:outline-wh-brand ${
                      activeImageIndex === idx ? "border-wh-brand ring-1 ring-wh-brand" : "border-wh-border"
                    }`}
                  >
                    <img src={img} alt="" className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex aspect-square w-full max-w-full flex-1 items-center justify-center overflow-hidden bg-white">
              {isRealImage(allImages[activeImageIndex] || allImages[0]) ? (
                <img
                  src={allImages[activeImageIndex] || allImages[0]}
                  alt={product.name}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImagePlaceholder name={product.name} className="rounded-[8px]" />
              )}
            </div>
          </div>

          {/* 2. Details */}
          <div className="min-w-0">
            <h1 className="text-[24px] font-normal leading-8">{product.name}</h1>
            {seller && (
              <Link
                to={storePath(`/sellers/${seller._id || seller.id}`)}
                className="mt-1 inline-block text-wh-link hover:text-wh-link-hover hover:underline"
              >
                Visit the {seller.sellerName} store
              </Link>
            )}
            {rating > 0 && (
              <a href="#pd-reviews" className="mt-1 inline-flex items-center gap-2 hover:underline focus-visible:outline-2 focus-visible:outline-wh-brand">
                <Stars rating={rating} />
                {Number(product.totalRatings) > 0 && (
                  <span className="text-[14px] text-wh-link">{Number(product.totalRatings).toLocaleString("en-IN")} ratings</span>
                )}
              </a>
            )}

            <hr className="my-3 border-wh-border" />

            <div className="flex items-start gap-2">
              {discountPercent > 0 && <span className="text-[28px] font-light leading-none text-wh-deal">-{discountPercent}%</span>}
              <PriceTag price={displayPrice} size="lg" />
            </div>
            {displayMrp > displayPrice && (
              <p className="mt-1 text-[12px] text-wh-muted">M.R.P.: <s>₹{Number(displayMrp).toLocaleString("en-IN")}</s></p>
            )}
            <p className="text-[12px] text-wh-muted">Inclusive of all taxes</p>

            <div className="mt-3 flex flex-wrap gap-2">
              {discountPercent > 0 && (
                <span className="inline-flex items-center gap-1 rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12px]">
                  <Tag className="h-3.5 w-3.5 text-wh-deal" aria-hidden="true" /> Save ₹{Number(displayMrp - displayPrice).toLocaleString("en-IN")} on M.R.P.
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12px]">
                <Coins className="h-3.5 w-3.5 text-wh-brand-ink" aria-hidden="true" /> Coins usable at checkout
              </span>
              <span className="inline-flex items-center gap-1 rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12px]">
                <Tag className="h-3.5 w-3.5 text-wh-success" aria-hidden="true" /> Coupons applied in cart
              </span>
            </div>

            {Array.isArray(product.options) && product.options.length > 0 && (
              <div className="mt-4 space-y-4">
                {product.options.map((opt) => {
                  const isColor = opt.type === "color" || String(opt.name).toLowerCase() === "color"
                  const selectedVal = selectedAttrs[opt.name]
                  return (
                    <fieldset key={opt.name}>
                      <legend className="mb-2 text-[14px]">
                        {opt.name}: <span className="font-bold">{selectedVal}</span>
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {opt.values.map((v) => {
                          const valStr = typeof v === "object" ? v.value : v
                          const hex = typeof v === "object" ? v.hex : null
                          const selected = selectedVal === valStr
                          const enabled = isValueEnabled(opt.name, valStr)
                          const base = `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wh-brand ${
                            enabled ? "" : "cursor-not-allowed opacity-40"
                          }`
                          if (isColor) {
                            return (
                              <button
                                key={valStr}
                                type="button"
                                disabled={!enabled}
                                onClick={() => onSelectAttribute(opt.name, valStr)}
                                aria-pressed={selected}
                                aria-label={enabled ? valStr : `${valStr} (not available in ${storeLabel})`}
                                title={enabled ? valStr : `${valStr} (not available in ${storeLabel})`}
                                className={`h-10 w-10 rounded-[8px] border-2 p-0.5 ${base} ${selected ? "border-wh-brand" : "border-wh-border"}`}
                              >
                                <span className="block h-full w-full rounded-[5px]" style={{ backgroundColor: hex || "#000" }} />
                              </button>
                            )
                          }
                          return (
                            <button
                              key={valStr}
                              type="button"
                              disabled={!enabled}
                              onClick={() => onSelectAttribute(opt.name, valStr)}
                              aria-pressed={selected}
                              className={`min-w-[48px] rounded-[8px] border px-3 py-1.5 text-[14px] ${base} ${
                                enabled ? "" : "line-through"
                              } ${selected ? "border-wh-brand bg-[#FEF4E6]" : "border-wh-border bg-white hover:bg-[#F7FAFA]"}`}
                            >
                              {valStr}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                  )
                })}
              </div>
            )}

            {bullets.length > 0 && (
              <>
                <hr className="my-4 border-wh-border" />
                <h2 className="mb-2 text-[16px] font-bold">About this item</h2>
                <ul className="list-disc space-y-1 pl-5">
                  {bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </>
            )}
          </div>

          {/* 3. Buy box */}
          <aside aria-label="Buy" className="self-start rounded-[8px] border border-wh-border p-[18px]">
            <PriceTag price={displayPrice} size="lg" />
            <div className="mt-2">
              {isQuick ? (
                <DeliveryPromise mode="quick" />
              ) : (
                <DeliveryPromise mode="shop" />
              )}
            </div>
            {deliverTo && (
              <p className="mt-2 flex items-start gap-1 text-[12px] text-wh-link">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="line-clamp-2">Deliver to {deliverTo}</span>
              </p>
            )}

            <div className="mt-3">{stockLine}</div>
            {notInThisStore && altAvail.inStock && (
              <Link to={altPath} className="mt-1 inline-flex items-center gap-1 text-wh-link hover:text-wh-link-hover hover:underline">
                Available in {CHANNEL_COPY[altChannel].label} — {altChannel === "quick" ? `${quickEta} min` : formatDeliveryWindow(shopEstimate).replace(/^Delivery/, "delivery")} <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}

            {!disabled && (
              <label className="mt-3 inline-flex items-center gap-2 rounded-[8px] border border-wh-border bg-[#F0F2F2] px-2 py-1 text-[13px] shadow-sm">
                Quantity:
                <select
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="bg-transparent focus-visible:outline-2 focus-visible:outline-wh-brand"
                >
                  {QTY_OPTIONS.concat(quantity > 10 ? [quantity] : []).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}

            <div className="mt-3 space-y-2">
              <CtaButton onClick={onAddToCart} disabled={disabled}>Add to cart</CtaButton>
              <CtaButton variant="secondary" onClick={onBuyNow} disabled={disabled}>Buy now</CtaButton>
            </div>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-wh-muted">Ships via</dt>
              <dd>{isQuick ? "Quick rider" : "Courier"}</dd>
              {seller && (
                <>
                  <dt className="text-wh-muted">Sold by</dt>
                  <dd>
                    <Link to={storePath(`/sellers/${seller._id || seller.id}`)} className="inline-flex items-center gap-1 text-wh-link hover:text-wh-link-hover hover:underline">
                      <Store className="h-3 w-3" aria-hidden="true" /> {seller.sellerName}
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-wh-muted">Returns</dt>
              <dd className="inline-flex items-center gap-1">
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <Link to="/user/orders" className="text-wh-link hover:text-wh-link-hover hover:underline">Per our returns policy</Link>
              </dd>
            </dl>
          </aside>
        </div>

        <hr className="mt-8 border-wh-border" />
        <RecommendationRail variant="desktop" productId={product._id} type="frequently_bought" title="Frequently bought together" limit={8} />
        <RecommendationRail variant="desktop" productId={product._id} type="similar" title="You may also like" limit={12} />

        {specs.length > 0 && (
          <section className="border-t border-wh-border py-6" aria-labelledby="pd-specs">
            <h2 id="pd-specs" className="mb-3 text-[21px] font-bold">Product details</h2>
            <div className="w-full overflow-x-auto">
              <table className="w-full max-w-[640px] border-collapse text-[14px]">
                <tbody>
                  {specs.map(([k, v]) => (
                    <tr key={k} className="border-b border-wh-border">
                      <th scope="row" className="w-1/3 bg-[#F3F3F3] px-3 py-2 text-left font-bold">{k}</th>
                      <td className="px-3 py-2">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div id="pd-reviews">
          <ProductReviews productId={product._id} productName={product.name} variant="desktop" />
        </div>
      </div>
    </div>
  )
}
