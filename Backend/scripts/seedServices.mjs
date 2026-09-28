/**
 * Dev seed for the Services (home services booking) app, so a fresh
 * environment has something to browse and book.
 *
 *   node scripts/seedServices.mjs
 *
 * Creates, if missing: four categories, a brand in each, a few services per
 * brand, one approved vendor and one approved worker under it who takes all four
 * categories. Idempotent: everything is matched on a stable key (category and
 * brand slug, service title within its brand, partner phone) and only inserted
 * when absent, so re-running changes nothing and never overwrites an admin's
 * edits. Never run automatically, and refuses to run with NODE_ENV=production.
 *
 * The partners sit at SEED_LAT / SEED_LNG (Pune by default) and are left
 * offline: sign in as the worker (phone 9000000102) and go online to take jobs.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  console.error('seedServices: refusing to run with NODE_ENV=production.');
  process.exit(1);
}

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error('seedServices: MONGO_URI is not set.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const SP = '../src/modules/serviceProvider/models';
const Category = require(`${SP}/Category.js`);
const Brand = require(`${SP}/Brand.js`);
const Service = require(`${SP}/UserService.js`);
const Vendor = require(`${SP}/Vendor.js`);
const Worker = require(`${SP}/Worker.js`);

const LAT = Number(process.env.SEED_LAT) || 18.5204;
const LNG = Number(process.env.SEED_LNG) || 73.8567;
const CITY = process.env.SEED_CITY || 'Pune';

const CATALOGUE = [
  {
    category: { title: 'Plumbing', slug: 'plumbing', homeOrder: 1 },
    brand: { title: 'Plumbing repairs', slug: 'plumbing-repairs' },
    services: [
      { title: 'Tap repair or replacement', basePrice: 199, pricingUnit: 'per tap', description: 'Fix a leaking or broken tap, or fit a new one you supply.' },
      { title: 'Blocked drain cleaning', basePrice: 349, pricingUnit: 'per drain', description: 'Clear a blocked sink, basin or floor drain.' },
      { title: 'Flush tank repair', basePrice: 299, pricingUnit: '', description: 'Repair a running or weak flush, including internal parts fitting.' },
    ],
  },
  {
    category: { title: 'Electrician', slug: 'electrician', homeOrder: 2 },
    brand: { title: 'Electrical work', slug: 'electrical-work' },
    services: [
      { title: 'Fan installation', basePrice: 249, pricingUnit: 'per fan', description: 'Install a ceiling or wall fan on an existing point.' },
      { title: 'Switchboard repair', basePrice: 149, pricingUnit: 'per board', description: 'Fix loose or burnt switches and sockets.' },
      { title: 'Light fitting', basePrice: 129, pricingUnit: 'per light', description: 'Fit tube lights, bulbs holders or decorative lights.' },
    ],
  },
  {
    category: { title: 'Cleaning', slug: 'cleaning', homeOrder: 3 },
    brand: { title: 'Home cleaning', slug: 'home-cleaning' },
    services: [
      { title: 'Bathroom deep cleaning', basePrice: 499, pricingUnit: 'per bathroom', description: 'Tiles, fittings and floor, descaled and cleaned.' },
      { title: 'Kitchen deep cleaning', basePrice: 1299, pricingUnit: '', description: 'Cabinets outside, counters, sink, tiles and chimney exterior.' },
      { title: 'Sofa shampooing', basePrice: 699, pricingUnit: 'per 3 seats', description: 'Fabric sofa vacuumed and shampooed.' },
    ],
  },
  {
    category: { title: 'AC & Appliances', slug: 'ac-appliances', homeOrder: 4 },
    brand: { title: 'AC service', slug: 'ac-service' },
    services: [
      { title: 'AC service (split)', basePrice: 599, pricingUnit: 'per AC', description: 'Filter and coil cleaning with a cooling check.' },
      { title: 'AC gas refill', basePrice: 2499, pricingUnit: 'per AC', description: 'Leak check and gas top-up.' },
      { title: 'Washing machine repair', basePrice: 349, pricingUnit: 'visit', description: 'Diagnosis and repair; parts billed at list price.' },
    ],
  },
];

const counts = { created: 0, kept: 0 };
/** Insert `doc` when nothing matches `filter`; return the stored document either way. */
const ensure = async (Model, filter, doc, label) => {
  const before = await Model.findOne(filter).lean();
  if (before) {
    counts.kept += 1;
    return before;
  }
  const created = await Model.create(doc);
  counts.created += 1;
  console.log(`  + ${label}`);
  return created.toObject();
};

await mongoose.connect(uri);
console.log(`Seeding Services data into ${mongoose.connection.name}`);

const titles = [];
for (const entry of CATALOGUE) {
  const category = await ensure(
    Category,
    { slug: entry.category.slug },
    { ...entry.category, showOnHome: true, status: 'active' },
    `category ${entry.category.title}`
  );
  titles.push(category.title);
  const brand = await ensure(
    Brand,
    { slug: entry.brand.slug },
    { ...entry.brand, categoryIds: [category._id], categoryId: category._id, status: 'active' },
    `brand ${entry.brand.title}`
  );
  for (const s of entry.services) {
    await ensure(
      Service,
      { brandId: brand._id, title: s.title },
      { ...s, brandId: brand._id, categoryId: category._id, gstPercentage: 18, status: 'active' },
      `service ${s.title}`
    );
  }
}

const placeholder = (what) => `https://placehold.co/600x400?text=${encodeURIComponent(`Dev seed ${what}`)}`;
const vendor = await ensure(
  Vendor,
  { phone: '9000000101' },
  {
    name: 'Dev Seed Owner',
    businessName: 'HomeFix Services (dev seed)',
    email: 'homefix.seed@example.com',
    phone: '9000000101',
    service: titles,
    categories: titles,
    skills: titles,
    aadhar: { number: '000000000000', document: placeholder('Aadhar front'), backDocument: placeholder('Aadhar back') },
    pan: { number: 'AAAAA0000A', document: placeholder('PAN') },
    approvalStatus: 'approved',
    approvalDate: new Date(),
    isActive: true,
    isPhoneVerified: true,
    address: { addressLine1: 'Dev seed office', city: CITY, state: 'Maharashtra', pincode: '411001', lat: LAT, lng: LNG },
    location: { lat: LAT, lng: LNG, updatedAt: new Date() },
    geoLocation: { type: 'Point', coordinates: [LNG, LAT] },
  },
  'vendor HomeFix Services (phone 9000000101)'
);

const year = new Date(Date.now() + 365 * 86400000);
await ensure(
  Worker,
  { phone: '9000000102' },
  {
    name: 'Ravi (dev seed)',
    phone: '9000000102',
    vendorId: vendor._id,
    approvalStatus: 'approved',
    isActive: true,
    isPhoneVerified: true,
    serviceCategories: titles,
    address: { addressLine1: 'Dev seed', city: CITY, state: 'Maharashtra', pincode: '411001' },
    location: { lat: LAT, lng: LNG, updatedAt: new Date() },
    geoLocation: { type: 'Point', coordinates: [LNG, LAT] },
    subscription: { isActive: true, startDate: new Date(), expiryDate: year },
  },
  'worker Ravi (phone 9000000102)'
);

console.log(`Done: ${counts.created} created, ${counts.kept} already there.`);
await mongoose.disconnect();
// Some models this loads keep timers or clients open; a one-shot script ends here.
process.exit(0);
