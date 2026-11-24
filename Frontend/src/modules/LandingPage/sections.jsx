import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { Bell, ChevronDown, LifeBuoy, Mail, MapPin, Menu, MessageCircle, Phone, Receipt, ShieldAlert, Wallet, X } from 'lucide-react'
import { withBrand } from '@/shared/superapp/Brand'
import { HOME_PATH } from '@/shared/superapp/services'
import Runner, { Wordmark } from '@/shared/brand/Runner'
import ServiceArt from './ServiceArt'
import { EARN, FAQS, realLink, SERVICES, STEPS } from './content'

const NAV = [
  { label: 'Services', id: 'services' },
  { label: 'How it works', id: 'how' },
  { label: 'Earn', id: 'earn' },
  { label: 'Questions', id: 'faq' },
]

const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] },
}

// Read once per page load, so React's development double-mount cannot skip it.
let opened = null
const firstVisit = () => {
  if (opened === null) {
    try {
      opened = !sessionStorage.getItem('zomazo_opened')
      sessionStorage.setItem('zomazo_opened', '1')
    } catch {
      opened = false
    }
  }
  return opened
}

/** Once per visit: the runner crosses, the name is written, the curtain lifts. */
export function Opening() {
  const reduce = useReducedMotion()
  const [show, setShow] = useState(firstVisit)
  useEffect(() => {
    if (!show) return undefined
    const t = setTimeout(() => { opened = false; setShow(false) }, 1300)
    return () => clearTimeout(t)
  }, [show])
  if (reduce) return null
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="zl-open" exit={{ y: '-100%' }} transition={{ duration: 0.35, ease: [0.7, 0, 0.2, 1] }} aria-hidden="true">
          <motion.div className="zl-open-runner" initial={{ x: '-60vw' }} animate={{ x: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}>
            <Runner running />
          </motion.div>
          <Wordmark draw className="zl-open-word" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Header() {
  const [open, setOpen] = useState(false)
  const { scrollYProgress } = useScroll()
  const left = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
  return (
    <header className="zl-head">
      <div className="zl-wrap zl-head-row">
        <a href="#top" className="zl-logo"><Runner lines={false} /><Wordmark /></a>
        <nav className="zl-nav" aria-label="Page">
          {NAV.map((n) => <a key={n.id} href={`#${n.id}`}>{n.label}</a>)}
          <Link to="/support">Help</Link>
        </nav>
        <Link to="/login" className="zl-btn zl-btn-navy zl-btn-sm">Sign in</Link>
        <button type="button" className="zl-burger" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'}>
          {open ? <X /> : <Menu />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav className="zl-drawer" aria-label="Menu" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}>
            <div>
              {NAV.map((n) => <a key={n.id} href={`#${n.id}`} onClick={() => setOpen(false)}>{n.label}</a>)}
              <Link to="/support">Help</Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
      <div className="zl-route" aria-hidden="true">
        <motion.span style={{ width: left }} />
        <motion.i style={{ left }} />
      </div>
    </header>
  )
}

export function Hero() {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const visible = useInView(ref)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const far = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -110])
  return (
    <section ref={ref} className={`zl-hero ${visible ? 'is-live' : ''}`} id="top">
      <div className="zl-wrap zl-hero-grid">
        <div className="zl-hero-copy">
          <h1>Whatever you need, we&rsquo;re already running.</h1>
          <p>Food, rides, groceries, home services and shopping. One app, one login, one place to follow it all.</p>
          <div className="zl-hero-cta">
            <Link to={HOME_PATH} className="zl-btn zl-btn-red">Get started</Link>
            <a href="#services" className="zl-btn zl-btn-line">See the services</a>
          </div>
        </div>
        <div className="zl-hero-runner"><Runner running={visible && !reduce} title="The Zomazo delivery runner" /></div>
      </div>
      <div className="zl-street" aria-hidden="true">
        <motion.svg style={{ x: far }} className="zl-city" viewBox="0 0 1600 180" preserveAspectRatio="xMinYMax slice">
          <path fill="#F3CB00" d="M0 180V96h70V60h90v52h50V30h96v70h60V74h110v46h46V44h84v60h70V82h96V22h74v84h60V66h110v54h54V38h90v60h64V78h100V50h86v60h60V28h80v68h50V70h110v110z" />
        </motion.svg>
        <div className="zl-road"><span /></div>
      </div>
      <nav className="zl-stops" aria-label="Services">
        <div className="zl-wrap">
          {SERVICES.map((s, i) => (
            <div key={s.key} style={{ '--i': i }}>
              <Link to={s.to} className="zl-stop"><ServiceArt name={s.key} /><b>{s.name}</b></Link>
            </div>
          ))}
        </div>
      </nav>
    </section>
  )
}

