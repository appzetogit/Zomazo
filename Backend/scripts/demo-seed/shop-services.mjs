/**
 * Demo seed for the SHOP (e-commerce, ecom_* collections) and SERVICES
 * (home services, sp_* collections) so a fresh deployment has something to
 * browse and book.
 *
 *   node scripts/demo-seed/shop-services.mjs             # seed (idempotent)
 *   node scripts/demo-seed/shop-services.mjs --dry-run   # print the plan, write nothing
 *   node scripts/demo-seed/shop-services.mjs --remove    # delete only what this script made
 *
 * Run from Backend/ (or anywhere: Backend/.env is loaded by path).
 *
 * What it writes
 *   Shop:     one approved seller (Indore, channel "shop" approved), a parent +
 *             child category tree, ~80 products from DummyJSON with INR prices,
 *             MRP, stock and size variants for clothing/shoes, 3 hero banners,
 *             and an Indore zone when no active zone covers Indore already.
 *   Services: 9 categories, one brand per category, ~35 bookable services,
 *             one approved vendor and one approved worker in Indore.
 *
 * Every document it creates carries `demoSeed: "shop-services"` and a stable
 * `demoKey`; re-running updates those in place, and --remove deletes exactly
 * those (plus the images it downloaded). Categories that already exist with the
 * same name/slug and were NOT made by this script are reused and never touched.
 *
 * Images are downloaded into <UPLOAD_STORAGE_ROOT>/seed/shop/ and
 * <UPLOAD_STORAGE_ROOT>/seed/services/ and stored with the same URL scheme as
 * the app's own uploads (services/storage.service.js buildPublicUrl). A file
 * already on disk is not downloaded again; a failed download keeps the remote URL.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..', '..');
dotenv.config({ path: path.join(BACKEND, '.env') });

const { default: mongoose } = await import('mongoose');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const REMOVE = args.has('--remove');
const TAG = 'shop-services';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
    console.error('shop-services: MONGO_URI / MONGODB_URI is not set (Backend/.env).');
    process.exit(1);
}

// --- Upload storage, mirroring src/config/env.js + services/storage.service.js ---
const UPLOAD_ROOT = path.resolve(
    BACKEND,
    process.env.UPLOAD_STORAGE_ROOT || (process.env.NODE_ENV === 'production' ? '/var/www/uploads' : 'uploads')
);
const uploadBase = String(process.env.UPLOAD_BASE_URL || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(https?):\/(?!\/)/i, '$1://')
    .replace(/\/+$/, '');
const publicUrl = (rel) => {
    const clean = String(rel).replace(/^\/+/, '');
    if (!uploadBase || uploadBase === '/uploads'
        || /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/uploads)?$/i.test(uploadBase)) {
        return `/uploads/${clean}`;
    }
    return `${uploadBase}/${clean}`;
};

// --- Models (the real ones) ---
const SHOP = '../../src/modules/ecommerce/modules/commerce';
const { Seller } = await import(`${SHOP}/seller/models/seller.model.js`);
const { Category: EcomCategory } = await import(`${SHOP}/admin/models/category.model.js`);
const { Product } = await import(`${SHOP}/admin/models/product.model.js`);
const { Zone } = await import(`${SHOP}/admin/models/zone.model.js`);
const { HeroBanner } = await import(`${SHOP}/landing/models/heroBanner.model.js`);

const require = createRequire(import.meta.url);
const SP = '../../src/modules/serviceProvider/models';
const SPCategory = require(`${SP}/Category.js`);
const SPBrand = require(`${SP}/Brand.js`);
const SPService = require(`${SP}/UserService.js`);
const Vendor = require(`${SP}/Vendor.js`);
const Worker = require(`${SP}/Worker.js`);

// --- Demo location and accounts (clearly fake phones, no passwords) ---
const LAT = 22.7196;
const LNG = 75.8577;
const CITY = 'Indore';
const STATE = 'Madhya Pradesh';
const PINCODE = '452001';
const SHOP_SELLER_PHONE = '9000020201';
const SP_VENDOR_PHONE = '9000020301';
const SP_WORKER_PHONE = '9000020302';

const counts = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
const UA = 'ZomazoDemoSeed/1.0 (https://zomazo.in)';
const createdFiles = [];

/** Download `remote` into seed/<folder>/ once; return the stored URL, or the remote URL on failure. */
async function localImage(remote, folder) {
    if (!remote) return '';
    let ext = path.extname(new URL(remote).pathname.split('?')[0]).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) ext = '.jpg';
    const name = `${crypto.createHash('sha1').update(remote).digest('hex').slice(0, 20)}${ext}`;
    const rel = path.posix.join('seed', folder, name);
    const abs = path.join(UPLOAD_ROOT, 'seed', folder, name);
    if (DRY) return publicUrl(rel);
    try {
        if (fs.existsSync(abs) && fs.statSync(abs).size > 0) { bump('images cached'); return publicUrl(rel); }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const res = await fetch(remote, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('empty body');
        fs.writeFileSync(abs, buf);
        createdFiles.push(abs);
        bump('images downloaded');
        return publicUrl(rel);
    } catch (err) {
        console.warn(`  ! image kept remote (${err.message}): ${remote}`);
        bump('images remote fallback');
        return remote;
    }
}

