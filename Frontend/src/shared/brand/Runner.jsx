import './brand.css'

/**
 * The Zomazo runner, redrawn from the logo as jointed SVG parts so it can move.
 * Still by default, in the logo's own pose; `running` plays the run cycle.
 */
const NAVY = '#071A33'
const NAVY_LIT = '#12315A'
const NAVY_FAR = '#050F20'
const RED = '#F50014'
const RED_DARK = '#B8000F'

function Leg({ side }) {
  const fill = side === 'back' ? NAVY_FAR : NAVY
  return (
    <g transform="translate(312 284)">
      <g className={`zr-thigh zr-${side}`}>
        <path d="M0 0V92" stroke={fill} strokeWidth="50" strokeLinecap="round" />
        <g transform="translate(0 92)">
          <g className={`zr-shin zr-${side}`}>
            <path d="M0 0V66" stroke={fill} strokeWidth="38" strokeLinecap="round" />
            <path d="M-4 80H44" stroke={fill} strokeWidth="40" strokeLinecap="round" />
            <path d="M8 70H40" stroke={NAVY_LIT} strokeWidth="7" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </g>
  )
}

function Arm({ side }) {
  const fill = side === 'back' ? NAVY_FAR : NAVY
  return (
    <g transform="translate(388 196)">
      <g className={`zr-upper zr-${side}`}>
        <path d="M0 0V50" stroke={fill} strokeWidth="42" strokeLinecap="round" />
        <g transform="translate(0 50)">
          <g className={`zr-fore zr-${side}`}>
            <path d="M0 0V46" stroke={fill} strokeWidth="34" strokeLinecap="round" />
            <circle cx="0" cy="64" r="21" fill={RED} />
            <circle cx="15" cy="56" r="9" fill={RED} />
          </g>
        </g>
      </g>
    </g>
  )
}

export default function Runner({ running = false, lines = true, className = '', title }) {
  return (
    <svg
      viewBox="90 50 440 420"
      className={`zr ${running ? 'zr-run' : ''} ${className}`}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {lines && (
        <g className="zr-lines" stroke={NAVY} strokeWidth="15" strokeLinecap="round">
          <path d="M170 166H210" />
          <path d="M120 200H190" />
          <path d="M150 237H188" />
        </g>
      )}
      <g className="zr-body">
        <Arm side="back" />
        <Leg side="back" />
        <path d="M384 206L318 276" stroke={NAVY} strokeWidth="82" strokeLinecap="round" />
        <Leg side="front" />
        <g className="zr-bag">
          <path d="M262 146L338 148Q360 149 357 171L343 256Q339 275 320 275L228 273Q206 272 210 251L231 163Q236 146 262 146Z" fill={RED_DARK} />
          <path d="M260 139L336 141Q357 142 354 163L340 247Q336 266 317 266L227 264Q206 263 210 243L231 156Q236 139 260 139Z" fill={RED} />
          <path d="M258 180H314L246 235H302" stroke="#fff" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="zr-head">
          <circle cx="414" cy="130" r="46" fill={NAVY} />
          <path d="M414 112H462Q474 152 444 170Q414 178 405 148Q402 126 414 112Z" fill="#FFC9A3" />
          <ellipse cx="449" cy="134" rx="6" ry="10" fill={NAVY_FAR} />
          <path d="M369 120Q370 72 418 71Q458 72 464 100L496 100Q507 102 505 111Q503 118 493 118L372 121Z" fill={RED} />
          <path d="M392 90Q402 79 420 79" stroke="#FF6672" strokeWidth="7" strokeLinecap="round" />
        </g>
        <Arm side="front" />
      </g>
    </svg>
  )
}

/** Hand-lettered ZOMAZO over its red stroke. `draw` writes it on once. */
export function Wordmark({ className = '', color = NAVY, draw = false }) {
  return (
    <svg viewBox="0 0 590 216" className={`zw ${draw ? 'zw-draw' : ''} ${className}`} fill="none" role="img" aria-label="Zomazo">
      <g transform="translate(6 96) rotate(-7) skewX(-9)" stroke={color} strokeWidth="29" strokeLinecap="round" strokeLinejoin="round">
        <path pathLength="1" d="M36 0H98L30 78H100" />
        <path pathLength="1" d="M158 4C129 4 120 24 120 42C120 62 132 78 156 78C182 78 194 60 194 41C194 20 184 4 158 4Z" />
        <path pathLength="1" d="M222 78L230 4L264 48L298 4L306 78" />
        <path pathLength="1" d="M334 78L366 4L398 78M346 58H386" />
        <path pathLength="1" d="M420 0H472L416 78H476" />
        <path pathLength="1" d="M528 2C500 2 493 22 493 40C493 60 504 76 528 76C553 76 564 58 564 39C564 18 553 2 528 2Z" />
      </g>
      <path pathLength="1" className="zw-stroke" d="M110 206C220 176 350 160 474 166" stroke={RED} strokeWidth="15" strokeLinecap="round" />
    </svg>
  )
}
