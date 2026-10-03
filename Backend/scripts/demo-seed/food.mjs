#!/usr/bin/env node
/**
 * Demo seed for the FOOD delivery module (Indore).
 *
 *   node scripts/demo-seed/food.mjs            # create / refresh demo data
 *   node scripts/demo-seed/food.mjs --dry-run  # show what would be written, touch nothing
 *   node scripts/demo-seed/food.mjs --remove   # delete only what this script created
 *
 * Run from Backend/. Loads Backend/.env exactly like the server (dotenv; an
 * already-set MONGODB_URI / MONGO_URI wins) and writes through the real
 * Mongoose models so defaults, validators and hooks apply.
 *
 * Every document written is tagged `demoSeed: 'food'` plus a stable `demoSeedKey`
 * (set with a raw update, since the schemas are strict). Re-running upserts by
 * that key, and --remove deletes by the tag only.
 *
 * Images: resolved at run time from Wikipedia page summaries (Wikimedia Commons)
 * or TheMealDB, downloaded once into <UPLOAD_STORAGE_ROOT>/seed/food/ and stored
 * with the same URL builder the app's own uploads use. A failed download keeps
 * the remote URL instead.
 */
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(BACKEND_DIR, '.env') });

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const REMOVE = args.has('--remove');
const TAG = 'food';
const UA = 'zomazo-demo-seed/1.0 (+https://zomazo.in)';

