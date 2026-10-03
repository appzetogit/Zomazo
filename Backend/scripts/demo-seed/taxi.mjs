/**
 * Demo data for the TAXI module (Indore), so the rider app and the taxi admin
 * have something to show on a fresh database.
 *
 *   node scripts/demo-seed/taxi.mjs            # create / refresh (idempotent)
 *   node scripts/demo-seed/taxi.mjs --dry-run  # print the plan, write nothing
 *   node scripts/demo-seed/taxi.mjs --remove   # delete only what this script made
 *
 * Run from Backend/ (it reads Backend/.env through src/config/env.js, so
 * MONGO_URI / MONGODB_URI decide the database).
 *
 * Every document written here carries `_demoSeed: 'taxi'` and a stable
 * `_demoSeedKey`; re-runs upsert by that key, and --remove deletes by the tag,
 * so admin-created data is never touched. The tag fields are not in the model
 * schemas, which is why writes pass `strict: false`.
 *
 * Images: the taxi artwork that already ships in the repo
 * (Frontend/src/modules/Taxi/assets) is copied -- resized to WebP when sharp
 * is available -- into <UPLOAD_STORAGE_ROOT>/seed/taxi/, and stored as
 * `${UPLOAD_BASE_URL}/seed/taxi/<file>`, the same shape the app's own uploads
 * use. Where the repo file is missing, a verified Wikimedia Commons URL is
 * downloaded instead; if that fails too the remote URL itself is stored.
 *
 * No drivers, users or passwords are created.
 */
import { config } from '../../src/config/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

import { TaxiAppModule } from '../../src/modules/taxi/admin/models/TaxiAppModule.js';
import { AdminAppSetting } from '../../src/modules/taxi/admin/models/AdminAppSetting.js';
import { ServiceLocation } from '../../src/modules/taxi/admin/models/ServiceLocation.js';
import { Zone } from '../../src/modules/taxi/driver/models/Zone.js';
import { Vehicle } from '../../src/modules/taxi/admin/models/Vehicle.js';
import { SetPrice } from '../../src/modules/taxi/admin/models/SetPrice.js';
import { GoodsType } from '../../src/modules/taxi/admin/models/GoodsType.js';
import { RentalPackageType } from '../../src/modules/taxi/admin/models/RentalPackageType.js';
import { RentalVehicleType } from '../../src/modules/taxi/admin/models/RentalVehicleType.js';
import { ServiceStore } from '../../src/modules/taxi/admin/models/ServiceStore.js';
import { OnboardingScreen } from '../../src/modules/taxi/admin/models/OnboardingScreen.js';
import { AppLanguage } from '../../src/modules/taxi/admin/models/AppLanguage.js';
import { RideModule } from '../../src/modules/taxi/admin/models/RideModule.js';
import { Banner } from '../../src/modules/taxi/admin/promotions/models/Banner.js';
import { createDefaultAppSettings } from '../../src/modules/taxi/admin/data/defaultAppSettings.js';
import { createDefaultAdminState } from '../../src/modules/taxi/admin/data/defaultAdminState.js';

const TAG = 'taxi';
const DRY = process.argv.includes('--dry-run');
const REMOVE = process.argv.includes('--remove');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../../../Frontend/src/modules/Taxi/assets');
const UPLOAD_ROOT = path.resolve(config.uploadStorageRoot);
const UPLOAD_BASE = String(config.uploadBaseUrl || '/uploads').replace(/\/+$/, '');
const SEED_DIR = 'seed/taxi';

const CENTER = { lat: 22.7196, lng: 75.8577 };
// Covers Indore city and its ring road, airport (west) to Rau (south) and
// Bicholi (east). GeoJSON order: [lng, lat], ring closed.
const INDORE_POLYGON = [[
  [75.74, 22.62], [75.98, 22.62], [75.98, 22.83], [75.74, 22.83], [75.74, 22.62],
]];

const COMMONS = {
  auto: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Auto_rickshaw_in_India.jpg/960px-Auto_rickshaw_in_India.jpg',
  rajwada: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Rajwada_Palace%2C_Indore.jpg/500px-Rajwada_Palace%2C_Indore.jpg',
};

