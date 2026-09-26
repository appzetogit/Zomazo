import { useEffect, useRef } from 'react'
import { useCompanyName } from '@store/hooks/useCompanyName'

const DEFAULT_DESCRIPTION = 'Shop from multiple sellers — groceries, fashion, electronics & more. Fast delivery with real-time tracking and coins on every order.'

/**
 * Lightweight SEO head manager — sets document title and meta description
 * on mount, restores defaults on unmount.
 *
 * Usage:
 *   <SEOHead
 *     title="Cotton T-Shirts"
 *     description="Browse premium cotton t-shirts from top sellers."
 *   />
 */
export default function SEOHead({ title, description, ogTitle, ogDescription, ogImage, noindex = false }) {
  const prevTitleRef = useRef(document.title)
  const brand = useCompanyName()
  const DEFAULT_TITLE = brand
  const fullTitle = title ? `${title} | ${brand}` : brand

  useEffect(() => {
    // Save previous title for unmount restoration
    prevTitleRef.current = document.title

    // Set title
    document.title = fullTitle

    // Set meta description
    setMeta('description', description || DEFAULT_DESCRIPTION)

    // OpenGraph
    setMeta('og:title', ogTitle || fullTitle, 'property')
    setMeta('og:description', ogDescription || description || DEFAULT_DESCRIPTION, 'property')
    if (ogImage) {
      setMeta('og:image', ogImage, 'property')
    }

    // Twitter Card
    setMeta('twitter:title', ogTitle || fullTitle)
    setMeta('twitter:description', ogDescription || description || DEFAULT_DESCRIPTION)
    if (ogImage) {
      setMeta('twitter:image', ogImage)
    }

    // Robots
    if (noindex) {
      setMeta('robots', 'noindex, nofollow')
    } else {
      setMeta('robots', 'index, follow')
    }

    return () => {
      // Restore defaults on unmount
      document.title = DEFAULT_TITLE
      setMeta('description', DEFAULT_DESCRIPTION)
      setMeta('robots', 'index, follow')
    }
  }, [fullTitle, DEFAULT_TITLE, description, ogTitle, ogDescription, ogImage, noindex])

  return null
}

function setMeta(name, content, attr = 'name') {
  if (!content) return
  let el = document.querySelector(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}