function ServicePanel({ s, onActive }) {
  const ref = useRef(null)
  const here = useInView(ref, { margin: '-45% 0px -45% 0px' })
  useEffect(() => { if (here) onActive(s.key) }, [here, onActive, s.key])
  return (
    <article ref={ref} className="zl-panel" id={`service-${s.key}`} style={{ '--c': s.color }}>
      <div className="zl-panel-art"><ServiceArt name={s.key} /></div>
      <h3>{s.name}</h3>
      <p className="zl-panel-line">{s.line}</p>
      <p>{s.body}</p>
      <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
      <div className="zl-panel-cta">
        <Link to={s.to} className="zl-btn zl-btn-c">{s.cta}</Link>
        {s.links.map((l) => <Link key={l.to} to={l.to} className="zl-link">{l.label}</Link>)}
      </div>
    </article>
  )
}

export function Services() {
  const [active, setActive] = useState(SERVICES[0]?.key)
  const current = SERVICES.find((s) => s.key === active) || SERVICES[0]
  return (
    <section className="zl-services" id="services">
      <div className="zl-wrap">
        <motion.h2 {...rise}>What&rsquo;s in the bag</motion.h2>
        <div className="zl-services-grid">
          <div className="zl-box-col" aria-hidden="true">
            <div className="zl-box">
              <AnimatePresence mode="popLayout">
                <motion.div key={current.key} className="zl-box-item" initial={{ y: 150, scale: 0.4, rotate: -14 }} animate={{ y: 0, scale: 1, rotate: 0 }} exit={{ y: 150, scale: 0.4, opacity: 0 }} transition={{ type: 'spring', stiffness: 190, damping: 16 }}>
                  <ServiceArt name={current.key} />
                </motion.div>
              </AnimatePresence>
              <svg viewBox="0 0 320 250" className="zl-box-svg" fill="none">
                <path d="M34 60L6 18M286 60L314 18" stroke="#B8000F" strokeWidth="22" strokeLinecap="round" />
                <path d="M46 50H274Q300 50 296 76L276 216Q272 240 248 240H72Q48 240 44 216L24 76Q20 50 46 50Z" fill="#F50014" />
                <path d="M40 190L44 216Q48 240 72 240H248Q272 240 276 216L280 190Q276 216 248 216H72Q44 216 40 190Z" fill="#B8000F" />
                <path d="M112 100H208L114 188H210" stroke="#fff" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="zl-dots">{SERVICES.map((s) => <span key={s.key} className={s.key === current.key ? 'on' : ''} />)}</div>
            </div>
          </div>
          <div>{SERVICES.map((s) => <ServicePanel key={s.key} s={s} onActive={setActive} />)}</div>
        </div>
      </div>
    </section>
  )
}