const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`;

// ---------------------------------------------------------------------------
// Tagged upsert helpers
// ---------------------------------------------------------------------------
/** Create or update a tagged document through the model (so hooks/validation run). */
async function upsertTagged(Model, key, fields, label) {
    const raw = await Model.collection.findOne({ demoSeed: TAG, demoKey: key }, { projection: { _id: 1 } });
    if (DRY) {
        bump(`${label} ${raw ? 'update' : 'create'} (dry)`);
        return { _id: raw?._id || new mongoose.Types.ObjectId(), ...fields };
    }
    let doc = raw ? await Model.findById(raw._id) : null;
    if (doc) { doc.set(fields); bump(`${label} updated`); } else { doc = new Model(fields); bump(`${label} created`); }
    await doc.save();
    await Model.collection.updateOne({ _id: doc._id }, { $set: { demoSeed: TAG, demoKey: key } });
    return doc.toObject();
}

// ---------------------------------------------------------------------------
// SHOP catalogue: parent -> children, each child fed by DummyJSON categories
// ---------------------------------------------------------------------------
const SHOP_TREE = [
    { name: 'Electronics', children: [
        { name: 'Mobiles', from: ['smartphones'], max: 6 },
        { name: 'Laptops', from: ['laptops'], max: 5 },
        { name: 'Mobile Accessories', from: ['mobile-accessories'], max: 4 },
    ] },
    { name: 'Fashion', children: [
        { name: "Men's Clothing", from: ['mens-shirts'], max: 5, sizes: ['S', 'M', 'L', 'XL'] },
        { name: "Women's Clothing", from: ['womens-dresses'], max: 5, sizes: ['S', 'M', 'L', 'XL'] },
    ] },
    { name: 'Footwear', children: [
        { name: "Men's Footwear", from: ['mens-shoes'], max: 5, sizes: ['UK 7', 'UK 8', 'UK 9', 'UK 10'] },
        { name: "Women's Footwear", from: ['womens-shoes'], max: 5, sizes: ['UK 4', 'UK 5', 'UK 6', 'UK 7'] },
    ] },
    { name: 'Watches', children: [
        { name: "Men's Watches", from: ['mens-watches'], max: 6 },
        { name: "Women's Watches", from: ['womens-watches'], max: 5 },
    ] },
    { name: 'Beauty', children: [
        { name: 'Makeup', from: ['beauty'], max: 5 },
        { name: 'Skin Care', from: ['skin-care'], max: 3 },
        { name: 'Fragrances', from: ['fragrances'], max: 5 },
    ] },
    { name: 'Accessories', children: [
        { name: 'Sunglasses', from: ['sunglasses'], max: 5 },
    ] },
    { name: 'Home Decor', children: [{ name: 'Decor', from: ['home-decoration'], max: 5 }] },
    { name: 'Furniture', children: [{ name: 'Home Furniture', from: ['furniture'], max: 5 }] },
    { name: 'Kitchen', children: [{ name: 'Kitchen Accessories', from: ['kitchen-accessories'], max: 6 }] },
];

const USD_INR = 83;
/** USD -> INR ending in 99, never below 149. */
const toInr = (usd) => Math.max(149, Math.round((usd * USD_INR) / 100) * 100 - 1);
const gstFor = (dummyCategory) => (['smartphones', 'laptops', 'mobile-accessories'].includes(dummyCategory) ? 18
    : ['mens-shirts', 'womens-dresses', 'mens-shoes', 'womens-shoes'].includes(dummyCategory) ? 12 : 18);

async function fetchDummyProducts() {
    const url = 'https://dummyjson.com/products?limit=0&select=title,description,category,price,discountPercentage,rating,stock,tags,brand,sku,images,thumbnail';
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`DummyJSON HTTP ${res.status}`);
    const json = await res.json();
    return json.products || [];
}

/** Reuse a global, non-seeded category of the same name, or create/update our tagged one. */
async function ensureEcomCategory(name, { parentId, image, sortOrder }) {
    const foreign = await EcomCategory.collection.findOne({
        name, demoSeed: { $ne: TAG }, sellerId: { $in: [null] }, parentId: parentId || { $in: [null] },
    });
    if (foreign) { bump('shop categories reused (not ours)'); return foreign; }
    return upsertTagged(EcomCategory, `shop:cat:${name}`, {
        name, image: image || '', parentId: parentId || undefined,
        approvalStatus: 'approved', isApproved: true, approvedAt: new Date(), isActive: true, sortOrder,
    }, 'shop categories');
}

/** Ray-casting point-in-polygon over a zone's {latitude, longitude} ring. */
const zoneContains = (zone, lat, lng) => {
    const pts = zone.coordinates || [];
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi, xj, yj] = [pts[i].longitude, pts[i].latitude, pts[j].longitude, pts[j].latitude];
        if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
};

async function seedShop() {
    console.log('\n[shop] zone');
    const zones = await Zone.find({ isActive: true }).lean();
    let zone = zones.find((z) => zoneContains(z, LAT, LNG));
    if (zone && zone.demoSeed !== TAG) {
        console.log(`  using existing zone "${zone.name}"`);
    } else {
        const d = 0.25; // ~27 km box around central Indore
        zone = await upsertTagged(Zone, 'shop:zone:indore', {
            name: 'Indore', zoneName: 'Indore', country: 'India', serviceLocation: 'Indore', unit: 'kilometer',
            coordinates: [
                { latitude: LAT - d, longitude: LNG - d }, { latitude: LAT - d, longitude: LNG + d },
                { latitude: LAT + d, longitude: LNG + d }, { latitude: LAT + d, longitude: LNG - d },
            ],
            etaMinutes: 30, isActive: true,
        }, 'shop zones');
    }

    console.log('[shop] fetching DummyJSON');
    const all = await fetchDummyProducts();
    const byCat = new Map();
    for (const p of all) {
        if (!byCat.has(p.category)) byCat.set(p.category, []);
        byCat.get(p.category).push(p);
    }

    console.log('[shop] seller');
    const logo = await localImage('https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp', 'shop');
    const cover = await localImage('https://cdn.dummyjson.com/product-images/furniture/annibale-colombo-sofa/1.webp', 'shop');
    const now = new Date();
    const seller = await upsertTagged(Seller, 'shop:seller', {
        sellerName: 'Zomazo Demo Store',
        ownerName: 'Demo Seller',
        ownerEmail: 'demo-shop-seller@example.com',
        ownerPhone: SHOP_SELLER_PHONE,
        primaryContactNumber: SHOP_SELLER_PHONE,
        addressLine1: 'MG Road', area: 'Palasia', city: CITY, state: STATE, pincode: PINCODE,
        location: {
            type: 'Point', coordinates: [LNG, LAT], latitude: LAT, longitude: LNG,
            formattedAddress: `MG Road, Palasia, ${CITY}, ${STATE} ${PINCODE}`,
            addressLine1: 'MG Road', area: 'Palasia', city: CITY, state: STATE, pincode: PINCODE,
        },
        zoneId: zone._id,
        isAcceptingOrders: true,
        profileImage: logo, coverImage: cover, coverImages: [cover],
        estimatedDeliveryTime: '3-5 days',
        rating: 4.5, totalRatings: 128,
        status: 'approved', approvedAt: now,
        channels: {
            shop: { status: 'approved', appliedAt: now, decidedAt: now },
            quick: { status: 'none' },
        },
        onboardingFeePaid: true, billingExempt: true, subscriptionStatus: 'paid',
    }, 'shop sellers');

    console.log('[shop] categories + products');
    let sort = 0;
    for (const parent of SHOP_TREE) {
        const firstFrom = byCat.get(parent.children[0].from[0])?.[0];
        const parentImg = await localImage(firstFrom?.thumbnail, 'shop');
        const parentCat = await ensureEcomCategory(parent.name, { image: parentImg, sortOrder: sort++ });
        for (const child of parent.children) {
            const items = child.from.flatMap((c) => byCat.get(c) || []).slice(0, child.max);
            if (!items.length) { console.warn(`  ! no DummyJSON products for ${child.name}`); continue; }
            const childImg = await localImage(items[0].thumbnail, 'shop');
            const cat = await ensureEcomCategory(child.name, { parentId: parentCat._id, image: childImg, sortOrder: sort++ });
            for (const p of items) {
                const images = [];
                for (const src of (p.images || []).slice(0, 3)) images.push(await localImage(src, 'shop'));
                if (!images.length && p.thumbnail) images.push(await localImage(p.thumbnail, 'shop'));
                const price = toInr(p.price);
                const mrp = Math.max(price, Math.ceil(price / (1 - Math.min(p.discountPercentage || 10, 60) / 100) / 100) * 100 - 1);
                const stock = Math.max(10, Number(p.stock) || 25);
                const variants = (child.sizes || []).map((size, i) => ({
                    name: size, price, mrp, otherPrice: mrp,
                    attributes: [{ name: 'Size', value: size }],
                    sku: `${p.sku || `DJ-${p.id}`}-${i + 1}`,
                    stock: { shop: Math.ceil(stock / child.sizes.length) + 2, quick: null },
                    isActive: true,
                }));
                await upsertTagged(Product, `shop:prod:${p.id}`, {
                    sellerId: seller._id,
                    categoryId: cat._id,
                    categoryName: child.name,
                    name: p.title,
                    description: p.description || '',
                    price, mrp, otherPrice: mrp,
                    image: images[0] || '', images,
                    brand: p.brand || '',
                    sku: p.sku || `DJ-${p.id}`,
                    gstRate: gstFor(p.category),
                    tags: [...new Set([...(p.tags || []), child.name.toLowerCase(), parent.name.toLowerCase()])],
                    variants,
                    channels: { shop: true, quick: false },
                    stock: { shop: variants.length ? null : stock, quick: null },
                    lowStockThreshold: { shop: 3, quick: null },
                    rating: Math.min(5, Math.max(0, Number(p.rating) || 4)),
                    totalRatings: 0,
                    isRecommended: (Number(p.rating) || 0) >= 4.5,
                    approvalStatus: 'approved', approvedAt: now,
                }, 'shop products');
            }
        }
    }

    console.log('[shop] hero banners');
    const banners = [
        { key: 'electronics', title: 'Latest smartphones & laptops', img: byCat.get('laptops')?.[0]?.images?.[0], cta: 'Shop electronics' },
        { key: 'fashion', title: 'New season fashion', img: byCat.get('womens-dresses')?.[0]?.images?.[0], cta: 'Shop fashion' },
        { key: 'home', title: 'Make your home beautiful', img: byCat.get('furniture')?.[0]?.images?.[0], cta: 'Shop home' },
    ];
    let order = 0;
    for (const b of banners) {
        if (!b.img) continue;
        const imageUrl = await localImage(b.img, 'shop');
        await upsertTagged(HeroBanner, `shop:banner:${b.key}`, {
            imageUrl, publicId: `demo-seed/shop/banner-${b.key}`, title: b.title, ctaText: b.cta,
            linkedSellerIds: [seller._id], sortOrder: order++, isActive: true,
        }, 'shop hero banners');
    }
}

// ---------------------------------------------------------------------------
// SERVICES catalogue. The model has no duration field, so the expected time is
// part of the description ("About 45 min · ...").
// ---------------------------------------------------------------------------
const IMG = {
    kitchen: commons('Woman cleaning kitchen stove with spray cleaner and cloth in bright kitchen setting.jpg'),
    floor: commons('Grundreinigung-Fliesenboden.jpg'),
    vacuum: commons('Vacuum cleaner.jpg'),
    sofa: commons('Sofa - upholstery pattern - HNT.jpg'),
    salon: commons('Hair salon in cheung chau.jpg'),
    manicure: commons('Manicure closeup.jpg'),
    facial: commons('Korean Gloow Facial at Gloow Beauty Treatment.webp'),
    massage: commons('Behind the scenes of a massage therapy session- Palapye.jpg'),
    ac: commons('Panasonic AIR CONDITIONER INDOOR UNIT CS-C10KJ2 (2).jpg'),
    acRepair: commons('Air conditioning and refrigeration repair.jpg'),
    sink: commons('Sink unclogging repair.jpg'),
    tap: commons('Kitchen Faucet 1.jpg'),
    wrench: commons('Plumber key.jpg'),
    fan: commons('Ceiling fan with 4 blades.jpg'),
    electrician: commons('Electrician at the Eletrotecnica Bene workshop, Sao Paulo.jpg'),
    cockroach: commons('Cockroach May 2007-1.jpg'),
    pest: commons('Control de Plagas.jpg'),
    washer: commons('Open top-loading washing machine.jpg'),
    fridge: commons('US Domestic Refrigerator GE.jpg'),
    microwave: commons('Panasonic MICROWAVE OVEN NN-GM333W.jpg'),
    purifier: commons('Home water filters, water purifiers, and bottled water in India.jpg'),
    geyser: commons('Warmwatergeiser.jpg'),
    roller: commons('Paint roller 4.jpg'),
    painting: commons('Painting Time.jpg'),
    carpenter: commons('Carpenter working on an item 4.jpg'),
};

// [title, price, minutes, pricingUnit, description, imageKey]
const SP_CATALOGUE = [
    { title: 'Home Cleaning', slug: 'home-cleaning', icon: 'vacuum', brand: 'Sparkle Home Cleaning', services: [
        ['Full Home Deep Cleaning (1 BHK)', 2999, 300, '1 BHK', 'Every room, kitchen and bathrooms: dusting, scrubbing, floor machine-cleaning.', 'vacuum'],
        ['Bathroom Deep Cleaning', 499, 60, 'per bathroom', 'Tiles, fittings and floor descaled and disinfected.', 'floor'],
        ['Kitchen Deep Cleaning', 1299, 150, 'per kitchen', 'Cabinets outside, counters, sink, tiles and chimney exterior degreased.', 'kitchen'],
        ['Sofa Shampooing', 699, 60, 'per 3 seats', 'Fabric sofa vacuumed, shampooed and dried.', 'sofa'],
    ] },
    { title: 'Salon at Home', slug: 'salon-at-home', icon: 'salon', brand: 'Glow Salon at Home', services: [
        ['Haircut & Styling', 499, 45, 'per person', 'Wash, cut and blow-dry by a trained stylist at your home.', 'salon'],
        ['Manicure & Pedicure', 799, 75, 'per person', 'Nail shaping, cuticle care, scrub, massage and polish.', 'manicure'],
        ['Facial Cleanup', 999, 60, 'per person', 'Cleanse, exfoliate, steam and mask for a fresh glow.', 'facial'],
        ['Relaxing Body Massage', 1199, 60, '60 min', 'Full body massage with aromatic oils.', 'massage'],
    ] },
    { title: 'AC Service & Repair', slug: 'ac-service-repair', icon: 'ac', brand: 'CoolCare AC Experts', services: [
        ['AC Service (Split)', 599, 45, 'per AC', 'Filter, coil and drain jet-cleaning with a cooling check.', 'ac'],
        ['AC Gas Refill', 2499, 90, 'per AC', 'Leak check, vacuuming and refrigerant top-up.', 'acRepair'],
        ['AC Installation', 1499, 120, 'per AC', 'Mounting, piping and test run. Materials extra.', 'ac'],
        ['AC Repair Visit', 299, 30, 'visit', 'Technician visit and fault diagnosis with estimate.', 'acRepair'],
    ] },
    { title: 'Plumbing', slug: 'plumbing', icon: 'wrench', brand: 'FlowFix Plumbers', services: [
        ['Tap Repair or Replacement', 199, 30, 'per tap', 'Fix a leaking or broken tap, or fit a new one you supply.', 'tap'],
        ['Blocked Drain Cleaning', 349, 45, 'per drain', 'Clear a blocked sink, basin or floor drain.', 'sink'],
        ['Pipe Leakage Repair', 299, 45, 'per point', 'Find and fix a leaking pipe joint.', 'wrench'],
        ['Flush Tank Repair', 299, 40, 'per tank', 'Repair a running or weak flush, including internal parts fitting.', 'wrench'],
    ] },
    { title: 'Electrician', slug: 'electrician', icon: 'electrician', brand: 'BrightSpark Electricians', services: [
        ['Fan Installation', 249, 30, 'per fan', 'Install a ceiling or wall fan on an existing point.', 'fan'],
        ['Switchboard Repair', 149, 30, 'per board', 'Fix loose or burnt switches and sockets.', 'electrician'],
        ['Light Fitting', 129, 20, 'per light', 'Fit tube lights, bulb holders or decorative lights.', 'electrician'],
        ['Home Wiring Inspection', 399, 60, 'visit', 'Safety check of wiring, MCB and earthing.', 'electrician'],
    ] },
    { title: 'Pest Control', slug: 'pest-control', icon: 'pest', brand: 'PestAway', services: [
        ['Cockroach Control', 899, 60, '1 BHK', 'Odourless gel treatment for kitchen and bathrooms.', 'cockroach'],
        ['General Pest Control', 1199, 90, '1 BHK', 'Spray treatment for cockroaches, ants and spiders.', 'pest'],
        ['Termite Treatment', 2999, 180, '1 BHK', 'Drill-fill-seal anti-termite treatment.', 'pest'],
    ] },
    { title: 'Appliance Repair', slug: 'appliance-repair', icon: 'washer', brand: 'FixIt Appliance Care', services: [
        ['Washing Machine Repair', 349, 60, 'visit', 'Drainage, drum, spin and motor faults. Parts extra.', 'washer'],
        ['Refrigerator Repair', 449, 60, 'visit', 'Cooling, compressor and thermostat faults. Parts extra.', 'fridge'],
        ['Microwave Repair', 299, 45, 'visit', 'Heating, turntable and panel faults. Parts extra.', 'microwave'],
        ['Water Purifier Service', 399, 45, 'per unit', 'Filter check, cleaning and TDS test.', 'purifier'],
        ['Geyser Repair', 349, 45, 'visit', 'Heating element, thermostat and leakage repair.', 'geyser'],
    ] },
    { title: 'Painting', slug: 'painting', icon: 'roller', brand: 'ColourCraft Painters', services: [
        ['Room Painting', 3999, 480, 'per room', 'Two coats of interior emulsion, furniture covered. Paint included.', 'roller'],
        ['Wall Touch-up', 1499, 180, 'per wall', 'Patch, sand and repaint marks and cracks.', 'painting'],
        ['Painting Consultation', 199, 30, 'visit', 'Measurement, colour advice and a written quote.', 'painting'],
    ] },
    { title: 'Carpentry', slug: 'carpentry', icon: 'carpenter', brand: 'WoodWorks Carpenters', services: [
        ['Furniture Repair', 299, 60, 'visit', 'Fix loose joints, hinges and drawers.', 'carpenter'],
        ['Door Lock Installation', 249, 30, 'per lock', 'Fit a new lock or latch you supply.', 'carpenter'],
        ['Bed Assembly', 699, 90, 'per bed', 'Assemble a flat-pack bed or wardrobe.', 'carpenter'],
    ] },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');

async function seedServices() {
    console.log('\n[services] categories, brands, services');
    const titles = [];
    let homeOrder = 1;
    for (const entry of SP_CATALOGUE) {
        const icon = await localImage(IMG[entry.icon], 'services');
        let category = await SPCategory.collection.findOne({ slug: entry.slug, demoSeed: { $ne: TAG } });
        if (category) {
            bump('sp categories reused (not ours)');
        } else {
            category = await upsertTagged(SPCategory, `sp:cat:${entry.slug}`, {
                title: entry.title, slug: entry.slug, homeIconUrl: icon, imageUrl: icon,
                description: `${entry.title} by verified professionals in ${CITY}.`,
                showOnHome: true, homeOrder: homeOrder, status: 'active', isPopular: homeOrder <= 4, cityIds: [],
            }, 'sp categories');
        }
        homeOrder += 1;
        titles.push(category.title);

        const brandSlug = `${slugify(entry.brand)}-demo`;
        const brand = await upsertTagged(SPBrand, `sp:brand:${entry.slug}`, {
            title: entry.brand, slug: brandSlug, routePath: `/user/brand/${brandSlug}`,
            categoryIds: [category._id], categoryId: category._id, cityIds: [],
            iconUrl: icon, status: 'active', isPopular: true, rating: 4.6,
        }, 'sp brands');

        for (const [title, price, minutes, unit, description, imgKey] of entry.services) {
            const iconUrl = await localImage(IMG[imgKey], 'services');
            await upsertTagged(SPService, `sp:svc:${entry.slug}:${slugify(title)}`, {
                brandId: brand._id, categoryId: category._id, title, iconUrl,
                basePrice: price, gstPercentage: 18, pricingUnit: unit,
                description: `About ${minutes >= 120 ? `${Math.round(minutes / 60)} hrs` : `${minutes} min`} · ${description}`,
                status: 'active',
            }, 'sp services');
        }
    }

    console.log('[services] vendor + worker');
    const placeholder = (what) => `https://placehold.co/600x400?text=${encodeURIComponent(`Demo ${what}`)}`;
    const now = new Date();
    const address = { addressLine1: 'Vijay Nagar', city: CITY, state: STATE, pincode: '452010', lat: LAT, lng: LNG };
    const vendor = await upsertTagged(Vendor, 'sp:vendor', {
        name: 'Demo Vendor', businessName: 'Zomazo Home Services (demo)',
        email: 'demo-sp-vendor@example.com', phone: SP_VENDOR_PHONE,
        service: titles, categories: titles, skills: titles,
        aadhar: { number: '000000000000', document: placeholder('Aadhar front'), backDocument: placeholder('Aadhar back') },
        pan: { number: 'AAAAA0000A', document: placeholder('PAN') },
        approvalStatus: 'approved', approvalDate: now, isActive: true, isPhoneVerified: true,
        address, location: { lat: LAT, lng: LNG, updatedAt: now },
        geoLocation: { type: 'Point', coordinates: [LNG, LAT] },
    }, 'sp vendors');
    await upsertTagged(Worker, 'sp:worker', {
        name: 'Demo Worker', email: 'demo-sp-worker@example.com', phone: SP_WORKER_PHONE, vendorId: vendor._id,
        approvalStatus: 'approved', isActive: true, isPhoneVerified: true, serviceCategories: titles,
        address, location: { lat: LAT, lng: LNG, updatedAt: now },
        geoLocation: { type: 'Point', coordinates: [LNG, LAT] },
        subscription: { isActive: true, startDate: now, expiryDate: new Date(Date.now() + 365 * 86400000) },
    }, 'sp workers');
}

