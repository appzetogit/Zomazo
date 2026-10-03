/**
 * Demo catalogue for QUICK COMMERCE (10-minute grocery): one Indore zone, a flat
 * category list, one approved grocery store and ~90 products with real images.
 *
 *   node scripts/demo-seed/quick.mjs             seed / refresh (idempotent)
 *   node scripts/demo-seed/quick.mjs --dry-run   show what would happen, write nothing
 *   node scripts/demo-seed/quick.mjs --remove    delete only what this script created
 *
 * Run from Backend/ (or anywhere: Backend/.env is loaded by path). Uses the real
 * quick-commerce models, so collections are qc_zones, qc_categories,
 * qc_restaurants and qc_items.
 *
 * Idempotent: every document gets a deterministic _id derived from a stable key,
 * and every document this script writes carries `demoSeed: 'quick'` (set with a
 * raw update, since the schemas are strict). --remove deletes by that tag only,
 * plus the image folder <UPLOAD_STORAGE_ROOT>/seed/quick/.
 *
 * Existing data is respected: a non-demo active zone that already covers the
 * store's point is reused instead of drawing an overlapping one, and a non-demo
 * global category with the same name is reused untouched. Neither is ever
 * modified or removed.
 *
 * What makes a product visible in the customer app (see search.service.js
 * searchProducts, restaurant.service.js listApprovedRestaurants,
 * restaurantCategory.service.js listPublicCategories):
 *   store:    status 'approved', storeType not 'pharmacy', zoneId = detected zone,
 *             isAcceptingOrders true, open hours 00:00-23:59 every day
 *   product:  approvalStatus 'approved', isAvailable true, price > 0, stockQty > 0
 *   category: global (no restaurantId), isActive, isApproved/approvalStatus
 *             approved, no zoneId, and at least one approved product in it
 *   zone:     isActive, polygon containing the customer's point
 *
 * Images are downloaded once (sequentially) to <root>/seed/quick/<key>.webp and
 * stored with the same buildPublicUrl() the upload service uses. A failed
 * download falls back to the remote URL. Existing files are reused on re-run.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(BACKEND_DIR, '.env') });

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const REMOVE = args.has('--remove');
const TAG = 'quick';
const SEED_FOLDER = 'seed/quick';

const { config } = await import('../../src/config/env.js');
const { buildPublicUrl } = await import('../../src/services/storage.service.js');
const { default: mongoose } = await import('mongoose');
const { QCZone } = await import('../../src/modules/quickCommerce/modules/food/admin/models/zone.model.js');
const { FoodCategory: QCCategory } = await import('../../src/modules/quickCommerce/modules/food/admin/models/category.model.js');
const { FoodItem: QCItem } = await import('../../src/modules/quickCommerce/modules/food/admin/models/food.model.js');
const { FoodRestaurant: QCRestaurant } = await import('../../src/modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');

const UPLOAD_ROOT = path.resolve(BACKEND_DIR, config.uploadStorageRoot || 'uploads');
const SEED_DIR = path.join(UPLOAD_ROOT, ...SEED_FOLDER.split('/'));

/** Same key -> same ObjectId on every run and every machine. */
const oid = (key) => new mongoose.Types.ObjectId(
    crypto.createHash('sha1').update(`demo-seed:quick:${key}`).digest('hex').slice(0, 24),
);

// ---------------------------------------------------------------- data

const CITY = { name: 'Indore', state: 'Madhya Pradesh', country: 'India' };

// Rectangle around Indore city (centre ~22.7196, 75.8577), incl. Vijay Nagar,
// Palasia, Rajwada, Bhawarkuan, Rau side and the airport.
const ZONE_POLYGON = [
    { latitude: 22.8200, longitude: 75.7500 },
    { latitude: 22.8200, longitude: 75.9800 },
    { latitude: 22.6200, longitude: 75.9800 },
    { latitude: 22.6200, longitude: 75.7500 },
];

const STORE = {
    key: 'store-vijay-nagar',
    name: 'Zomazo Fresh Mart - Vijay Nagar',
    // Clearly fake demo number. Seller sign-in is OTP-only; no password is set.
    phone: '9000000101',
    lat: 22.7533,
    lng: 75.8937,
    addressLine1: 'Shop 4, Scheme No. 54, AB Road',
    area: 'Vijay Nagar',
    pincode: '452010',
};

