/**
 * The platform in one picture: many stores feed one marketplace, which goes
 * out two ways, a rider for quick orders and a courier for shipped ones.
 */
export default function MarketplaceArt({ accent = "#16a34a", className = "" }) {
  const line = "rgba(255,255,255,0.22)"
  const card = "rgba(255,255,255,0.06)"
  const edge = "rgba(255,255,255,0.14)"
  const text = "rgba(255,255,255,0.75)"
  const dim = "rgba(255,255,255,0.4)"

  return (
    <svg viewBox="0 0 360 250" className={className} role="img" aria-label="Stores feeding one marketplace, delivered by rider or courier">
      {/* Stores */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${24 + i * 112} 14)`}>
          <rect width="88" height="46" rx="10" fill={card} stroke={edge} />
          <path d="M12 20 h64 l-5 -9 h-54 z" fill={i === 1 ? accent : "rgba(255,255,255,0.18)"} opacity={i === 1 ? 0.85 : 1} />
          <rect x="16" y="24" width="16" height="14" rx="2" fill="rgba(255,255,255,0.12)" />
          <rect x="38" y="24" width="34" height="5" rx="2.5" fill="rgba(255,255,255,0.18)" />
          <rect x="38" y="33" width="22" height="5" rx="2.5" fill="rgba(255,255,255,0.1)" />
        </g>
      ))}

      {/* Stores into the hub */}
      <path d="M68 60 C68 84 180 78 180 100 M180 60 V100 M292 60 C292 84 180 78 180 100" fill="none" stroke={line} strokeWidth="1.5" strokeDasharray="4 4" />

      {/* Hub */}
      <g transform="translate(128 100)">
        <rect width="104" height="46" rx="12" fill={accent} opacity="0.16" stroke={accent} strokeOpacity="0.6" />
        <path d="M22 30 v-10 l10 -6 l10 6 v10 z" fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
        <text x="50" y="21" fill="#fff" fontSize="10" fontWeight="700" fontFamily="inherit">Marketplace</text>
        <text x="50" y="34" fill={dim} fontSize="8" fontFamily="inherit">one cart · one payment</text>
      </g>

      {/* Hub to the two lanes */}
      <path d="M180 146 C180 170 88 164 88 186 M180 146 C180 170 272 164 272 186" fill="none" stroke={line} strokeWidth="1.5" />

      {/* Quick lane */}
      <g transform="translate(24 186)">
        <rect width="128" height="52" rx="12" fill={card} stroke={edge} />
        <circle cx="26" cy="26" r="15" fill={accent} opacity="0.2" />
        <path d="M18 30 h6 l5 -9 h6 M24 30 a4 4 0 1 0 0.1 0 M36 30 a4 4 0 1 0 0.1 0 M29 21 l5 9" fill="none" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <text x="48" y="23" fill={text} fontSize="10" fontWeight="700" fontFamily="inherit">Quick</text>
        <text x="48" y="36" fill={dim} fontSize="8" fontFamily="inherit">rider · minutes</text>
      </g>

      {/* Shipped lane */}
      <g transform="translate(208 186)">
        <rect width="128" height="52" rx="12" fill={card} stroke={edge} />
        <circle cx="26" cy="26" r="15" fill="rgba(255,255,255,0.1)" />
        <path d="M18 22 l8 -4 l8 4 v9 l-8 4 l-8 -4 z M18 22 l8 4 l8 -4 M26 26 v9" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="1.6" strokeLinejoin="round" />
        <text x="48" y="23" fill={text} fontSize="10" fontWeight="700" fontFamily="inherit">Shipped</text>
        <text x="48" y="36" fill={dim} fontSize="8" fontFamily="inherit">courier · days</text>
      </g>
    </svg>
  )
}
