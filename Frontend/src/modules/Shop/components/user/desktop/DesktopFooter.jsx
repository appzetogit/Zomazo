import { useState } from "react"
import { Link } from "react-router-dom"
import { Facebook, Instagram, Linkedin, Mail, MessageCircle, Phone, Youtube } from "lucide-react"
import { BRAND_LOGO_ON_DARK } from "@/config/brandMark"
import { useStoreMode } from "@store/context/StoreModeContext"
import { useBusinessSettings } from "./useDesktopShell"

const SOCIAL_LABELS = { facebook: "Facebook", instagram: "Instagram", twitter: "X (Twitter)", x: "X", youtube: "YouTube", linkedin: "LinkedIn", whatsapp: "WhatsApp" }

/** The X wordmark (lucide only has the old bird). */
const XIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.57l11.1 14.5Z" />
  </svg>
)
const SOCIAL_ICONS = { facebook: Facebook, instagram: Instagram, twitter: XIcon, x: XIcon, youtube: Youtube, linkedin: Linkedin, whatsapp: MessageCircle }

/** Social links from Business Settings, whichever shape they're stored in. */
const socialLinksFrom = (s) => {
  const src = s?.socialLinks || s?.social || s?.socialMedia || {}
  const entries = Array.isArray(src)
    ? src.map((l) => [l?.platform || l?.name, l?.url || l?.link])
    : Object.entries(src)
  return entries
    .filter(([, url]) => typeof url === "string" && /^https:\/\//i.test(url))
    .map(([k, url]) => {
      const key = String(k).toLowerCase()
      return { key, label: SOCIAL_LABELS[key] || String(k), url, Icon: SOCIAL_ICONS[key] || null }
    })
}

function Column({ title, children }) {
  return (
    <div>
      <h2 className="mb-2 text-[16px] font-bold text-white">{title}</h2>
      <ul className="space-y-2 text-[14px] text-[#DDD]">{children}</ul>
    </div>
  )
}

const FLink = ({ to, children }) => (
  <li>
    <Link to={to} className="hover:underline">{children}</Link>
  </li>
)

/** Desktop (lg+) storefront footer. */
export default function DesktopFooter() {
  const { storePath } = useStoreMode()
  const { settings, brandName, logoOnDark } = useBusinessSettings()
  const [logoSrc, setLogoSrc] = useState(null)
  const social = socialLinksFrom(settings)
  const email = settings?.email
  const phone = settings?.phone?.number ? `${settings.phone.countryCode || ""} ${settings.phone.number}`.trim() : ""

  return (
    <footer className="wh-desktop mt-8">
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="block h-[50px] w-full bg-wh-nav-3 text-[13px] text-white hover:bg-[#485769]"
      >
        Back to top
      </button>

      <div className="bg-wh-nav-2">
        <div className="mx-auto grid max-w-[1000px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-8 sm:grid-cols-4 sm:gap-10 sm:px-[20px] sm:py-10">
          <Column title="Get to Know Us">
            <FLink to="/profile/about">About {brandName}</FLink>
            <FLink to={storePath("/sellers")}>Our stores</FLink>
            <FLink to="/offers">Offers &amp; deals</FLink>
            <FLink to="/profile/refer-earn">Refer &amp; earn</FLink>
          </Column>
          <Column title="Connect with Us">
            {social.length ? (
              <li>
                <ul aria-label="Social media" className="flex flex-wrap gap-2">
                  {social.map(({ key, label, url, Icon }) => (
                    <li key={key}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${brandName} on ${label}`}
                        title={label}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-wh-brand hover:text-wh-text focus-visible:outline-2 focus-visible:outline-wh-brand"
                      >
                        {Icon ? <Icon className="h-[18px] w-[18px]" aria-hidden="true" /> : <span className="text-[12px] font-bold">{label.charAt(0)}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
            {email ? (
              <li>
                <a href={`mailto:${email}`} className="inline-flex items-center gap-2 hover:underline">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {email}
                </a>
              </li>
            ) : null}
            {phone ? (
              <li>
                <a href={`tel:${phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-2 hover:underline">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden="true" /> {phone}
                </a>
              </li>
            ) : null}
            {!social.length && !email && !phone ? <FLink to="/help">Contact us</FLink> : null}
          </Column>
          <Column title="Make Money with Us">
            <FLink to="/seller/signup">Sell on {brandName}</FLink>
            <FLink to="/food/delivery/login">Become a delivery partner</FLink>
          </Column>
          <Column title="Let Us Help You">
            <FLink to="/profile">Your account</FLink>
            <FLink to="/orders">Returns &amp; orders</FLink>
            <FLink to="/help">Help</FLink>
            <FLink to="/profile/shipping">Shipping policy</FLink>
            <FLink to="/profile/refund">Refund policy</FLink>
            <FLink to="/profile/cancellation">Cancellation policy</FLink>
            <FLink to="/profile/terms">Terms of use</FLink>
            <FLink to="/profile/privacy">Privacy policy</FLink>
          </Column>
        </div>
      </div>

      <div className="bg-wh-nav">
        <div className="mx-auto flex max-w-[1500px] flex-col items-center gap-2 px-4 py-6 text-center text-[12px] text-[#DDD] sm:px-[20px]">
          <Link to={storePath("/")} aria-label={`${brandName} home`}>
            <img
              src={logoSrc || logoOnDark}
              alt={brandName}
              className="h-[36px] w-auto object-contain"
              onError={() => setLogoSrc(BRAND_LOGO_ON_DARK)}
            />
          </Link>
          <p className="text-[14px] font-bold text-white">{brandName}</p>
          <p>© {new Date().getFullYear()} {brandName}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