const DJ = (p) => `https://cdn.dummyjson.com/product-images/${p}/thumbnail.webp`;
const WM = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=600`;
const OFF = (p) => `https://images.openfoodfacts.org/images/products/${p}.400.jpg`;
const OBF = (p) => `https://images.openbeautyfacts.org/images/products/${p}.400.jpg`;
const OPF = (p) => `https://images.openproductsfacts.org/images/products/${p}.400.jpg`;

const CATEGORIES = [
    { key: 'fruits-veg', name: 'Fruits & Vegetables', perish: 'fresh', gst: 0 },
    { key: 'dairy', name: 'Dairy, Bread & Eggs', perish: 'chilled', gst: 5 },
    { key: 'staples', name: 'Atta, Rice, Oil & Dal', perish: 'ambient', gst: 5 },
    { key: 'snacks', name: 'Snacks & Biscuits', perish: 'ambient', gst: 12 },
    { key: 'beverages', name: 'Cold Drinks & Juices', perish: 'ambient', gst: 12 },
    { key: 'tea-coffee', name: 'Tea & Coffee', perish: 'ambient', gst: 5 },
    { key: 'personal-care', name: 'Personal Care', perish: 'ambient', gst: 18 },
    { key: 'household', name: 'Household & Cleaning', perish: 'ambient', gst: 18 },
    { key: 'kitchen', name: 'Kitchen Essentials', perish: 'ambient', gst: 18 },
];

// [key, category, name, brand, packSize, mrp, price, imageUrl, extra]
const P = (key, cat, name, brand, packSize, mrp, price, img, extra = {}) =>
    ({ key, cat, name, brand, packSize, mrp, price, img, ...extra });

