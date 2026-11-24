import { useEffect, useState } from 'react'
import api from '../Taxi/shared/api/axiosInstance'
import { useCompanyName } from '@food/hooks/useCompanyName'
import { Account, Earn, Faq, Footer, Header, Hero, How, Opening, Services } from './sections'
import './landing.css'

// Baloo 2 echoes the logo's lettering; Hind Siliguri covers Latin and Bengali.
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap'

export default function LandingPage() {
  const brand = useCompanyName()
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    document.title = `${brand}: food, rides, groceries, services and shopping`
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = `${brand} brings food delivery, rides and parcels, groceries, home services and online shopping together with one login.`
  }, [brand])

  useEffect(() => {
    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = FONT_HREF
      document.head.appendChild(link)
    }
    let alive = true
    api.get('/common/landing-page/settings')
      .then((res) => { if (alive && res?.success) setSettings(res.data) })
      .catch(() => { /* contact details stay hidden */ })
    return () => { alive = false }
  }, [])

  return (
    <div className="zl">
      <Opening />
      <Header />
      <main><Hero /><Services /><How /><Account /><Earn /><Faq /></main>
      <Footer settings={settings} brand={brand} />
    </div>
  )
}