const { default: mongoose } = await import('mongoose');
const { config } = await import('../../src/config/env.js');
const { buildPublicUrl } = await import('../../src/services/storage.service.js');
const { FoodZone } = await import('../../src/modules/food/admin/models/zone.model.js');
const { FoodCategory } = await import('../../src/modules/food/admin/models/category.model.js');
const { FoodItem } = await import('../../src/modules/food/admin/models/food.model.js');
const { FoodOffer } = await import('../../src/modules/food/admin/models/offer.model.js');
const { FoodRestaurant } = await import('../../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodRestaurantOutletTimings } = await import('../../src/modules/food/restaurant/models/outletTimings.model.js');

const UPLOAD_ROOT = path.resolve(BACKEND_DIR, config.uploadStorageRoot);
const SEED_DIR_REL = 'seed/food';
const SEED_DIR = path.join(UPLOAD_ROOT, SEED_DIR_REL);

// ---------------------------------------------------------------- data

/** Indore city, roughly the area inside the outer ring road. Points are {latitude, longitude}. */
const ZONE = {
    key: 'zone-indore',
    name: 'Indore',
    serviceLocation: 'Indore, Madhya Pradesh',
    coordinates: [
        { latitude: 22.8150, longitude: 75.7900 },
        { latitude: 22.8150, longitude: 75.9450 },
        { latitude: 22.7600, longitude: 75.9750 },
        { latitude: 22.6650, longitude: 75.9600 },
        { latitude: 22.6250, longitude: 75.8800 },
        { latitude: 22.6450, longitude: 75.7700 },
        { latitude: 22.7200, longitude: 75.7400 },
    ],
};

/**
 * Global categories ("What's on your mind"). img: ordered image sources;
 * 'w:' = Wikipedia article title, 'm:' = TheMealDB search term.
 */
const CATEGORIES = [
    { key: 'north-indian', name: 'North Indian', scope: 'Both', img: ['w:Butter_chicken'] },
    { key: 'south-indian', name: 'South Indian', scope: 'Veg', img: ['w:Masala_dosa'] },
    { key: 'chinese', name: 'Chinese', scope: 'Both', img: ['w:Manchurian_(dish)', 'm:Kung Pao Chicken'] },
    { key: 'pizza', name: 'Pizza', scope: 'Both', img: ['w:Pizza_Margherita', 'm:Pizza Express Margherita'] },
    { key: 'biryani', name: 'Biryani', scope: 'Both', img: ['w:Hyderabadi_biryani', 'm:Lamb Biryani'] },
    { key: 'desserts', name: 'Desserts', scope: 'Veg', img: ['w:Gulab_jamun'] },
    { key: 'chaat', name: 'Chaat', scope: 'Veg', img: ['w:Pani_puri'] },
    { key: 'breads', name: 'Breads', scope: 'Veg', img: ['w:Naan'] },
    { key: 'beverages', name: 'Beverages', scope: 'Veg', img: ['w:Masala_chai'] },
    { key: 'snacks', name: 'Snacks', scope: 'Both', img: ['w:Samosa'] },
    { key: 'pasta', name: 'Pasta', scope: 'Veg', img: ['w:Fettuccine_Alfredo'] },
    { key: 'sandwiches', name: 'Sandwiches', scope: 'Both', img: ['w:Club_sandwich', 'm:Cuban Sandwich'] },
    { key: 'cakes', name: 'Cakes', scope: 'Veg', img: ['w:Chocolate_cake', 'm:Chocolate Gateau'] },
];

const V = 'Veg';
const N = 'Non-Veg';
// item: [key, name, description, price, foodType, categoryKey, imageSources, recommended?]
const RESTAURANTS = [
    {
        key: 'punjabi-tadka', name: 'Punjabi Tadka Dhaba', area: 'Vijay Nagar', pincode: '452010',
        address: 'Scheme 54, AB Road, Vijay Nagar', lat: 22.7533, lng: 75.8937,
        cuisines: ['North Indian', 'Punjabi', 'Mughlai'], pureVeg: false, rating: 4.4, ratings: 1840,
        eta: '30-35 mins', costForTwo: 500, offer: '20% OFF up to ₹100', logo: ['w:Butter_chicken'], cover: ['w:Dal_makhani'],
        items: [
            ['butter-chicken', 'Butter Chicken', 'Tandoori chicken simmered in a rich tomato, butter and cream gravy.', 349, N, 'north-indian', ['w:Butter_chicken'], true],
            ['dal-makhani', 'Dal Makhani', 'Black lentils slow-cooked overnight with butter and cream.', 249, V, 'north-indian', ['w:Dal_makhani'], true],
            ['paneer-tikka', 'Paneer Tikka', 'Cottage cheese cubes marinated in spiced yogurt, chargrilled in the tandoor.', 279, V, 'north-indian', ['w:Paneer_tikka', 'm:Matar Paneer']],
            ['kadai-paneer', 'Kadai Paneer', 'Paneer tossed with capsicum, onion and freshly ground kadai masala.', 289, V, 'north-indian', ['w:Kadai_paneer', 'm:Matar Paneer']],
            ['palak-paneer', 'Palak Paneer', 'Paneer in a smooth, mildly spiced spinach gravy.', 269, V, 'north-indian', ['w:Palak_paneer', 'm:Matar Paneer']],
            ['chicken-tikka', 'Chicken Tikka', 'Boneless chicken marinated overnight and roasted in the tandoor.', 329, N, 'north-indian', ['w:Chicken_tikka', 'm:Tandoori chicken']],
            ['rogan-josh', 'Mutton Rogan Josh', 'Kashmiri style mutton curry with whole spices and red chilli.', 429, N, 'north-indian', ['w:Rogan_josh', 'm:Lamb Rogan josh']],
            ['chole-bhature', 'Chole Bhature', 'Spicy Punjabi chickpea curry with two fluffy bhature.', 179, V, 'north-indian', ['w:Chole_bhature']],
            ['butter-naan', 'Butter Naan', 'Soft tandoor-baked naan brushed with butter.', 55, V, 'breads', ['w:Naan']],
            ['tandoori-roti', 'Tandoori Roti', 'Whole wheat roti baked in the clay oven.', 30, V, 'breads', ['w:Tandoori_roti', 'w:Naan']],
            ['jeera-rice', 'Jeera Rice', 'Basmati rice tempered with cumin and ghee.', 149, V, 'north-indian', ['w:Jeera_rice']],
            ['sweet-lassi', 'Sweet Lassi', 'Thick chilled Punjabi yogurt drink.', 89, V, 'beverages', ['w:Lassi']],
        ],
    },
    {
        key: 'sagar-dosa', name: 'Sagar Dosa Corner', area: 'Palasia', pincode: '452001',
        address: '12, New Palasia, Near Geeta Bhawan', lat: 22.7246, lng: 75.8839,
        cuisines: ['South Indian'], pureVeg: true, rating: 4.5, ratings: 2310,
        eta: '20-25 mins', costForTwo: 250, offer: 'Flat ₹50 OFF above ₹299', logo: ['w:Idli'], cover: ['w:Masala_dosa'],
        items: [
            ['masala-dosa', 'Masala Dosa', 'Crisp rice and lentil crepe filled with spiced potato, with sambar and chutney.', 129, V, 'south-indian', ['w:Masala_dosa'], true],
            ['rava-dosa', 'Rava Dosa', 'Lacy semolina dosa with onion and green chilli.', 139, V, 'south-indian', ['w:Rava_dosa', 'w:Masala_dosa']],
            ['idli-sambar', 'Idli Sambar', 'Three steamed rice cakes with sambar and coconut chutney.', 89, V, 'south-indian', ['w:Idli'], true],
            ['medu-vada', 'Medu Vada', 'Crispy urad dal fritters served with sambar.', 99, V, 'south-indian', ['w:Medu_vada']],
            ['uttapam', 'Onion Uttapam', 'Thick rice pancake topped with onion, tomato and coriander.', 139, V, 'south-indian', ['w:Uttapam']],
            ['ven-pongal', 'Ven Pongal', 'Rice and moong dal cooked with ghee, pepper and cashews.', 119, V, 'south-indian', ['w:Pongal_(dish)']],
            ['upma', 'Rava Upma', 'Semolina cooked with vegetables, mustard and curry leaves.', 89, V, 'south-indian', ['w:Upma']],
            ['sambar-bowl', 'Sambar Bowl', 'Lentil and vegetable stew with tamarind and sambar masala.', 69, V, 'south-indian', ['w:Sambar_(dish)']],
            ['filter-coffee', 'Filter Coffee', 'Strong South Indian decoction coffee with frothy milk.', 49, V, 'beverages', ['w:Indian_filter_coffee', 'w:Coffee']],
            ['rasam-rice', 'Curd Rice', 'Cooling rice with curd, tempered with mustard and curry leaves.', 109, V, 'south-indian', ['w:Raita', 'w:Idli']],
        ],
    },
    {
        key: 'wok-express', name: 'Wok Express', area: 'Bhawarkua', pincode: '452014',
        address: 'Bhawarkua Square, Near Holkar College', lat: 22.6942, lng: 75.8676,
        cuisines: ['Chinese', 'Indo-Chinese'], pureVeg: false, rating: 4.1, ratings: 960,
        eta: '25-30 mins', costForTwo: 400, offer: '15% OFF on all orders', logo: ['w:Manchurian_(dish)'], cover: ['w:Chow_mein'],
        items: [
            ['veg-manchurian', 'Veg Manchurian', 'Vegetable dumplings in a tangy soy, garlic and chilli sauce.', 199, V, 'chinese', ['w:Manchurian_(dish)'], true],
            ['chilli-chicken', 'Chilli Chicken', 'Crispy chicken tossed with capsicum, onion and green chilli.', 269, N, 'chinese', ['w:Chilli_chicken'], true],
            ['hakka-noodles', 'Veg Hakka Noodles', 'Wok-tossed noodles with crunchy vegetables.', 179, V, 'chinese', ['w:Chow_mein']],
            ['chicken-fried-rice', 'Chicken Fried Rice', 'Egg and chicken fried rice with spring onion.', 229, N, 'chinese', ['m:Chicken Fried Rice', 'w:Fried_rice']],
            ['veg-fried-rice', 'Veg Fried Rice', 'Classic fried rice with vegetables and soy.', 169, V, 'chinese', ['w:Fried_rice']],
            ['spring-rolls', 'Veg Spring Rolls', 'Crisp rolls stuffed with cabbage, carrot and noodles.', 159, V, 'chinese', ['w:Spring_roll']],
            ['veg-momos', 'Veg Steamed Momos', 'Eight steamed dumplings with spicy red chutney.', 129, V, 'chinese', ['w:Momo_(food)']],
            ['hot-sour-soup', 'Hot and Sour Soup', 'Peppery soup with vegetables, vinegar and soy.', 129, V, 'chinese', ['w:Hot_and_sour_soup', 'm:Hot and Sour Soup']],
            ['kung-pao-chicken', 'Kung Pao Chicken', 'Stir-fried chicken with peanuts and dried red chilli.', 289, N, 'chinese', ['m:Kung Pao Chicken']],
            ['sweet-sour-chicken', 'Sweet and Sour Chicken', 'Crispy chicken in a sweet, tangy pineapple sauce.', 279, N, 'chinese', ['m:Sweet and Sour Chicken']],
        ],
    },
    {
        key: 'pizza-piazza', name: 'Pizza Piazza', area: 'Sapna Sangeeta', pincode: '452001',
        address: 'Sapna Sangeeta Road, Near Treasure Island', lat: 22.7036, lng: 75.8722,
        cuisines: ['Pizza', 'Italian', 'Fast Food'], pureVeg: false, rating: 4.2, ratings: 1320,
        eta: '30-35 mins', costForTwo: 600, offer: 'Buy 1 Get 1 on medium pizzas', logo: ['w:Pizza'], cover: ['w:Pizza_Margherita'],
        items: [
            ['margherita', 'Margherita Pizza', 'Tomato sauce, mozzarella and fresh basil on a thin crust.', 249, V, 'pizza', ['w:Pizza_Margherita', 'm:Pizza Express Margherita'], true],
            ['farmhouse', 'Farmhouse Pizza', 'Onion, capsicum, tomato, mushroom and mozzarella.', 349, V, 'pizza', ['w:Pizza']],
            ['chicken-pizza', 'Chicken Tikka Pizza', 'Tandoori chicken tikka, onion and mint mayo.', 399, N, 'pizza', ['m:Pizza', 'w:Pizza'], true],
            ['calzone', 'Veg Calzone', 'Folded pizza stuffed with cheese and vegetables.', 299, V, 'pizza', ['w:Calzone']],
            ['garlic-bread', 'Cheesy Garlic Bread', 'Toasted garlic butter bread topped with mozzarella.', 149, V, 'snacks', ['w:Garlic_bread']],
            ['alfredo', 'White Sauce Pasta', 'Penne in a creamy parmesan alfredo sauce.', 249, V, 'pasta', ['w:Fettuccine_Alfredo']],
            ['arrabbiata', 'Red Sauce Pasta', 'Penne in a spicy tomato and garlic sauce.', 229, V, 'pasta', ['w:Penne_alla_vodka', 'm:Mediterranean Pasta Salad']],
            ['nachos', 'Loaded Nachos', 'Corn chips with cheese sauce, salsa and jalapenos.', 189, V, 'snacks', ['w:Nachos']],
            ['fries', 'Peri Peri Fries', 'Crispy fries tossed in peri peri seasoning.', 129, V, 'snacks', ['w:French_fries']],
            ['brownie', 'Choco Brownie', 'Warm fudgy chocolate brownie.', 119, V, 'desserts', ['w:Chocolate_brownie', 'm:Chocolate Raspberry Brownies']],
        ],
    },
    {
        key: 'nawabi-biryani', name: 'Nawabi Biryani House', area: 'Khajrana', pincode: '452016',
        address: 'Khajrana Main Road, Near Ganesh Mandir', lat: 22.7367, lng: 75.9083,
        cuisines: ['Biryani', 'Mughlai', 'Hyderabadi'], pureVeg: false, rating: 4.3, ratings: 2050,
        eta: '35-40 mins', costForTwo: 550, offer: 'Free Gulab Jamun above ₹499', logo: ['w:Biryani'], cover: ['w:Hyderabadi_biryani'],
        items: [
            ['chicken-dum-biryani', 'Chicken Dum Biryani', 'Hyderabadi style dum-cooked basmati rice with marinated chicken.', 289, N, 'biryani', ['w:Hyderabadi_biryani', 'm:Lamb Biryani'], true],
            ['mutton-biryani', 'Mutton Biryani', 'Tender mutton layered with saffron rice and fried onions.', 389, N, 'biryani', ['m:Lamb Biryani', 'w:Biryani'], true],
            ['veg-biryani', 'Veg Dum Biryani', 'Seasonal vegetables and paneer dum-cooked with basmati rice.', 219, V, 'biryani', ['w:Biryani']],
            ['egg-biryani', 'Egg Biryani', 'Spiced biryani rice with boiled eggs.', 229, N, 'biryani', ['w:Biryani']],
            ['chicken-korma', 'Chicken Korma', 'Chicken in a mild cashew and yogurt gravy.', 319, N, 'north-indian', ['w:Korma']],
            ['seekh-kebab', 'Mutton Seekh Kebab', 'Minced mutton skewers grilled over charcoal.', 299, N, 'snacks', ['w:Seekh_kebab']],
            ['haleem', 'Haleem', 'Slow-cooked wheat, lentil and meat stew.', 249, N, 'north-indian', ['w:Haleem']],
            ['tandoori-chicken', 'Tandoori Chicken (Half)', 'Bone-in chicken marinated in yogurt and spices, roasted in the tandoor.', 279, N, 'north-indian', ['m:Tandoori chicken', 'w:Chicken_tikka']],
            ['raita', 'Boondi Raita', 'Chilled yogurt with boondi and roasted cumin.', 59, V, 'north-indian', ['w:Raita']],
            ['rumali-naan', 'Garlic Naan', 'Naan topped with garlic and coriander.', 65, V, 'breads', ['w:Naan']],
            ['kheer', 'Shahi Kheer', 'Rice pudding with cardamom, saffron and nuts.', 99, V, 'desserts', ['w:Kheer']],
        ],
    },
    {
        key: 'mithaas', name: 'Mithaas Sweets', area: 'Rajwada', pincode: '452002',
        address: 'Near Rajwada Palace, Jawahar Marg', lat: 22.7186, lng: 75.8553,
        cuisines: ['Desserts', 'Sweets', 'Mithai'], pureVeg: true, rating: 4.6, ratings: 3120,
        eta: '20-25 mins', costForTwo: 200, offer: '10% OFF on sweets', logo: ['w:Jalebi'], cover: ['w:Gulab_jamun'],
        items: [
            ['gulab-jamun', 'Gulab Jamun (2 pcs)', 'Soft khoya dumplings soaked in rose cardamom syrup.', 60, V, 'desserts', ['w:Gulab_jamun'], true],
            ['jalebi', 'Hot Jalebi (250 g)', 'Crisp saffron jalebi fried fresh to order.', 80, V, 'desserts', ['w:Jalebi'], true],
            ['rasgulla', 'Rasgulla (2 pcs)', 'Spongy chhena balls in light sugar syrup.', 60, V, 'desserts', ['w:Rasgulla']],
            ['rasmalai', 'Rasmalai (2 pcs)', 'Chhena discs in saffron and pistachio milk.', 90, V, 'desserts', ['w:Rasmalai']],
            ['kulfi', 'Matka Kulfi', 'Traditional malai kulfi set in a clay pot.', 70, V, 'desserts', ['w:Kulfi']],
            ['gajar-halwa', 'Gajar Ka Halwa', 'Slow-cooked carrot pudding with khoya and nuts.', 110, V, 'desserts', ['w:Gajar_ka_halwa']],
            ['malpua', 'Malpua with Rabdi', 'Sweet fried pancakes served with thick rabdi.', 120, V, 'desserts', ['w:Malpua']],
            ['shrikhand', 'Kesar Shrikhand', 'Hung curd sweetened with saffron and cardamom.', 90, V, 'desserts', ['w:Shrikhand']],
            ['falooda', 'Royal Falooda', 'Rose milk, vermicelli, basil seeds and kulfi.', 130, V, 'beverages', ['w:Falooda']],
            ['kesar-kheer', 'Kesar Kheer', 'Creamy rice kheer with saffron.', 80, V, 'desserts', ['w:Kheer']],
        ],
    },
    {
        key: 'sarafa-chaat', name: 'Sarafa Chaat Bhandar', area: 'Sarafa Bazaar', pincode: '452002',
        address: 'Sarafa Bazaar, Near Rajwada', lat: 22.7179, lng: 75.8530,
        cuisines: ['Street Food', 'Chaat', 'Snacks'], pureVeg: true, rating: 4.5, ratings: 2740,
        eta: '20-25 mins', costForTwo: 150, offer: 'Free delivery above ₹199', logo: ['w:Pani_puri'], cover: ['w:Pav_bhaji'],
        items: [
            ['indori-poha', 'Indori Poha Jalebi', 'Steamed poha with sev, onion and pomegranate, with a side of jalebi.', 60, V, 'snacks', ['w:Poha_(rice)'], true],
            ['pani-puri', 'Pani Puri (8 pcs)', 'Crisp puris with spiced potato and tangy mint water.', 50, V, 'chaat', ['w:Pani_puri'], true],
            ['bhel-puri', 'Bhel Puri', 'Puffed rice with sev, onion and sweet-tangy chutneys.', 60, V, 'chaat', ['w:Bhelpuri']],
            ['dahi-puri', 'Dahi Sev Puri', 'Puris with potato, sweet curd, chutneys and sev.', 70, V, 'chaat', ['w:Dahi_puri']],
            ['pav-bhaji', 'Pav Bhaji', 'Buttery mashed vegetable bhaji with two toasted pav.', 120, V, 'snacks', ['w:Pav_bhaji'], true],
            ['vada-pav', 'Vada Pav', 'Spiced potato fritter in a pav with garlic chutney.', 40, V, 'snacks', ['w:Vada_pav']],
            ['samosa', 'Samosa (2 pcs)', 'Crisp pastry filled with spiced potato and peas.', 40, V, 'snacks', ['w:Samosa']],
            ['kachori', 'Khasta Kachori', 'Flaky moong dal kachori with tamarind chutney.', 40, V, 'snacks', ['w:Kachori']],
            ['aloo-tikki', 'Aloo Tikki Chaat', 'Potato patties topped with curd, chutneys and sev.', 70, V, 'chaat', ['w:Aloo_tikki']],
            ['dahi-vada', 'Dahi Vada', 'Soft lentil dumplings in sweet curd with chutneys.', 70, V, 'chaat', ['w:Dahi_vada']],
            ['masala-chai', 'Masala Chai', 'Kulhad chai brewed with ginger and cardamom.', 25, V, 'beverages', ['w:Masala_chai']],
        ],
    },
    {
        key: 'brew-bean', name: 'The Brew & Bean Cafe', area: '56 Dukan', pincode: '452001',
        address: 'Chhappan Dukan, New Palasia', lat: 22.7240, lng: 75.8835,
        cuisines: ['Cafe', 'Continental', 'Beverages'], pureVeg: false, rating: 4.3, ratings: 870,
        eta: '25-30 mins', costForTwo: 450, offer: '20% OFF on beverages', logo: ['w:Cappuccino'], cover: ['w:Coffee'],
        items: [
            ['cappuccino', 'Cappuccino', 'Double espresso with steamed milk and thick foam.', 149, V, 'beverages', ['w:Cappuccino'], true],
            ['cold-brew', 'Cold Brew Coffee', 'Coffee steeped cold for 16 hours, served over ice.', 179, V, 'beverages', ['w:Cold_brew_coffee']],
            ['affogato', 'Affogato', 'Vanilla ice cream drowned in a shot of hot espresso.', 169, V, 'beverages', ['w:Iced_coffee']],
            ['club-sandwich', 'Chicken Club Sandwich', 'Triple-decker with grilled chicken, egg, lettuce and mayo.', 249, N, 'sandwiches', ['w:Club_sandwich'], true],
            ['veg-sandwich', 'Grilled Veg Sandwich', 'Grilled bread with vegetables, cheese and green chutney.', 159, V, 'sandwiches', ['m:Grilled Mac and Cheese Sandwich', 'w:Club_sandwich']],
            ['burger', 'Classic Chicken Burger', 'Crispy chicken patty, lettuce and house sauce in a toasted bun.', 199, N, 'sandwiches', ['w:Hamburger', 'm:15-minute chicken & halloumi burgers']],
            ['waffle', 'Belgian Waffle', 'Crisp waffle with maple syrup and fresh strawberries.', 189, V, 'cakes', ['w:Waffle']],
            ['pancakes', 'Pancake Stack', 'Fluffy pancakes with honey and butter.', 179, V, 'cakes', ['m:Pancakes']],
            ['cheesecake', 'Blueberry Cheesecake', 'Baked New York cheesecake with berry compote.', 219, V, 'cakes', ['w:Cheesecake', 'm:New York cheesecake']],
            ['choco-cake', 'Chocolate Truffle Pastry', 'Layered chocolate sponge with ganache.', 139, V, 'cakes', ['w:Chocolate_cake', 'm:Chocolate Gateau']],
            ['tiramisu', 'Tiramisu', 'Coffee-soaked sponge layered with mascarpone cream.', 229, V, 'cakes', ['w:Tiramisu']],
            ['cafe-fries', 'Salted Fries', 'Golden fries with ketchup.', 119, V, 'snacks', ['w:French_fries']],
        ],
    },
    {
        key: 'annapurna-thali', name: 'Annapurna Veg Bhojanalaya', area: 'Annapurna Road', pincode: '452009',
        address: 'Annapurna Main Road, Near Annapurna Mandir', lat: 22.6984, lng: 75.8378,
        cuisines: ['North Indian', 'Thali', 'Home Style'], pureVeg: true, rating: 4.2, ratings: 640,
        eta: '25-30 mins', costForTwo: 300, offer: 'Flat ₹40 OFF above ₹249', logo: ['w:Khichdi'], cover: ['w:Shahi_paneer'],
        items: [
            ['shahi-paneer', 'Shahi Paneer', 'Paneer in a royal cashew, cream and tomato gravy.', 239, V, 'north-indian', ['w:Shahi_paneer', 'm:Matar Paneer'], true],
            ['matar-paneer', 'Matar Paneer', 'Paneer and green peas in a home-style onion tomato gravy.', 219, V, 'north-indian', ['m:Matar Paneer']],
            ['dal-khichdi', 'Dal Khichdi', 'Comforting moong dal khichdi with ghee and papad.', 149, V, 'north-indian', ['w:Khichdi'], true],
            ['dal-tadka', 'Dal Tadka', 'Yellow dal tempered with ghee, cumin and garlic.', 159, V, 'north-indian', ['w:Dal_makhani']],
            ['chole', 'Amritsari Chole', 'Spiced chickpeas slow-cooked with tea leaves and whole spices.', 179, V, 'north-indian', ['w:Chole_bhature']],
            ['plain-naan', 'Plain Naan', 'Tandoor-baked plain naan.', 40, V, 'breads', ['w:Naan']],
            ['steamed-rice', 'Jeera Pulao', 'Basmati pulao with cumin and peas.', 129, V, 'north-indian', ['w:Jeera_rice']],
            ['papdi-chaat', 'Papdi Chaat', 'Crisp papdi with potato, curd and chutneys.', 89, V, 'chaat', ['w:Dahi_puri']],
            ['chaas', 'Masala Chaas', 'Spiced buttermilk with roasted cumin and mint.', 39, V, 'beverages', ['w:Lassi']],
            ['gulab-jamun-thali', 'Gulab Jamun', 'Two warm gulab jamuns.', 50, V, 'desserts', ['w:Gulab_jamun']],
        ],
    },
];

const OFFERS = [
    { key: 'offer-welcome', couponCode: 'FOODDEMO50', discountType: 'percentage', discountValue: 50, maxDiscount: 100, minOrderValue: 199, customerScope: 'first-time', isFirstOrderOnly: true },
    { key: 'offer-flat75', couponCode: 'FOODDEMO75', discountType: 'flat-price', discountValue: 75, maxDiscount: null, minOrderValue: 399, customerScope: 'all', isFirstOrderOnly: false },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OPEN = '00:00';
const CLOSE = '23:59';

// ---------------------------------------------------------------- helpers

const counts = {};
const bump = (k, by = 1) => { counts[k] = (counts[k] || 0) + by; };
const log = (...a) => console.log('[demo-seed:food]', ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** Remote image URL for one source spec, or null. */
async function resolveSource(spec) {
    const [kind, ...rest] = spec.split(':');
    const term = rest.join(':');
    try {
        if (kind === 'w') {
            const j = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`);
            let url = j?.thumbnail?.source || j?.originalimage?.source || '';
            if (!url) return null;
            url = url.split('?')[0];
            // Thumbnails come at 330px; 500px is a standard Wikimedia size and plenty for a card.
            url = url.replace(/\/\d+px-([^/]+)$/, '/500px-$1');
            if (/\.(svg|png)$/i.test(url) && /logo/i.test(url)) return null;
            return url;
        }
        if (kind === 'm') {
            const j = await fetchJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(term)}`);
            const meals = j?.meals || [];
            const exact = meals.find((m) => m.strMeal.toLowerCase() === term.toLowerCase());
            return (exact || meals[0])?.strMealThumb || null;
        }
    } catch (err) {
        log(`  source ${spec} failed: ${err.message}`);
    }
    return null;
}

async function fileExists(p) {
    try { const s = await fs.stat(p); return s.size > 0; } catch { return false; }
}

async function download(url, dest) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) throw new Error(`not an image (${type})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('image too small');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
}

const imageCache = new Map();
/**
 * Stored URL for an image, by stable file name. A file already on disk is reused
 * without any network call, so re-runs are cheap.
 */
async function imageFor(name, sources) {
    if (imageCache.has(name)) return imageCache.get(name);
    const existing = await findLocalFile(name);
    if (existing) {
        const url = buildPublicUrl(`${SEED_DIR_REL}/${path.basename(existing)}`);
        imageCache.set(name, url);
        bump('images reused');
        return url;
    }
    let result = '';
    for (const spec of sources) {
        const remote = await resolveSource(spec);
        await sleep(150);
        if (!remote) continue;
        if (DRY_RUN) { result = remote; break; }
        const ext = (path.extname(new URL(remote).pathname).toLowerCase().match(/^\.(jpe?g|png|webp)$/) || ['.jpg'])[0];
        const file = path.join(SEED_DIR, `${name}${ext}`);
        try {
            await download(remote, file);
            result = buildPublicUrl(`${SEED_DIR_REL}/${name}${ext}`);
            bump('images downloaded');
        } catch (err) {
            log(`  download ${name} failed (${err.message}); keeping remote URL`);
            result = remote;
            bump('images remote');
        }
        break;
    }
    if (!result) { log(`  no image found for ${name}`); bump('images missing'); }
    imageCache.set(name, result);
    return result;
}

let localFiles = null;
async function findLocalFile(name) {
    if (!localFiles) {
        try { localFiles = await fs.readdir(SEED_DIR); } catch { localFiles = []; }
    }
    const hit = localFiles.find((f) => path.parse(f).name === name);
    return hit && (await fileExists(path.join(SEED_DIR, hit))) ? hit : null;
}

/**
 * Create or update one tagged document through its model, then stamp the tag
 * with a raw update (strict schemas would drop it). Returns the _id.
 */
async function upsert(Model, key, data, label) {
    const raw = Model.collection;
    const found = await raw.findOne({ demoSeed: TAG, demoSeedKey: key }, { projection: { _id: 1 } });
    if (DRY_RUN) {
        bump(`${label} ${found ? 'would update' : 'would create'}`);
        return found?._id || new mongoose.Types.ObjectId();
    }
    let doc = found ? await Model.findById(found._id) : null;
    if (doc) {
        doc.set(data);
        await doc.save();
        bump(`${label} updated`);
    } else {
        doc = await Model.create(data);
        bump(`${label} created`);
    }
    await raw.updateOne({ _id: doc._id }, { $set: { demoSeed: TAG, demoSeedKey: key } });
    return doc._id;
}

// ---------------------------------------------------------------- seed

async function seed() {
    const zoneId = await upsert(FoodZone, ZONE.key, {
        name: ZONE.name,
        zoneName: ZONE.name,
        country: 'India',
        serviceLocation: ZONE.serviceLocation,
        unit: 'kilometer',
        boundary_mode: 'polygon',
        coordinates: ZONE.coordinates,
        isActive: true,
    }, 'zones');

    const categoryIds = new Map();
    for (const [i, c] of CATEGORIES.entries()) {
        const image = await imageFor(`category-${c.key}`, c.img);
        const id = await upsert(FoodCategory, `category-${c.key}`, {
            name: c.name,
            image,
            type: 'food',
            foodTypeScope: c.scope,
            approvalStatus: 'approved',
            isApproved: true,
            approvedAt: new Date(),
            isActive: true,
            sortOrder: i + 1,
            // Global (no restaurantId, no zoneId) so every restaurant can file dishes under it.
        }, 'categories');
        categoryIds.set(c.key, id);
    }

    for (const [ri, r] of RESTAURANTS.entries()) {
        log(`restaurant ${r.name}`);
        const logo = await imageFor(`restaurant-${r.key}-logo`, r.logo);
        const cover = await imageFor(`restaurant-${r.key}-cover`, r.cover);
        const phone = `555000${String(1001 + ri).slice(-4)}`; // 5xxxxxxxxx is never a real Indian mobile.
        const items = [];
        for (const it of r.items) {
            const [key, name, description, price, foodType, catKey, sources, recommended] = it;
            items.push({ key, name, description, price, foodType, catKey, recommended: !!recommended, image: await imageFor(`item-${r.key}-${key}`, sources) });
        }
        const featured = items.find((x) => x.recommended) || items[0];
        const minutes = parseInt(r.eta, 10);

        const restaurantId = await upsert(FoodRestaurant, `restaurant-${r.key}`, {
            restaurantName: r.name,
            ownerName: `${r.name} Owner`,
            ownerEmail: `demo+${r.key}@zomazo.in`,
            ownerPhone: phone,
            primaryContactNumber: phone,
            pureVegRestaurant: r.pureVeg,
            addressLine1: r.address,
            area: r.area,
            city: 'Indore',
            state: 'Madhya Pradesh',
            pincode: r.pincode,
            cuisines: r.cuisines,
            openingTime: OPEN,
            closingTime: CLOSE,
            openDays: DAYS,
            isAcceptingOrders: true,
            profileImage: logo,
            coverImage: cover,
            coverImages: [cover].filter(Boolean),
            menuImages: [featured.image].filter(Boolean),
            location: {
                type: 'Point',
                coordinates: [r.lng, r.lat],
                latitude: r.lat,
                longitude: r.lng,
                formattedAddress: `${r.address}, ${r.area}, Indore, Madhya Pradesh ${r.pincode}`,
                address: r.address,
                addressLine1: r.address,
                area: r.area,
                city: 'Indore',
                state: 'Madhya Pradesh',
                pincode: r.pincode,
            },
            zoneId,
            estimatedDeliveryTime: r.eta,
            estimatedDeliveryTimeMinutes: minutes,
            featuredDish: featured.name,
            featuredPrice: featured.price,
            offer: r.offer,
            rating: r.rating,
            totalRatings: r.ratings,
            status: 'approved',
            approvedAt: new Date(),
        }, 'restaurants');
        if (!DRY_RUN) {
            // Read by some listings but not declared on the schema.
            await FoodRestaurant.collection.updateOne({ _id: restaurantId }, { $set: { costForTwo: r.costForTwo } });
        }

        await upsert(FoodRestaurantOutletTimings, `timings-${r.key}`, {
            restaurantId,
            timings: DAYS.map((day) => ({ day, isOpen: true, openingTime: OPEN, closingTime: CLOSE })),
        }, 'outlet timings');

        for (const it of items) {
            const cat = CATEGORIES.find((c) => c.key === it.catKey);
            await upsert(FoodItem, `item-${r.key}-${it.key}`, {
                restaurantId,
                categoryId: categoryIds.get(it.catKey),
                categoryName: cat.name,
                name: it.name,
                description: it.description,
                price: it.price,
                basePrice: it.price,
                image: it.image,
                foodType: it.foodType,
                isActive: true,
                isAvailable: true,
                isRecommended: it.recommended,
                preparationTime: '15-20 mins',
                approvalStatus: 'approved',
                approvedAt: new Date(),
            }, 'menu items');
        }
    }

    const now = new Date();
    const end = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
    for (const o of OFFERS) {
        await upsert(FoodOffer, o.key, {
            couponCode: o.couponCode,
            discountType: o.discountType,
            discountValue: o.discountValue,
            maxDiscount: o.maxDiscount,
            minOrderValue: o.minOrderValue,
            customerScope: o.customerScope,
            isFirstOrderOnly: o.isFirstOrderOnly,
            restaurantScope: 'all',
            startDate: new Date(now.getTime() - 60 * 1000),
            endDate: end,
            status: 'active',
            showInCart: true,
            createdByRole: 'ADMIN',
        }, 'offers');
    }
}

async function remove() {
    const models = [
        ['menu items', FoodItem],
        ['outlet timings', FoodRestaurantOutletTimings],
        ['offers', FoodOffer],
        ['restaurants', FoodRestaurant],
        ['categories', FoodCategory],
        ['zones', FoodZone],
    ];
    for (const [label, Model] of models) {
        const filter = { demoSeed: TAG };
        if (DRY_RUN) {
            bump(`${label} would delete`, await Model.collection.countDocuments(filter));
        } else {
            const r = await Model.collection.deleteMany(filter);
            bump(`${label} deleted`, r.deletedCount);
        }
    }
    // Only this script writes into seed/food.
    let files = [];
    try { files = await fs.readdir(SEED_DIR); } catch { /* nothing downloaded */ }
    if (DRY_RUN) {
        bump('image files would delete', files.length);
    } else if (files.length) {
        await fs.rm(SEED_DIR, { recursive: true, force: true });
        bump('image files deleted', files.length);
    }
}

// ---------------------------------------------------------------- main

const uri = config.mongodbUri;
if (!uri) {
    console.error('[demo-seed:food] MONGODB_URI / MONGO_URI is not set (looked in Backend/.env).');
    process.exit(1);
}

try {
    const dbName = process.env.MONGODB_DB_NAME || undefined;
    await mongoose.connect(uri, { maxPoolSize: 2, ...(dbName ? { dbName } : {}) });
    log(`${REMOVE ? 'removing' : 'seeding'}${DRY_RUN ? ' (dry run)' : ''} on db "${mongoose.connection.name}"; images -> ${SEED_DIR}`);
    if (REMOVE) await remove();
    else await seed();
    log('summary:');
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
    if (!REMOVE && !DRY_RUN) {
        log('note: public food endpoints cache responses for up to 10 minutes.');
    }
} catch (err) {
    console.error('[demo-seed:food] failed:', err?.stack || err);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect().catch(() => {});
}