const PRODUCTS = [
    // Fruits & Vegetables
    P('apple-shimla', 'fruits-veg', 'Shimla Apple', '', '1 kg', 220, 189, DJ('groceries/apple'), { rec: true }),
    P('banana-robusta', 'fruits-veg', 'Banana Robusta', '', '6 pcs', 60, 49, WM('Banana-Single.jpg'), { rec: true }),
    P('tomato-hybrid', 'fruits-veg', 'Tomato Hybrid', '', '1 kg', 50, 39, WM('Bright_red_tomato_and_cross_section02.jpg'), { rec: true }),
    P('potato', 'fruits-veg', 'Potato', '', '1 kg', 45, 35, DJ('groceries/potatoes')),
    P('onion-red', 'fruits-veg', 'Red Onion', '', '1 kg', 55, 42, DJ('groceries/red-onions'), { rec: true }),
    P('cucumber', 'fruits-veg', 'Cucumber', '', '500 g', 40, 32, DJ('groceries/cucumber')),
    P('capsicum-green', 'fruits-veg', 'Green Capsicum', '', '250 g', 40, 30, DJ('groceries/green-bell-pepper')),
    P('green-chilli', 'fruits-veg', 'Green Chilli', '', '100 g', 15, 12, DJ('groceries/green-chili-pepper')),
    P('lemon', 'fruits-veg', 'Lemon', '', '4 pcs', 30, 24, DJ('groceries/lemon')),
    P('kiwi', 'fruits-veg', 'Kiwi', '', '3 pcs', 120, 99, DJ('groceries/kiwi')),
    P('strawberry', 'fruits-veg', 'Strawberry', '', '200 g', 150, 119, DJ('groceries/strawberry')),
    P('carrot', 'fruits-veg', 'Carrot', '', '500 g', 40, 32, WM('Vegetable-Carrot-Bundle-wStalks.jpg')),
    P('spinach', 'fruits-veg', 'Spinach (Palak)', '', '250 g', 30, 22, WM('Spinach_leaves.jpg')),
    P('cauliflower', 'fruits-veg', 'Cauliflower', '', '1 pc (approx. 500 g)', 45, 35, WM('Cauliflower.JPG')),
    P('garlic', 'fruits-veg', 'Garlic', '', '200 g', 60, 48, WM('Garlic.jpg')),
    P('ginger', 'fruits-veg', 'Ginger', '', '200 g', 40, 32, WM('Ginger_Root.jpg')),
    P('coriander', 'fruits-veg', 'Coriander Leaves', '', '100 g', 20, 15, WM('Coriander_leaves.jpg')),
    P('mango-alphonso', 'fruits-veg', 'Alphonso Mango', '', '1 kg', 450, 399, WM('Mangos_-_single_and_halved.jpg')),
    P('orange-nagpur', 'fruits-veg', 'Nagpur Orange', '', '1 kg', 120, 95, WM('Oranges_-_whole-halved-segment.jpg')),
    P('grapes-green', 'fruits-veg', 'Green Grapes', '', '500 g', 90, 75, WM('Grapes,_Rostov-on-Don,_Russia.jpg')),
    P('pomegranate', 'fruits-veg', 'Pomegranate', '', '500 g', 150, 125, WM('Pomegranate_DSW.JPG')),
    P('brinjal', 'fruits-veg', 'Brinjal (Baingan)', '', '500 g', 40, 30, WM('Brinjal.jpg')),
    P('watermelon', 'fruits-veg', 'Watermelon', '', '1 pc (approx. 2.5 kg)', 90, 69, WM('Watermelon_cross_BNC.jpg')),
    P('papaya', 'fruits-veg', 'Papaya', '', '1 pc (approx. 1 kg)', 70, 55, WM('Papaya_cross_section_BNC.jpg')),

    // Dairy, Bread & Eggs
    P('amul-taaza-500', 'dairy', 'Amul Taaza Toned Milk', 'Amul', '500 ml', 29, 27, OFF('890/126/226/0121/front_en.52'), { barcode: '8901262260121', gst: 0, rec: true }),
    P('amul-taaza-1l', 'dairy', 'Amul Taaza Toned Milk', 'Amul', '1 L', 56, 54, OFF('890/126/215/0064/front_en.37'), { barcode: '8901262150064', gst: 0 }),
    P('amul-butter-100', 'dairy', 'Amul Pasteurised Butter', 'Amul', '100 g', 62, 58, OFF('890/126/201/0016/front_en.53'), { barcode: '8901262010016', gst: 12, rec: true }),
    P('amul-buttermilk', 'dairy', 'Amul Masti Buttermilk', 'Amul', '500 ml', 30, 28, OFF('890/126/220/0004/front_en.3'), { barcode: '8901262200004' }),
    P('amul-paneer', 'dairy', 'Amul Malai Paneer', 'Amul', '200 g', 95, 89, OFF('890/126/218/0016/front_en.5'), { barcode: '8901262180016' }),
    P('md-dahi-1kg', 'dairy', 'Mother Dairy Classic Dahi', 'Mother Dairy', '1 kg', 80, 75, OFF('890/164/802/2169/front_en.15'), { barcode: '8901648022169' }),
    P('md-dahi-400', 'dairy', 'Mother Dairy Ultimate Dahi', 'Mother Dairy', '400 g', 55, 50, OFF('890/164/809/7983/front_en.12'), { barcode: '8901648097983' }),
    P('eggs-6', 'dairy', 'Farm Fresh White Eggs', '', '6 pcs', 54, 48, DJ('groceries/eggs'), { veg: false, gst: 0 }),
    P('ice-cream-vanilla', 'dairy', 'Vanilla Ice Cream Tub', '', '500 ml', 160, 140, DJ('groceries/ice-cream'), { gst: 18 }),

    // Atta, Rice, Oil & Dal
    P('aashirvaad-atta-1kg', 'staples', 'Aashirvaad Superior MP Atta', 'Aashirvaad', '1 kg', 68, 62, OFF('890/172/501/6838/front_en.7'), { barcode: '8901725016838', gst: 0, rec: true }),
    P('basmati-rice-1kg', 'staples', 'Premium Basmati Rice', '', '1 kg', 160, 139, DJ('groceries/rice'), { gst: 0 }),
    P('tata-toor-dal', 'staples', 'Tata Sampann Unpolished Toor Dal', 'Tata Sampann', '1 kg', 210, 189, OFF('890/404/392/6216/front_en.5'), { barcode: '8904043926216', gst: 0 }),
    P('fortune-besan', 'staples', 'Fortune Besan', 'Fortune', '500 g', 70, 64, OFF('890/600/728/5018/front_en.30'), { barcode: '8906007285018', gst: 0 }),
    P('tata-salt', 'staples', 'Tata Salt', 'Tata', '1 kg', 28, 27, OFF('890/404/390/1015/front_en.34'), { barcode: '8904043901015', gst: 0 }),
    P('tata-salt-lite', 'staples', 'Tata Salt Lite', 'Tata', '1 kg', 48, 45, OFF('890/404/390/1077/front_en.9'), { barcode: '8904043901077', gst: 0 }),
    P('madhur-sugar', 'staples', 'Madhur Pure Sugar', 'Madhur', '1 kg', 60, 54, OFF('890/602/690/0022/front_en.4'), { barcode: '8906026900022' }),
    P('fortune-sunflower-1l', 'staples', 'Fortune Refined Sunflower Oil', 'Fortune', '1 L', 175, 155, OFF('890/600/728/0242/front_en.18'), { barcode: '8906007280242' }),
    P('honey-500', 'staples', 'Pure Honey', '', '500 g', 250, 215, DJ('groceries/honey-jar')),

    // Snacks & Biscuits
    P('maggi-70', 'snacks', 'Maggi 2-Minute Masala Noodles', 'Maggi', '70 g', 14, 14, OFF('890/105/800/0290/front_en.36'), { barcode: '8901058000290', rec: true }),
    P('maggi-560', 'snacks', 'Maggi 2-Minute Masala Noodles (Family Pack)', 'Maggi', '560 g', 105, 98, OFF('890/105/800/0306/front_en.10'), { barcode: '8901058000306' }),
    P('parle-g', 'snacks', 'Parle-G Glucose Biscuits', 'Parle', '45 g', 5, 5, OFF('890/171/913/4845/front_en.11'), { barcode: '8901719134845', gst: 18 }),
    P('kurkure-masala', 'snacks', 'Kurkure Masala Munch', 'Kurkure', '78 g', 20, 20, OFF('890/149/110/0519/front_en.48'), { barcode: '8901491100519' }),
    P('lays-classic', 'snacks', "Lay's Classic Salted Potato Chips", "Lay's", '50 g', 20, 20, OFF('890/149/110/1844/front_en.32'), { barcode: '8901491101844', rec: true }),
    P('lays-cream-onion', 'snacks', "Lay's American Style Cream & Onion", "Lay's", '55 g', 20, 20, OFF('890/149/110/1813/front_en.40'), { barcode: '8901491101813' }),
    P('lays-hot-sweet', 'snacks', "Lay's West Indies Hot 'n' Sweet Chilli", "Lay's", '25 g', 10, 10, OFF('890/149/150/3051/front_en.27'), { barcode: '8901491503051' }),
    P('haldiram-bhujia', 'snacks', "Haldiram's Aloo Bhujia", "Haldiram's", '200 g', 55, 52, OFF('890/400/440/0731/front_en.28'), { barcode: '8904004400731' }),
    P('good-day-cashew', 'snacks', 'Britannia Good Day Cashew Cookies', 'Britannia', '200 g', 40, 38, OFF('890/106/309/3287/front_en.18'), { barcode: '8901063093287', gst: 18 }),
    P('oreo-original', 'snacks', 'Oreo Original Vanilla Creme Biscuits', 'Cadbury', '41.75 g', 10, 10, OFF('762/220/222/5512/front_en.28'), { barcode: '7622202225512', gst: 18 }),
    P('dark-fantasy-chocofills', 'snacks', 'Sunfeast Dark Fantasy Choco Fills', 'Sunfeast', '69 g', 40, 38, OFF('890/172/501/5275/front_en.51'), { barcode: '8901725015275', gst: 18 }),
    P('dark-fantasy-bourbon', 'snacks', 'Sunfeast Dark Fantasy Bourbon', 'Sunfeast', '108 g', 30, 30, OFF('890/172/501/6296/front_en.20'), { barcode: '8901725016296', gst: 18 }),
    P('dairy-milk-110', 'snacks', 'Cadbury Dairy Milk Chocolate', 'Cadbury', '110 g', 100, 95, OFF('762/230/084/5759/front_en.62'), { barcode: '7622300845759', gst: 18 }),

    // Cold Drinks & Juices
    P('sprite-250', 'beverages', 'Sprite Lime Flavoured Soft Drink', 'Sprite', '250 ml', 20, 20, OFF('890/176/403/2912/front_en.48'), { barcode: '8901764032912', gst: 28 }),
    P('maaza-600', 'beverages', 'Maaza Mango Drink', 'Maaza', '600 ml', 40, 38, OFF('890/176/409/2206/front_en.86'), { barcode: '8901764092206', rec: true }),
    P('maaza-1200', 'beverages', 'Maaza Mango Drink', 'Maaza', '1.2 L', 70, 65, OFF('890/176/409/2305/front_en.4'), { barcode: '8901764092305' }),
    P('frooti-600', 'beverages', 'Frooti Mango Drink', 'Frooti', '600 ml', 40, 38, OFF('890/257/910/3170/front_en.69'), { barcode: '8902579103170' }),
    P('frooti-125', 'beverages', 'Frooti Mango Drink', 'Frooti', '125 ml', 10, 10, OFF('890/257/900/1360/front_en.64'), { barcode: '8902579001360' }),
    P('bisleri-1l', 'beverages', 'Bisleri Packaged Drinking Water', 'Bisleri', '1 L', 20, 20, OFF('890/601/729/0040/front_en.8'), { barcode: '8906017290040', gst: 18 }),
    P('bisleri-2l', 'beverages', 'Bisleri Packaged Drinking Water', 'Bisleri', '2 L', 35, 33, OFF('890/601/729/0064/front_en.3'), { barcode: '8906017290064', gst: 18 }),
    P('mixed-fruit-juice', 'beverages', 'Mixed Fruit Juice', '', '1 L', 120, 99, DJ('groceries/juice')),
    P('soft-drink-cans', 'beverages', 'Assorted Soft Drink Cans', '', 'Pack of 4 x 300 ml', 160, 140, DJ('groceries/soft-drinks'), { gst: 28 }),

    // Tea & Coffee
    P('red-label-natural-care', 'tea-coffee', 'Brooke Bond Red Label Natural Care Tea', 'Brooke Bond', '100 g', 60, 56, OFF('890/103/088/2548/front_en.14'), { barcode: '8901030882548', rec: true }),
    P('tata-tea-gold', 'tea-coffee', 'Tata Tea Gold', 'Tata Tea', '250 g', 170, 155, OFF('890/105/200/0807/front_en.3'), { barcode: '8901052000807' }),
    P('bru-gold', 'tea-coffee', 'Bru Gold Instant Coffee', 'Bru', '100 g', 330, 299, OFF('890/103/037/3930/front_en.3'), { barcode: '8901030373930', gst: 18 }),
    P('nescafe-classic', 'tea-coffee', 'Nescafe Classic Instant Coffee', 'Nescafe', '50 g', 185, 170, DJ('groceries/nescafe-coffee'), { gst: 18 }),

    // Personal Care
    P('colgate-toothpaste', 'personal-care', 'Colgate Toothpaste', 'Colgate', '100 g', 99, 92, OBF('628/100/111/2013/front_en.5')),
    P('dove-cream-bar', 'personal-care', 'Dove Beauty Cream Bar', 'Dove', '90 g', 65, 58, OBF('872/018/226/4664/front_en.12'), { barcode: '8720182264664', rec: true }),
    P('dettol-handwash', 'personal-care', 'Dettol Original Liquid Handwash', 'Dettol', '200 ml', 99, 89, OBF('890/139/632/4584/front_en.9'), { barcode: '8901396324584' }),
    P('clinic-plus-80', 'personal-care', 'Clinic Plus Strong & Long Shampoo', 'Clinic Plus', '80 ml', 60, 55, OBF('890/103/093/7163/front_en.8'), { barcode: '8901030937163' }),
    P('head-shoulders-classic', 'personal-care', 'Head & Shoulders Classic Clean Shampoo', 'Head & Shoulders', '250 ml', 299, 265, OBF('000/001/410/0765/front_en.26')),
    P('nivea-soft', 'personal-care', 'Nivea Soft Light Moisturising Cream', 'Nivea', '75 ml', 199, 179, OBF('400/580/889/0576/front_en.26'), { barcode: '4005808890576' }),
    P('attitude-hand-soap', 'personal-care', 'Attitude Super Leaves Hand Soap', 'Attitude', '473 ml', 499, 449, DJ('skin-care/attitude-super-leaves-hand-soap')),
    P('olay-body-wash', 'personal-care', 'Olay Ultra Moisture Shea Butter Body Wash', 'Olay', '650 ml', 699, 629, DJ('skin-care/olay-ultra-moisture-shea-butter-body-wash')),
    P('vaseline-men-lotion', 'personal-care', 'Vaseline Men Body & Face Lotion', 'Vaseline', '200 ml', 349, 315, DJ('skin-care/vaseline-men-body-and-face-lotion')),

    // Household & Cleaning
    P('vim-bar', 'household', 'Vim Dishwash Bar', 'Vim', '155 g', 30, 28, OPF('890/103/053/5697/front_en.21'), { barcode: '8901030535697', rec: true }),
    P('vim-gel', 'household', 'Vim Lemon Dishwash Liquid Gel', 'Vim', '140 ml', 30, 28, OPF('890/103/088/9875/front_en.5'), { barcode: '8901030889875' }),
    P('surf-excel-500', 'household', 'Surf Excel Easy Wash Detergent Powder', 'Surf Excel', '500 g', 70, 65, OPF('890/910/602/6346/front_en.8'), { barcode: '8909106026346' }),
    P('harpic-200', 'household', 'Harpic Power Plus Toilet Cleaner', 'Harpic', '200 ml', 50, 47, OPF('890/139/615/2002/front_en.21'), { barcode: '8901396152002' }),
    P('harpic-1l', 'household', 'Harpic Toilet Cleaner', 'Harpic', '1 L', 199, 185, OPF('890/139/617/3595/front_en.16'), { barcode: '8901396173595' }),
    P('lizol-750', 'household', 'Lizol Disinfectant Floor Cleaner', 'Lizol', '750 ml', 199, 179, OPF('890/139/611/8206/front_en.3'), { barcode: '8901396118206' }),
    P('tissue-box', 'household', 'Facial Tissue Box', '', '100 pulls', 120, 99, DJ('groceries/tissue-paper-box')),

    // Kitchen Essentials
    P('chopping-board', 'kitchen', 'Wooden Chopping Board', '', '1 pc', 399, 299, DJ('kitchen-accessories/chopping-board')),
    P('kitchen-knife', 'kitchen', 'Stainless Steel Kitchen Knife', '', '1 pc', 249, 199, DJ('kitchen-accessories/knife')),
    P('lunch-box', 'kitchen', 'Lunch Box', '', '1 pc', 449, 349, DJ('kitchen-accessories/lunch-box')),
    P('peeler', 'kitchen', 'Vegetable Peeler', '', '1 pc', 99, 79, DJ('kitchen-accessories/yellow-peeler')),
];

