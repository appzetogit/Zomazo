import { SUPERAPP_SERVICES } from '@/shared/superapp/services'

/*
 * What the landing page says about each service. Only things a customer can
 * open today: rides list the types switched on in the Taxi admin, and bike
 * rental and tours stay out until their customer screens exist. A service
 * switched off for this build is absent, because SUPERAPP_SERVICES drops it.
 */
const COPY = {
  food: {
    name: 'Food',
    line: 'Dinner from the places you already love.',
    body: 'Order from restaurants around you, follow the rider on the map, or book a table and go out instead.',
    points: ['Restaurant delivery', 'Table booking', 'Offers and combos', 'Live order tracking'],
    links: [{ label: 'Book a table', to: '/food/user/dining' }],
    cta: 'Order food',
    color: '#E00012',
  },
  rides: {
    name: 'Rides',
    line: 'A bike, an auto or a cab to your door.',
    body: 'Set pickup and drop, choose the vehicle and see the fare first. Send a parcel across town, or share a seat on a longer trip.',
    points: ['Bike taxi', 'Auto', 'Cab', 'Parcel', 'Outstation', 'Pooling'],
    links: [{ label: 'Send a parcel', to: '/taxi/user/parcel/type' }],
    cta: 'Book a ride',
    color: '#1264E2',
  },
  quick: {
    name: 'Quick',
    line: 'The shop run, without the running.',
    body: 'Groceries and daily essentials from stores near you. Browse by category, search for one thing, or open a store and fill the cart.',
    points: ['Groceries', 'Nearby stores', 'Search and categories', 'Saved favourites'],
    links: [{ label: 'See stores', to: '/quick/stores' }],
    cta: 'Shop groceries',
    color: '#0B7E45',
  },
  services: {
    name: 'Services',
    line: 'Someone good, at home, when you need them.',
    body: 'Compare professionals, look at their profile, and book a slot that suits your day.',
    points: ['Home cleaning', 'Salon at home', 'AC service', 'Plumbing', 'Electrician', 'Appliance repair', 'Painting', 'Carpentry'],
    links: [{ label: 'Your bookings', to: '/services/bookings' }],
    cta: 'Book a service',
    color: '#6B35D9',
  },
  shop: {
    name: 'Shop',
    line: 'Everything else, to your doorstep.',
    body: 'An online store with many sellers. Order it here and it lands in the same order list as everything else.',
    points: ['Many sellers', 'Order tracking', 'Same wallet'],
    links: [],
    cta: 'Start shopping',
    color: '#B94700',
  },
}

export const SERVICES = SUPERAPP_SERVICES
  .filter((s) => COPY[s.key])
  .map((s) => ({ key: s.key, to: s.to, ...COPY[s.key] }))

const has = (key) => SERVICES.some((s) => s.key === key)

export const STEPS = [
  { title: 'Choose', body: 'Pick a service and tell us where.' },
  { title: 'Track', body: 'Watch it move from start to finish.' },
  { title: 'Receive', body: 'Pay with the options shown at checkout.' },
]

export const EARN = [
  { title: 'Drive', body: 'Take bike, auto, cab and parcel trips.', cta: 'Become a driver', to: '/taxi/driver' },
  { title: 'Deliver', body: 'Carry orders to customers near you.', cta: 'Become a rider', to: '/food/delivery/login' },
  { title: 'Sell', body: 'Open a restaurant, store or medical store.', cta: 'List your business', to: '/partner' },
  ...(has('shop') ? [{ title: 'Trade online', body: 'Sell to customers through Shop.', cta: 'Open seller panel', to: '/shop/seller/login' }] : []),
  ...(has('services') ? [{ title: 'Serve', body: 'Offer home services in your area.', cta: 'Join as a professional', to: '/services/vendor/login' }] : []),
]

export const FAQS = [
  { question: 'What is Quick Drop?', answer: 'One app for food, rides and parcels, groceries, home services and online shopping. One login works for all of them.' },
  { question: 'Do I need a separate account for each service?', answer: 'No. Sign in once with your phone number. Your wallet, addresses, orders and support are shared.' },
  { question: 'How can I pay?', answer: 'Choose from the options shown at checkout. They can include your wallet, online payment and cash.' },
  { question: 'Something went wrong with my order. What now?', answer: 'Open Help in your account and raise a ticket. You can follow the reply there.' },
]

const JUNK = /k9|apple\.com\/app-store\/?$/i

/** A store or social link, only when an admin has set a real one. */
export const realLink = (url) => (typeof url === 'string' && /^https:\/\//.test(url) && !JUNK.test(url) ? url : '')
