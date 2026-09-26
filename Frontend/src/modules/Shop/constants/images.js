// Shown where a category or product has no image of its own: a neutral tile
// with a shopping-bag outline, drawn inline so nothing is fetched. (It used to
// be a rotation of food photos from the app this one was built from.)
const placeholderSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">` +
  `<rect width="400" height="300" fill="#F3F4F6"/>` +
  `<g fill="none" stroke="#9CA3AF" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">` +
  `<path d="M160 120h80l-7 90h-66z"/><path d="M180 120v-12a20 20 0 0 1 40 0v12"/></g></svg>`

export const imagePlaceholder = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(placeholderSvg)}`

// Kept as an array: callers pick `productImages[i % productImages.length]`.
export const productImages = [imagePlaceholder]
