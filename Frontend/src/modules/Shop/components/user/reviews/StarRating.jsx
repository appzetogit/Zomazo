import { Star } from "lucide-react"

/** Read-only stars (rounded to the nearest whole star), with an accessible label. */
export function StarDisplay({ rating, size = "h-4 w-4", className = "" }) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0))
  return (
    <span className={`inline-flex ${className}`} role="img" aria-label={`Rated ${r.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`${size} ${i < Math.round(r) ? "fill-wh-brand text-wh-brand" : "text-gray-300"}`}
        />
      ))}
    </span>
  )
}

/** 1-5 star picker as a radio group (arrow keys work, each star is labelled). */
export function StarInput({ value = 0, onChange, size = "h-8 w-8", name = "rating" }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="cursor-pointer rounded focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-wh-brand">
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange?.(n)}
            className="sr-only"
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          />
          <Star aria-hidden="true" className={`${size} ${n <= value ? "fill-wh-brand text-wh-brand" : "text-gray-300"}`} />
        </label>
      ))}
    </div>
  )
}
