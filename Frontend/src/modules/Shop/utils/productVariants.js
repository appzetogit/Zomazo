const toArray = (value) => (Array.isArray(value) ? value : [])

export const normalizeProductVariants = (value) =>
  toArray(value)
    .map((entry = {}, index) => {
      const id = String(entry?.id || entry?._id || `variant-${index}`)
      const name = String(entry?.name || "").trim()
      const price = Number(entry?.price)
      if (!name || !Number.isFinite(price) || price <= 0) return null

      return {
        id,
        _id: id,
        name,
        price,
        otherPrice: Number(entry?.otherPrice) || 0,
      }
    })
    .filter(Boolean)

export const getProductVariants = (item = {}) =>
  normalizeProductVariants(item?.variants || item?.variations || [])

export const hasProductVariants = (item = {}) => getProductVariants(item).length > 0

export const getDefaultProductVariant = (item = {}) => getProductVariants(item)[0] || null

export const getProductDisplayPrice = (item = {}) => {
  const variants = getProductVariants(item)
  if (variants.length > 0) {
    return Math.min(...variants.map((variant) => Number(variant.price) || 0))
  }

  const price = Number(item?.price)
  return Number.isFinite(price) ? price : 0
}

export const getProductDisplayOtherPrice = (item = {}) => {
  const variants = getProductVariants(item)
  if (variants.length > 0) {
    const valid = variants
      .map((variant) => Number(variant.otherPrice) || 0)
      .filter((p) => p > 0)
    return valid.length > 0 ? Math.min(...valid) : 0
  }

  const otherPrice = Number(item?.otherPrice)
  return Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0
}

export const hasProductStrikePrice = (item = {}, overridePrice = null, overrideOtherPrice = null) => {
  const price =
    overridePrice != null ? Number(overridePrice) : getProductDisplayPrice(item)
  const otherPrice =
    overrideOtherPrice != null
      ? Number(overrideOtherPrice)
      : getProductDisplayOtherPrice(item)
  return (
    Number.isFinite(otherPrice) &&
    otherPrice > 0 &&
    Number.isFinite(price) &&
    otherPrice > price
  )
}

/** Percent off vs other-platform price, e.g. 180→144 => 20. */
export const getProductDiscountPercent = (
  item = {},
  overridePrice = null,
  overrideOtherPrice = null,
) => {
  const price =
    overridePrice != null ? Number(overridePrice) : getProductDisplayPrice(item)
  const otherPrice =
    overrideOtherPrice != null
      ? Number(overrideOtherPrice)
      : getProductDisplayOtherPrice(item)
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(otherPrice) ||
    otherPrice <= 0 ||
    otherPrice <= price
  ) {
    return 0
  }
  return Math.max(1, Math.round(((otherPrice - price) / otherPrice) * 100))
}

export const getProductPriceLabel = (item = {}) => {
  const price = getProductDisplayPrice(item)
  return hasProductVariants(item) ? `Starting from ₹${Math.round(price)}` : `₹${Math.round(price)}`
}

/** Unit compare-at price when it is higher than selling price; else 0. */
export const getLineCompareUnitPrice = (item = {}) => {
  const price = Number(item?.price) || 0
  const otherPrice = Number(item?.otherPrice) || 0
  return otherPrice > price ? otherPrice : 0
}

/** Sum of compare-at line totals (falls back to selling price per line). */
export const getCartCompareItemTotal = (items = []) =>
  (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const price = Number(item?.price) || 0
    const otherPrice = Number(item?.otherPrice) || 0
    const qty = Number(item?.quantity) || 1
    const unit = otherPrice > price ? otherPrice : price
    return sum + unit * qty
  }, 0)

export const buildCartLineId = (itemId, variantId = "") =>
  `${String(itemId || "")}::${String(variantId || "base")}`