// ---------------------------------------------------------------- helpers

const counts = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

const fileExists = async (p) => fs.stat(p).then((s) => s.isFile() && s.size > 0).catch(() => false);

let sharpMod;
const loadSharp = async () => {
    if (sharpMod === undefined) {
        try {
            sharpMod = (await import('sharp')).default;
            sharpMod.cache(false);
            sharpMod.concurrency(1);
        } catch {
            sharpMod = null;
        }
    }
    return sharpMod;
};

/**
 * Local public URL for `remote`, downloading it once. Falls back to the
 * remote URL if the download or conversion fails.
 */
const localImage = async (key, remote) => {
    if (DRY_RUN) return remote;
    const webpName = `${key}.webp`;
    for (const name of [webpName, `${key}.jpg`]) {
        if (await fileExists(path.join(SEED_DIR, name))) {
            bump('images cached');
            return buildPublicUrl(`${SEED_FOLDER}/${name}`);
        }
    }
    try {
        const res = await fetch(remote, {
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
            headers: { 'User-Agent': 'zomazo-demo-seed/1.0 (https://zomazo.in)' },
        });
        const type = String(res.headers.get('content-type') || '');
        if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500 || buf.length > 8 * 1024 * 1024) throw new Error(`bad size ${buf.length}`);
        await fs.mkdir(SEED_DIR, { recursive: true });
        const sharp = await loadSharp();
        let name = webpName;
        if (sharp) {
            const out = await sharp(buf).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 85 }).toBuffer();
            await fs.writeFile(path.join(SEED_DIR, name), out);
        } else {
            name = `${key}.jpg`;
            await fs.writeFile(path.join(SEED_DIR, name), buf);
        }
        bump('images downloaded');
        return buildPublicUrl(`${SEED_FOLDER}/${name}`);
    } catch (err) {
        bump('images remote fallback');
        console.warn(`  image fallback for ${key}: ${err.message}`);
        return remote;
    }
};

