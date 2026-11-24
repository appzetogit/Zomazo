/** One flat drawing per service, in the logo's chunky style. */
const N = '#071A33'

const ART = {
  food: (
    <>
      <path d="M30 92h140a70 62 0 0 1-140 0z" fill="#F50014" />
      <path d="M22 92h156" stroke={N} strokeWidth="13" strokeLinecap="round" />
      <path d="M62 160h76" stroke={N} strokeWidth="13" strokeLinecap="round" />
      <path className="za-steam" d="M72 68q-12-16 0-30M100 64q-12-18 0-36M128 68q-12-16 0-30" stroke={N} strokeWidth="9" strokeLinecap="round" />
    </>
  ),
  rides: (
    <>
      <path d="M20 108q2-22 26-26l20-32q6-10 18-10h38q12 0 19 10l18 32q22 4 23 26v18q0 10-10 10H30q-10 0-10-10z" fill="#FFE000" stroke={N} strokeWidth="10" strokeLinejoin="round" />
      <path d="M68 80l14-22h16v22zM112 80V58h14l14 22z" fill={N} />
      <circle cx="62" cy="136" r="22" fill={N} /><circle cx="62" cy="136" r="8" fill="#fff" />
      <circle cx="142" cy="136" r="22" fill={N} /><circle cx="142" cy="136" r="8" fill="#fff" />
    </>
  ),
  quick: (
    <>
      <circle cx="74" cy="66" r="24" fill="#F50014" />
      <path d="M112 84l18-56 14 56z" fill="#FF8A00" />
      <path d="M130 28q-8-14 4-20M130 28q10-12 20-8" stroke="#0B8A4B" strokeWidth="9" strokeLinecap="round" />
      <path d="M26 82h148l-16 72q-2 10-12 10H54q-10 0-12-10z" fill="#FFE000" stroke={N} strokeWidth="10" strokeLinejoin="round" />
      <path d="M72 104l6 38M100 104v38M128 104l-6 38" stroke={N} strokeWidth="9" strokeLinecap="round" />
    </>
  ),
  services: (
    <>
      <path d="M70 70V52q0-14 14-14h32q14 0 14 14v18" stroke={N} strokeWidth="12" strokeLinecap="round" />
      <rect x="24" y="70" width="152" height="88" rx="16" fill="#F50014" stroke={N} strokeWidth="10" />
      <path d="M24 108h152" stroke={N} strokeWidth="9" />
      <rect x="84" y="96" width="32" height="28" rx="7" fill="#FFE000" stroke={N} strokeWidth="8" />
    </>
  ),
  shop: (
    <>
      <path d="M40 64h120l12 94q1 10-9 10H37q-10 0-9-10z" fill="#FFE000" stroke={N} strokeWidth="10" strokeLinejoin="round" />
      <path d="M70 84V58a30 30 0 0 1 60 0v26" stroke={N} strokeWidth="11" strokeLinecap="round" />
      <path d="M78 112h44l-42 34h42" stroke="#F50014" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
}

export default function ServiceArt({ name, className = '' }) {
  return <svg viewBox="0 0 200 180" fill="none" aria-hidden="true" className={`za ${className}`}>{ART[name]}</svg>
}
