import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LifeBuoy, Mail, Phone } from 'lucide-react'
import { API_ENDPOINTS } from '@food/api/config'
import { publicGetOnce } from '@food/api'
import { SUPPORT_PATH } from './services'

/**
 * How to reach support, for any service's help page.
 *
 * Phone and email come from the platform's business settings (Admin > Business
 * Setup); an entry the admin has not filled in is left out rather than shown
 * as a placeholder. Raising a ticket always works, in the one help centre.
 *
 * Read straight from the public endpoint, not through Food's settings loader,
 * which also re-brands the page title and favicon.
 */
export default function SupportContact({ className = '' }) {
  const [contact, setContact] = useState({ phone: '', email: '' })

  useEffect(() => {
    let alive = true
    publicGetOnce(API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC)
      .then((res) => {
        const s = res?.data?.data || res?.data || {}
        const number = String(s.phone?.number || '').trim()
        const phone = number ? `${String(s.phone?.countryCode || '').trim()} ${number}`.trim() : ''
        if (alive) setContact({ phone, email: String(s.email || '').trim() })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const tile = 'flex items-start gap-3 p-4 bg-white dark:bg-[#171717] rounded-lg border border-gray-100 dark:border-gray-800'

  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${className}`}>
      <div className={tile}>
        <LifeBuoy className="h-5 w-5 text-[#EB590E] shrink-0" aria-hidden="true" />
        <div>
          <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">Raise a ticket</h3>
          <p className="text-sm text-gray-500 mb-2">About any order, ride or booking</p>
          <Link to={SUPPORT_PATH} className="text-sm font-medium text-[#EB590E] hover:underline">
            Open help centre
          </Link>
        </div>
      </div>
      {contact.phone ? (
        <div className={tile}>
          <Phone className="h-5 w-5 text-[#EB590E] shrink-0" aria-hidden="true" />
          <div>
            <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">Call us</h3>
            <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="text-sm font-medium text-[#EB590E] hover:underline">
              {contact.phone}
            </a>
          </div>
        </div>
      ) : null}
      {contact.email ? (
        <div className={tile}>
          <Mail className="h-5 w-5 text-[#EB590E] shrink-0" aria-hidden="true" />
          <div>
            <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">Email us</h3>
            <a href={`mailto:${contact.email}`} className="text-sm font-medium text-[#EB590E] hover:underline break-all">
              {contact.email}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