/**
 * Upsert by _id through a real document save (so schema defaults, validation
 * and pre-validate hooks run), then stamp the demo tag with a raw update.
 */
const upsert = async (Model, _id, data, label) => {
    if (DRY_RUN) {
        const exists = await Model.exists({ _id });
        bump(`${label} ${exists ? 'would update' : 'would create'}`);
        return { _id, ...data };
    }
    let doc = await Model.findById(_id);
    const isNew = !doc;
    if (!doc) doc = new Model({ _id });
    doc.set(data);
    await doc.save();
    await Model.collection.updateOne({ _id }, { $set: { demoSeed: TAG } });
    bump(`${label} ${isNew ? 'created' : 'updated'}`);
    return doc;
};

const isPointInPolygon = (lat, lng, coords) => {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const yi = coords[i].latitude; const xi = coords[i].longitude;
        const yj = coords[j].latitude; const xj = coords[j].longitude;
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};

// ---------------------------------------------------------------- main

const uri = config.mongodbUri;
if (!uri) {
    console.error('MONGO_URI / MONGODB_URI is not set (looked in Backend/.env and the environment).');
    process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, family: 4 });
const { host, name: dbName } = mongoose.connection;
console.log(`MongoDB ${host} / ${dbName}${DRY_RUN ? '  (dry run)' : ''}${REMOVE ? '  (remove)' : ''}`);
console.log(`Upload root ${UPLOAD_ROOT}`);

