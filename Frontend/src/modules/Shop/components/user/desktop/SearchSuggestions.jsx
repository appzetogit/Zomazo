import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search, Tag } from "lucide-react"
import { searchAPI } from "@store/api"
import { mediaUrl } from "./desktopCart"

/**
 * The dropdown under the header's search box: matching categories first, then
 * products, with the raw term on top so Enter always leads somewhere.
 *
 * Suggestions are a read of the same catalogue the results page uses
 * (/catalog/search/products), narrowed to the current store, so what is
 * offered here is what a shopper will actually find.
 */

const MIN_CHARS = 2
const DEBOUNCE_MS = 200
const MAX_PRODUCTS = 6
const MAX_CATEGORIES = 3

/** Live product/category suggestions for `term`, debounced. */
export function useSearchSuggestions({ term, categories = [], fulfilmentMode, zoneId, enabled = true }) {
  const [products, setProducts] = useState([])
  const query = String(term || "").trim()

  useEffect(() => {
    if (!enabled || query.length < MIN_CHARS) {
      setProducts([])
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchAPI
        .searchProducts({
          q: query,
          limit: MAX_PRODUCTS,
          fulfilmentMode,
          ...(zoneId ? { zoneId } : {}),
        })
        .then((res) => {
          if (cancelled) return
          const list = res?.data?.data?.products || []
          setProducts(
            list.slice(0, MAX_PRODUCTS).map((p) => ({
              id: String(p._id || p.id || ""),
              name: p.name || "",
              categoryName: p.categoryName || "",
              image: mediaUrl(p.image || (Array.isArray(p.images) ? p.images[0] : "")),
            })).filter((p) => p.id && p.name),
          )
        })
        .catch(() => {
          if (!cancelled) setProducts([])
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, fulfilmentMode, zoneId, enabled])

  const matchedCategories = useMemo(() => {
    if (query.length < MIN_CHARS) return []
    const needle = query.toLowerCase()
    return categories
      .filter((c) => String(c.name || "").toLowerCase().includes(needle))
      .slice(0, MAX_CATEGORIES)
  }, [categories, query])

  /** One flat list so the arrow keys can walk it. */
  const items = useMemo(() => {
    if (query.length < MIN_CHARS) return []
    return [
      { type: "term", key: `term:${query}`, label: query },
      ...matchedCategories.map((c) => ({ type: "category", key: `cat:${c.id}`, label: c.name, slug: c.slug })),
      ...products.map((p) => ({ type: "product", key: `prod:${p.id}`, label: p.name, id: p.id, image: p.image, categoryName: p.categoryName })),
    ]
  }, [query, matchedCategories, products])

  return items
}

export default function SearchSuggestions({ items, activeIndex, onPick, onHover, listId }) {
  if (!items.length) return null

  return (
    <ul
      id={listId}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[420px] overflow-y-auto rounded-[8px] border border-gray-200 bg-white py-1 shadow-2xl"
    >
      {items.map((item, index) => {
        const active = index === activeIndex
        return (
          <li key={item.key} role="option" aria-selected={active}>
            <button
              type="button"
              // The input keeps focus, so the click must land before blur.
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(item)
              }}
              onMouseEnter={() => onHover(index)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] ${
                active ? "bg-wh-brand-50" : "hover:bg-gray-50"
              }`}
            >
              {item.type === "product" && item.image ? (
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="h-8 w-8 shrink-0 rounded object-contain bg-gray-50"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-400">
                  {item.type === "category" ? <Tag className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-gray-900">{item.label}</span>
              {item.type === "category" && (
                <span className="shrink-0 text-[12px] text-gray-500">in Categories</span>
              )}
              {item.type === "product" && item.categoryName && (
                <span className="shrink-0 text-[12px] text-gray-500">in {item.categoryName}</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Keyboard and open/close state for the box above. Arrow keys walk the list,
 * Enter takes the highlighted suggestion (or submits what was typed), Escape
 * closes without losing the term.
 */
export function useSuggestionKeyboard({ items, onPick, onSubmit }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const boxRef = useRef(null)

  useEffect(() => {
    setActiveIndex(-1)
  }, [items.length])

  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [open])

  const handleKeyDown = useCallback(
    (e) => {
      if (!items.length) return
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        setOpen(true)
        setActiveIndex((cur) => {
          const step = e.key === "ArrowDown" ? 1 : -1
          const next = cur + step
          if (next < 0) return items.length - 1
          if (next >= items.length) return 0
          return next
        })
        return
      }
      if (e.key === "Escape") {
        setOpen(false)
        setActiveIndex(-1)
        return
      }
      if (e.key === "Enter" && open && activeIndex >= 0) {
        e.preventDefault()
        setOpen(false)
        onPick(items[activeIndex])
      }
    },
    [items, open, activeIndex, onPick],
  )

  const submit = useCallback(
    (e) => {
      setOpen(false)
      setActiveIndex(-1)
      onSubmit(e)
    },
    [onSubmit],
  )

  return { open, setOpen, activeIndex, setActiveIndex, boxRef, handleKeyDown, submit }
}