// key -> [repo asset (relative to ASSETS), remote fallback]
const IMAGES = {
  bike: ['icons/bike.png', ''],
  auto: ['icons/auto.png', COMMONS.auto],
  car: ['icons/car.png', ''],
  hatchback: ['icons/Hatchback.png', ''],
  suv: ['icons/SUV.png', ''],
  premium: ['icons/Premium.png', ''],
  luxury: ['icons/Luxury.png', ''],
  delivery: ['icons/Delivery.png', ''],
  truck: ['icons/truck.png', ''],
  lcv: ['icons/LCV.png', ''],
  outstation: ['3d images/AutoCab/one way.png', ''],
  taxi3d: ['3d images/AutoCab/taxi.png', ''],
  airport: ['3d images/AutoCab/airoplan.png', ''],
  temple: ['3d images/AutoCab/temple.png', ''],
  bus: ['3d images/AutoCab/bus.png', ''],
  goodsDocuments: ['3d images/documents.png', ''],
  goodsElectronics: ['3d images/electronics.png', ''],
  goodsClothes: ['3d images/clothes.png', ''],
  goodsGifts: ['3d images/gifts.png', ''],
  goodsGrocery: ['3d images/grocery.png', ''],
  goodsOthers: ['3d images/others.png', ''],
  deliveryBike: ['images/delivery/bike.png', ''],
  bannerMobility: ['images/mobility-banner-cartoony.png', ''],
  bannerLinks: ['images/links-banner.png', ''],
  landingParcel: ['landing/parcel.png', ''],
  landingRide: ['landing/ride.png', ''],
  rajwada: ['', COMMONS.rajwada],
};

const counts = {};
const bump = (name, n = 1) => { counts[name] = (counts[name] || 0) + n; };

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }

const exists = async (p) => fs.access(p).then(() => true, () => false);

/** Local URL for an image, creating the file once. Never throws. */
const imageCache = new Map();
const image = async (key) => {
  if (imageCache.has(key)) return imageCache.get(key);
  const [asset, remote] = IMAGES[key] || ['', ''];
  const file = `${key}.${sharp ? 'webp' : asset ? path.extname(asset).slice(1) || 'png' : 'jpg'}`;
  const dest = path.join(UPLOAD_ROOT, SEED_DIR, file);
  const url = `${UPLOAD_BASE}/${SEED_DIR}/${file}`;
  let result = remote || '';
  try {
    if (await exists(dest)) {
      result = url;
    } else {
      let buffer = null;
      if (asset && (await exists(path.join(ASSETS, asset)))) {
        buffer = await fs.readFile(path.join(ASSETS, asset));
      } else if (remote) {
        const res = await fetch(remote, { headers: { 'User-Agent': 'zomazo-demo-seed/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${remote}`);
        buffer = Buffer.from(await res.arrayBuffer());
      }
      if (buffer) {
        if (sharp) {
          buffer = await sharp(buffer).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 }).toBuffer();
        }
        if (!DRY) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buffer);
        }
        result = url;
        bump('image files written');
      }
    }
  } catch (err) {
    console.warn(`  image ${key}: ${err.message}; using ${result || 'no image'}`);
  }
  imageCache.set(key, result);
  return result;
};

/** Upsert one tagged document by its stable key; returns its _id. */
const upsert = async (Model, key, doc) => {
  bump(Model.collection.collectionName);
  if (DRY) return new mongoose.Types.ObjectId();
  const row = await Model.findOneAndUpdate(
    { _demoSeedKey: `${TAG}:${key}` },
    { $set: { ...doc, _demoSeed: TAG, _demoSeedKey: `${TAG}:${key}` } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, strict: false, strictQuery: false, runValidators: true },
  ).lean();
  return row._id;
};

const MODELS = [
  TaxiAppModule, AdminAppSetting, ServiceLocation, Zone, Vehicle, SetPrice, GoodsType,
  RentalPackageType, RentalVehicleType, ServiceStore, OnboardingScreen, AppLanguage, RideModule, Banner,
];