try {
    if (REMOVE) {
        for (const [label, Model] of [['products', QCItem], ['categories', QCCategory], ['stores', QCRestaurant], ['zones', QCZone]]) {
            const filter = { demoSeed: TAG };
            if (DRY_RUN) {
                counts[`${label} would delete`] = await Model.collection.countDocuments(filter);
            } else {
                counts[`${label} deleted`] = (await Model.collection.deleteMany(filter)).deletedCount;
            }
        }
        if (!DRY_RUN) {
            await fs.rm(SEED_DIR, { recursive: true, force: true });
            counts['image folder removed'] = SEED_DIR;
        }
    } else {
        // Zone: reuse a real one that already covers the store, else our own.
        // Native queries: the strict schemas would otherwise drop the demoSeed filter.
        const realZones = await QCZone.collection
            .find({ isActive: true, demoSeed: { $ne: TAG } }, { projection: { name: 1, coordinates: 1 } }).toArray();
        const covering = realZones.find((z) => Array.isArray(z.coordinates) && z.coordinates.length >= 3
            && isPointInPolygon(STORE.lat, STORE.lng, z.coordinates));
        let zoneId;
        if (covering) {
            zoneId = covering._id;
            console.log(`Reusing existing zone "${covering.name}" (${zoneId}); not tagged, never removed.`);
            bump('zones reused');
        } else {
            zoneId = oid('zone-indore');
            await upsert(QCZone, zoneId, {
                name: 'Indore', zoneName: 'Indore', country: CITY.country, serviceLocation: 'Indore, Madhya Pradesh',
                unit: 'kilometer', coordinates: ZONE_POLYGON, isActive: true,
            }, 'zones');
        }

        // Categories (flat: the customer app lists them without a tree).
        const categoryByKey = new Map();
        const firstImage = new Map(PRODUCTS.map((p) => [p.cat, null]));
        for (const p of PRODUCTS) if (!firstImage.get(p.cat)) firstImage.set(p.cat, p);
        for (const [i, c] of CATEGORIES.entries()) {
            const existing = await QCCategory.collection.findOne({
                name: c.name, demoSeed: { $ne: TAG }, restaurantId: null,
            }, { projection: { _id: 1 } });
            if (existing) {
                categoryByKey.set(c.key, { ...c, _id: existing._id });
                bump('categories reused');
                continue;
            }
            const sample = firstImage.get(c.key);
            const image = sample ? await localImage(`cat-${c.key}`, sample.img) : '';
            const _id = oid(`cat-${c.key}`);
            await upsert(QCCategory, _id, {
                name: c.name, image, type: 'grocery', foodTypeScope: 'Both',
                restaurantId: undefined, zoneId: undefined, parentId: undefined,
                approvalStatus: 'approved', isApproved: true, approvedAt: new Date(),
                isActive: true, sortOrder: (i + 1) * 10,
            }, 'categories');
            categoryByKey.set(c.key, { ...c, _id });
        }

        // Store.
        const storeId = oid(STORE.key);
        const storeImage = await localImage('store-profile', DJ('groceries/apple'));
        const storeCover = await localImage('store-cover', WM('Mangos_-_single_and_halved.jpg'));
        await upsert(QCRestaurant, storeId, {
            restaurantName: STORE.name,
            ownerName: 'Zomazo Demo Seller',
            ownerEmail: 'demo-quick-store@example.invalid',
            ownerPhone: STORE.phone,
            primaryContactNumber: STORE.phone,
            pureVegRestaurant: false,
            storeType: 'grocery',
            storageCapability: ['chilled', 'frozen'],
            addressLine1: STORE.addressLine1,
            area: STORE.area,
            city: CITY.name,
            state: CITY.state,
            pincode: STORE.pincode,
            location: {
                type: 'Point',
                coordinates: [STORE.lng, STORE.lat],
                latitude: STORE.lat,
                longitude: STORE.lng,
                formattedAddress: `${STORE.addressLine1}, ${STORE.area}, ${CITY.name}, ${CITY.state} ${STORE.pincode}`,
                address: STORE.addressLine1,
                area: STORE.area,
                city: CITY.name,
                state: CITY.state,
                pincode: STORE.pincode,
            },
            zoneId,
            status: 'approved',
            approvedAt: new Date(),
            isAcceptingOrders: true,
            openingTime: '00:00',
            closingTime: '23:59',
            openDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            estimatedDeliveryTime: '10-15 mins',
            estimatedDeliveryTimeMinutes: 10,
            profileImage: storeImage,
            coverImage: storeCover,
            coverImages: [storeCover],
            rating: 4.5,
            totalRatings: 128,
            businessModel: 'Commission Base',
        }, 'stores');

        // Products.
        for (const p of PRODUCTS) {
            const cat = categoryByKey.get(p.cat);
            const base = CATEGORIES.find((c) => c.key === p.cat);
            const image = await localImage(`p-${p.key}`, p.img);
            const off = p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
            await upsert(QCItem, oid(`item-${p.key}`), {
                restaurantId: storeId,
                categoryId: cat._id,
                categoryName: cat.name,
                name: p.name,
                description: `${p.brand ? `${p.brand} ` : ''}${p.name}, ${p.packSize}. Delivered in minutes from ${STORE.name}.`,
                price: p.price,
                mrp: p.mrp,
                otherPrice: 0,
                discountPercent: off,
                image,
                images: [image],
                foodType: p.veg === false ? 'Non-Veg' : 'Veg',
                brand: p.brand,
                packSize: p.packSize,
                sku: `DEMO-QC-${p.key.toUpperCase()}`,
                barcode: p.barcode || '',
                perishability: base.perish,
                gstRate: p.gst ?? base.gst,
                isAvailable: true,
                stockQty: base.perish === 'fresh' ? 60 : 150,
                lowStockThreshold: 5,
                maxQtyPerOrder: 10,
                isRecommended: !!p.rec,
                approvalStatus: 'approved',
                approvedAt: new Date(),
                rating: 4.3,
                totalRatings: 25,
            }, 'products');
        }
    }
} finally {
    console.log('\nSummary');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(28)} ${v}`);
    if (!REMOVE && !DRY_RUN) {
        console.log(`\nDemo seller: "${STORE.name}", phone ${STORE.phone} (OTP sign-in, no password).`);
        console.log('Public listings are cached for up to a minute or so; give them a moment to appear.');
    }
    if (DRY_RUN) console.log('\n(dry run - nothing written, nothing downloaded)');
    await mongoose.disconnect();
}
