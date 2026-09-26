import { useEffect, useState } from "react"

/**
 * Types each word out, holds it, deletes it and moves to the next — the search
 * placeholder that reads "Search "h…", "Search "mil…" (QUICK_MOBILE_SPEC.md §5).
 * Under prefers-reduced-motion it shows each word whole instead of typing it.
 */
export default function useTypewriter(words, { typeMs = 90, holdMs = 1400, deleteMs = 45 } = {}) {
  const [text, setText] = useState("")
  const list = Array.isArray(words) ? words.filter(Boolean) : []
  const key = list.join("|")

  useEffect(() => {
    if (!list.length) {
      setText("")
      return undefined
    }
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    let word = 0
    let chars = 0
    let deleting = false
    let timer = null

    const tick = () => {
      const current = list[word % list.length]
      if (still) {
        setText(current)
        word += 1
        timer = setTimeout(tick, holdMs + 1200)
        return
      }
      if (!deleting) {
        chars += 1
        setText(current.slice(0, chars))
        if (chars >= current.length) {
          deleting = true
          timer = setTimeout(tick, holdMs)
          return
        }
        timer = setTimeout(tick, typeMs)
        return
      }
      chars -= 1
      setText(current.slice(0, Math.max(0, chars)))
      if (chars <= 0) {
        deleting = false
        word += 1
        timer = setTimeout(tick, typeMs * 3)
        return
      }
      timer = setTimeout(tick, deleteMs)
    }

    timer = setTimeout(tick, 400)
    return () => clearTimeout(timer)
    // `key` stands in for the list's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, typeMs, holdMs, deleteMs])

  return text
}