export function How() {
  return (
    <section className="zl-how" id="how">
      <div className="zl-wrap">
        <motion.h2 {...rise}>From first tap to your door</motion.h2>
        <div className="zl-steps">
          <svg className="zl-steps-path" viewBox="0 0 1000 120" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <motion.path d="M60 60C220-20 330 140 500 60S780-20 940 60" stroke="#F50014" strokeWidth="5" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 1.3, ease: 'easeInOut' }} />
          </svg>
          <ol>
            {STEPS.map((s, i) => (
              <motion.li key={s.title} {...rise} transition={{ ...rise.transition, delay: i * 0.25 }}>
                <span className="zl-step-n">{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

const STAGES = ['Order placed', 'Being prepared', 'On the way', 'Arrived']

function OrderDemo() {
  const ref = useRef(null)
  const live = useInView(ref)
  const reduce = useReducedMotion()
  const [stage, setStage] = useState(2)
  useEffect(() => {
    if (!live || reduce) return undefined
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 1900)
    return () => clearInterval(t)
  }, [live, reduce])
  return (
    <div ref={ref} className="zl-phone" role="img" aria-label="Example of an order being tracked, from placed to arrived">
      <div className="zl-screen">
        <Wordmark className="zl-phone-word" />
        <p className="zl-phone-tag">Example order</p>
        <div className="zl-map">
          <svg viewBox="0 0 260 150" fill="none"><path d="M-10 46H270M-10 112H270M64-10V160M190-10V160" stroke="#fff" strokeWidth="13" /><path d="M24 112H190V46H238" stroke="#F50014" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 12" /></svg>
          <motion.div className="zl-map-runner" animate={{ left: ['9%', '24%', '64%', '84%'][stage], top: ['52%', '52%', '48%', '8%'][stage] }} transition={{ duration: 1, ease: 'easeInOut' }}>
            <Runner running={live && !reduce && stage < 3} lines={false} />
          </motion.div>
        </div>
        <ul>{STAGES.map((s, i) => <li key={s} className={i <= stage ? 'on' : ''}><i />{s}</li>)}</ul>
      </div>
    </div>
  )
}

const SHARED = [
  { Icon: Wallet, title: 'One wallet', body: 'One balance for your account.' },
  { Icon: Receipt, title: 'All orders', body: 'Every ride, meal and parcel in one list.' },
  { Icon: Bell, title: 'One inbox', body: 'Updates from every service together.' },
  { Icon: LifeBuoy, title: 'Help tickets', body: 'Raise an issue and follow the reply.' },
  { Icon: MessageCircle, title: 'Ride chat', body: 'Message your driver during a trip.' },
  { Icon: ShieldAlert, title: 'SOS contacts', body: 'Keep trusted people close on rides.' },
]

export function Account() {
  return (
    <section className="zl-account">
      <div className="zl-wrap zl-account-grid">
        <div>
          <motion.h2 {...rise}>One login carries you everywhere</motion.h2>
          <div className="zl-shared">
            {SHARED.map(({ Icon, title, body }) => (
              <motion.div key={title} {...rise}><Icon aria-hidden="true" /><div><h3>{title}</h3><p>{body}</p></div></motion.div>
            ))}
          </div>
        </div>
        <OrderDemo />
      </div>
    </section>
  )
}

export function Earn() {
  return (
    <section className="zl-earn" id="earn">
      <div className="zl-wrap">
        <motion.h2 {...rise}>Run with us and earn</motion.h2>
        <ul>
          {EARN.map((e) => (
            <motion.li key={e.to} {...rise}>
              <h3>{e.title}</h3><p>{e.body}</p><Link to={e.to} className="zl-btn zl-btn-navy zl-btn-sm">{e.cta}</Link>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function Faq() {
  const [open, setOpen] = useState(0)
  return (
    <section className="zl-faq" id="faq">
      <div className="zl-wrap zl-faq-grid">
        <div><motion.h2 {...rise}>Good questions</motion.h2><p>Need a person? <Link to="/support" className="zl-link">Contact support</Link></p></div>
        <div>
          {FAQS.map((f, i) => (
            <div key={f.question} className="zl-q">
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                {withBrand(f.question)}<ChevronDown className={open === i ? 'up' : ''} aria-hidden="true" />
              </button>
              <AnimatePresence initial={false}>
                {open === i && <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="zl-a"><p>{withBrand(f.answer)}</p></motion.div>}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Footer({ settings, brand }) {
  const ref = useRef(null)
  const live = useInView(ref)
  const play = realLink(settings?.play_store_url)
  const apple = realLink(settings?.app_store_url)
  const social = Object.entries(settings?.social_links || {}).map(([k, v]) => [k, realLink(v)]).filter(([, v]) => v)
  const phone = settings?.contact_phone
  const email = settings?.contact_email
  return (
    <footer className="zl-foot">
      <div className="zl-wrap zl-foot-top">
        <h2>Ready when you are.</h2>
        <div>
          <Link to={HOME_PATH} className="zl-btn zl-btn-red">Open {brand}</Link>
          {play && <a className="zl-btn zl-btn-line" href={play}>Google Play</a>}
          {apple && <a className="zl-btn zl-btn-line" href={apple}>App Store</a>}
        </div>
      </div>
      <div ref={ref} className="zl-foot-run" aria-hidden="true"><Runner running={live} /></div>
      <div className="zl-wrap zl-foot-grid">
        <Wordmark color="#FFE000" className="zl-foot-word" />
        <div><h3>Services</h3>{SERVICES.map((s) => <Link key={s.key} to={s.to}>{s.name}</Link>)}</div>
        <div>
          <h3>Company</h3><Link to="/taxi/about">About us</Link><Link to="/partner">Partner with us</Link><Link to="/support">Support</Link>
          {social.map(([k, v]) => <a key={k} href={v} rel="noreferrer" target="_blank">{k[0].toUpperCase() + k.slice(1)}</a>)}
        </div>
        <div><h3>Legal</h3><Link to="/terms?tab=terms">Terms</Link><Link to="/terms?tab=privacy">Privacy</Link><Link to="/terms?tab=refund">Refunds</Link><Link to="/terms?tab=cancellation">Cancellation</Link><Link to="/delete-account">Delete account</Link></div>
        <div>
          <h3>Contact</h3>
          {phone && <a href={`tel:${phone.replace(/\s/g, '')}`}><Phone aria-hidden="true" />{phone}</a>}
          {email && <a href={`mailto:${email}`}><Mail aria-hidden="true" />{email}</a>}
          {settings?.contact_address && <span><MapPin aria-hidden="true" />{settings.contact_address}</span>}
        </div>
      </div>
      <div className="zl-wrap zl-copy">© {new Date().getFullYear()} {brand}. All rights reserved.</div>
    </footer>
  )
}