// ---------------------------------------------------------------------------
async function remove() {
    const models = [
        ['shop products', Product], ['shop hero banners', HeroBanner], ['shop categories', EcomCategory],
        ['shop sellers', Seller], ['shop zones', Zone],
        ['sp services', SPService], ['sp brands', SPBrand], ['sp categories', SPCategory],
        ['sp workers', Worker], ['sp vendors', Vendor],
    ];
    for (const [label, Model] of models) {
        const filter = { demoSeed: TAG };
        if (DRY) { counts[`${label} to delete (dry)`] = await Model.collection.countDocuments(filter); continue; }
        const r = await Model.collection.deleteMany(filter);
        counts[`${label} deleted`] = r.deletedCount;
    }
    for (const folder of ['shop', 'services']) {
        const dir = path.join(UPLOAD_ROOT, 'seed', folder);
        if (!fs.existsSync(dir)) continue;
        const n = fs.readdirSync(dir).length;
        if (!DRY) fs.rmSync(dir, { recursive: true, force: true });
        counts[`image files ${DRY ? 'to delete (dry)' : 'deleted'} in seed/${folder}`] = n;
    }
}

await mongoose.connect(uri, { maxPoolSize: 2 });
console.log(`shop-services demo seed -> db "${mongoose.connection.name}"${DRY ? ' (dry run)' : ''}${REMOVE ? ' REMOVE' : ''}`);
console.log(`upload root ${UPLOAD_ROOT}; image URLs like ${publicUrl('seed/shop/<file>')}`);
let failed = false;
try {
    if (REMOVE) {
        await remove();
    } else {
        await seedShop();
        await seedServices();
    }
} catch (err) {
    failed = true;
    console.error('FAILED:', err?.stack || err);
}
console.log('\nSummary:');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(42)} ${v}`);
if (!REMOVE && !DRY) {
    console.log(`\nDemo accounts (phone only, no passwords): shop seller ${SHOP_SELLER_PHONE}, `
        + `SP vendor ${SP_VENDOR_PHONE}, SP worker ${SP_WORKER_PHONE}.`);
}
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