const remove = async () => {
  for (const Model of MODELS) {
    const filter = { _demoSeed: TAG };
    const n = DRY ? await Model.collection.countDocuments(filter) : (await Model.collection.deleteMany(filter)).deletedCount;
    if (n) counts[Model.collection.collectionName] = n;
  }
  const dir = path.join(UPLOAD_ROOT, SEED_DIR);
  if (!DRY && (await exists(dir))) {
    await fs.rm(dir, { recursive: true, force: true });
    counts['image folder removed'] = 1;
  }
};

const seed = async () => {
  // ---- service location + zone ------------------------------------------
  const indoreDefault = createDefaultAdminState().serviceLocations.find((s) => s.name === 'Indore');
  const { _id: _ignored, ...indoreFields } = indoreDefault;
  const locationId = await upsert(ServiceLocation, 'location:indore', {
    ...indoreFields,
    location: { type: 'Point', coordinates: [CENTER.lng, CENTER.lat] },
  });

  const popular = [
    ['Rajwada Palace', 'rajwada', 'Rajwada, Indore', 22.7186, 75.8553],
    ['Sarafa Bazaar', '', 'Sarafa, Indore', 22.7179, 75.8545],
    ['Khajrana Ganesh Temple', 'temple', 'Khajrana, Indore', 22.7317, 75.9089],
    ['Indore Airport', 'airport', 'Devi Ahilyabai Holkar Airport, Indore', 22.7217, 75.8011],
    ['Indore Junction', 'taxi3d', 'Indore Railway Station', 22.7172, 75.8687],
    ['Phoenix Citadel Mall', '', 'MR 10, Indore', 22.7553, 75.8930],
  ];
  const zoneId = await upsert(Zone, 'zone:indore', {
    name: 'Indore City',
    service_location_id: locationId,
    unit: 'km',
    active: true,
    status: 'active',
    boundary_mode: 'polygon',
    maximum_distance_for_regular_rides: 50,
    maximum_distance_for_outstation_rides: 600,
    geometry: { type: 'Polygon', coordinates: INDORE_POLYGON },
    popular_places: await Promise.all(popular.map(async ([name, img, address, lat, lng]) => ({
      name, image: img ? await image(img) : '', address, location: { lat, lng }, active: true,
    }))),
  });

  // ---- app modules (what the rider home renders) ------------------------
  const moduleDefs = [
    ['bike-taxi', 'Bike Taxi', 'taxi', 'normal', 'bike', 'Fast bike rides', 'Quick and economical bike rides for city travel.'],
    ['auto', 'Auto', 'taxi', 'normal', 'auto', 'Rickshaw rides', 'Auto rickshaw rides for local commuting.'],
    ['cab', 'Cab', 'taxi', 'normal', 'car', 'AC car rides', 'Comfortable Mini, Sedan and SUV rides across Indore.'],
    ['parcel', 'Parcel', 'delivery', 'normal', 'delivery', 'Send packages', 'Same-day parcel delivery by bike or mini truck.'],
    ['outstation', 'Outstation', 'taxi', 'outstation', 'outstation', 'Inter-city travel', 'One-way and round trips to Ujjain, Bhopal and beyond.'],
    ['pooling', 'Pooling', 'taxi', 'pooling', 'suv', 'Share and save', 'Share a seat on a fixed route and pay less.'],
    ['rental', 'Rental', 'taxi', 'rental', 'premium', 'Self-drive rentals', 'Rent a scooter or car by the hour or day.'],
  ];
  const modules = {};
  for (const [i, [key, name, transport, service, img, short, desc]] of moduleDefs.entries()) {
    const icon = await image(img);
    modules[key] = await upsert(TaxiAppModule, `module:${key}`, {
      name, transport_type: transport, service_type: service, icon_types_for: img,
      order_by: i + 1, short_description: short, description: desc,
      mobile_menu_icon: icon, mobile_menu_cover_image: icon || null, active: 1,
    });
  }

  // ---- vehicle types ----------------------------------------------------
  const vehicleDefs = [
    // key, name, transport, icon_types, capacity, img, modules, short, delivery_category
    ['bike', 'Bike', 'taxi', 'bike', 1, 'bike', ['bike-taxi'], 'Beat the traffic', ''],
    ['auto', 'Auto', 'taxi', 'auto', 3, 'auto', ['auto'], 'Everyday auto rickshaw', ''],
    ['mini', 'Mini', 'taxi', 'car', 4, 'hatchback', ['cab'], 'Affordable AC hatchback', ''],
    ['sedan', 'Sedan', 'taxi', 'car', 4, 'car', ['cab', 'outstation'], 'Comfortable AC sedan', ''],
    ['suv', 'SUV', 'taxi', 'suv', 6, 'suv', ['cab', 'outstation', 'pooling'], 'Room for six', ''],
    ['premium', 'Premium', 'taxi', 'premium', 4, 'premium', ['cab', 'outstation'], 'Top-rated drivers, newer cars', ''],
    ['bike-parcel', 'Bike Parcel', 'delivery', 'bike', 0, 'deliveryBike', ['parcel'], 'Up to 10 kg', '2wheeler'],
    ['mini-truck', 'Mini Truck', 'delivery', 'truck', 0, 'truck', ['parcel'], 'Up to 750 kg (Tata Ace class)', 'trucks'],
  ];
  const vehicles = {};
  for (const [key, name, transport, iconType, capacity, img, mods, short, cat] of vehicleDefs) {
    const url = await image(img);
    vehicles[key] = await upsert(Vehicle, `vehicle:${key}`, {
      name, short_description: short, description: `${name} rides in Indore.`,
      transport_type: transport, is_taxi: transport, dispatch_type: 'normal', icon_types: iconType,
      capacity, delivery_category: cat, image: url, icon: url, map_icon: url,
      status: 1, active: true, app_modules: mods.map((m) => modules[m]),
    });
  }

  // ---- fares (one row per vehicle, scoped to the Indore zone) -----------
  // base, base km, per km, per minute, waiting/min, outstation [base, base km, per km]
  const fares = {
    bike: [25, 2, 8, 1, 1, null],
    auto: [35, 2, 13, 1.5, 1.5, null],
    mini: [55, 2, 15, 1.5, 2, null],
    sedan: [70, 2, 17, 2, 2, [1200, 80, 11]],
    suv: [100, 2, 22, 2.5, 3, [1800, 80, 15]],
    premium: [120, 2, 25, 3, 3, [2200, 80, 18]],
    'bike-parcel': [40, 2, 10, 1, 1, null],
    'mini-truck': [250, 3, 30, 2, 3, null],
  };
  for (const [key, [base, baseKm, perKm, perMin, wait, out]] of Object.entries(fares)) {
    const delivery = key === 'bike-parcel' || key === 'mini-truck';
    await upsert(SetPrice, `price:indore:${key}`, {
      zone_id: zoneId, service_location_id: locationId, pricing_scope: 'ride',
      transport_type: delivery ? 'delivery' : 'taxi', vehicle_type: vehicles[key],
      payment_type: ['cash', 'online', 'wallet'],
      base_price: base, base_distance: baseKm, price_per_distance: perKm, time_price: perMin,
      waiting_charge: wait, free_waiting_before: 3, free_waiting_after: 3,
      service_tax: 5, admin_commision_type: 1, admin_commision: 10,
      admin_commission_type_from_driver: 1, admin_commission_from_driver: 10,
      enable_outstation_ride: Boolean(out), support_outstation: out ? 1 : 0,
      outstation_base_price: out?.[0] || 0, outstation_base_distance: out?.[1] || 0,
      outstation_price_per_distance: out?.[2] || 0, outstation_time_price: out ? 1 : 0,
      user_cancellation_fee_type: 'fixed', user_cancellation_fee: delivery ? 30 : 20,
      driver_cancellation_fee_type: 'fixed', driver_cancellation_fee: 10,
      free_cancellation_time: 2, fixed_cancellation_charge: delivery ? 30 : 20, max_cancellation_fee: 50,
      cancellation_policy_message: 'Free cancellation within 2 minutes of booking.',
      status: 'active', active: 1,
    });
  }

  // ---- outstation packages (GET /users/intercity-packages) ---------------
  const oneWay = await upsert(RentalPackageType, 'package-type:one-way', {
    transport_type: 'taxi', name: 'One Way', short_description: 'Drop at destination',
    description: 'Pay one way; no return fare.', status: 'active', active: true,
  });
  const roundTrip = await upsert(RentalPackageType, 'package-type:round-trip', {
    transport_type: 'taxi', name: 'Round Trip', short_description: 'Same-day return',
    description: 'Driver waits and brings you back.', status: 'active', active: true,
  });
  const destinations = [['Ujjain', 55], ['Bhopal', 195], ['Omkareshwar', 78], ['Mandu', 95], ['Dewas', 38]];
  const perKm = { sedan: 12, suv: 16, premium: 19 };
  for (const [dest, km] of destinations) {
    for (const [typeKey, typeId, mult] of [['one-way', oneWay, 1], ['round-trip', roundTrip, 2]]) {
      await upsert(SetPrice, `package:indore:${dest.toLowerCase()}:${typeKey}`, {
        zone_id: zoneId, service_location_id: locationId, pricing_scope: 'package', transport_type: 'taxi',
        package_type_id: typeId, package_destination: dest, package_availability: 'available',
        package_vehicle_prices: Object.entries(perKm).map(([v, rate]) => ({
          vehicle_type: vehicles[v], base_price: Math.round(km * mult * rate / 10) * 10,
          free_distance: km * mult, distance_price: rate, free_time: mult * 180, time_price: 2,
          admin_commision_type: 1, admin_commision: 10, service_tax: 5, cancellation_fee: 100, active: 1,
        })),
        status: 'active', active: 1,
      });
    }
  }

  // ---- self-drive rental --------------------------------------------------
  const storeId = await upsert(ServiceStore, 'store:vijay-nagar', {
    name: 'Zomazo Rentals - Vijay Nagar', zone_id: zoneId, service_location_id: locationId,
    address: 'Scheme 54, Vijay Nagar, Indore', latitude: 22.7533, longitude: 75.8937,
    location: { type: 'Point', coordinates: [75.8937, 22.7533] }, status: 'active', active: true,
  });
  const tiers = (hour, day, kmH, kmD, extraKm) => [
    { id: 'hourly', label: '1 hour', durationHours: 1, price: hour, includedKm: kmH, extraHourPrice: hour, extraKmPrice: extraKm, active: true },
    { id: 'half-day', label: '6 hours', durationHours: 6, price: Math.round(day * 0.6), includedKm: kmH * 5, extraHourPrice: hour, extraKmPrice: extraKm, active: true },
    { id: 'full-day', label: '24 hours', durationHours: 24, price: day, includedKm: kmD, extraHourPrice: hour, extraKmPrice: extraKm, active: true },
  ];
  const rentals = [
    ['scooter', 'Honda Activa', 'Scooter', 2, 0, 'bike', tiers(60, 450, 10, 120, 4), ['Helmet included']],
    ['hatchback', 'Maruti Swift', 'Car', 5, 2, 'hatchback', tiers(180, 1800, 15, 250, 9), ['AC', 'Bluetooth audio']],
    ['suv', 'Toyota Innova', 'Car', 7, 4, 'suv', tiers(320, 3200, 15, 250, 14), ['AC', 'Spacious boot']],
  ];
  for (const [key, name, category, capacity, luggage, img, pricing, amenities] of rentals) {
    const url = await image(img);
    await upsert(RentalVehicleType, `rental:${key}`, {
      transport_type: 'rental', name, short_description: `${name} self-drive`,
      description: `Self-drive ${name}, picked up from Vijay Nagar.`, vehicleCategory: category,
      image: url, coverImage: url, galleryImages: url ? [url] : [], map_icon: url,
      capacity, luggageCapacity: luggage, amenities, serviceStoreIds: [storeId], pricing,
      advancePayment: { enabled: true, paymentMode: 'percentage', amount: 20, label: 'Advance booking payment', notes: '' },
      status: 'active', active: true,
    });
  }

  // ---- parcel goods types -------------------------------------------------
  const goods = [
    ['documents', 'Documents', 'goodsDocuments'], ['electronics', 'Electronics', 'goodsElectronics'],
    ['clothes', 'Clothes', 'goodsClothes'], ['gifts', 'Gifts', 'goodsGifts'],
    ['grocery', 'Groceries', 'goodsGrocery'], ['others', 'Others', 'goodsOthers'],
  ];
  for (const [key, name, img] of goods) {
    await upsert(GoodsType, `goods:${key}`, {
      goods_type_name: name, name, goods_types_for: 'both', icon: await image(img), active: 1, status: 'active',
    });
  }

  // ---- banners, onboarding, languages, ride modules -----------------------
  const banners = [
    ['ride', 'Ride anywhere in Indore', 'bannerMobility', '/taxi/user/ride/select-location'],
    ['parcel', 'Send parcels across the city', 'landingParcel', '/taxi/user/parcel'],
    ['outstation', 'Outstation trips to Ujjain from Rs 660', 'bannerLinks', '/taxi/user/ride/select-location?rideType=outstation'],
  ];
  for (const [key, title, img, link] of banners) {
    const url = await image(img);
    if (!url) continue; // image is required on a banner
    await upsert(Banner, `banner:${key}`, { title, image: url, link_type: 'deep_link', deep_link: link, active: true });
  }

  const adminDefaults = createDefaultAdminState();
  for (const screen of adminDefaults.onboardingScreens) {
    await upsert(OnboardingScreen, `onboarding:${screen.audience}:${screen.order}`, screen);
  }
  // Languages and ride modules are master data the admin bootstrap would add
  // on an empty collection; only add ours where nothing exists.
  for (const lang of adminDefaults.languages) {
    if (DRY || !(await AppLanguage.exists({ code: lang.code, _demoSeed: { $ne: TAG } }).setOptions({ strictQuery: false }))) {
      await upsert(AppLanguage, `language:${lang.code}`, lang);
    }
  }
  for (const rm of adminDefaults.rideModules) {
    if (DRY || !(await RideModule.exists({ transport_type: rm.transport_type, _demoSeed: { $ne: TAG } }).setOptions({ strictQuery: false }))) {
      await upsert(RideModule, `ride-module:${rm.transport_type}`, rm);
    }
  }

  // ---- app settings singleton (scope: default) ---------------------------
  // Only created when missing: a live settings row belongs to the admin.
  const existing = DRY ? null : await AdminAppSetting.findOne({ scope: 'default' }).lean();
  if (!existing || existing._demoSeed === TAG) {
    const { app_modules: _legacyModules, onboarding_screens, ...settings } = createDefaultAppSettings();
    await upsert(AdminAppSetting, 'app-settings:default', {
      ...settings,
      onboarding_screens: await Promise.all(onboarding_screens.map(async (s, i) => ({
        ...s, image: await image(i === 0 ? 'landingRide' : 'taxi3d'),
      }))),
    });
  } else {
    console.log('  AdminAppSetting(default) already exists and was not made by this script; left as is.');
  }
};

const uri = config.mongodbUri;
if (!uri) {
  console.error('MONGO_URI / MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 });
console.log(`Taxi demo seed: ${REMOVE ? 'remove' : 'seed'}${DRY ? ' (dry run)' : ''} on db "${mongoose.connection.name}"`);
try {
  if (REMOVE) await remove(); else await seed();
  console.log(REMOVE ? 'Removed:' : 'Upserted:');
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(36)} ${n}`);
  if (!REMOVE) console.log(`Images: ${UPLOAD_ROOT}${path.sep}${SEED_DIR.replace('/', path.sep)} -> ${UPLOAD_BASE}/${SEED_DIR}/`);
} catch (err) {
  console.error('Taxi demo seed failed:', err);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
