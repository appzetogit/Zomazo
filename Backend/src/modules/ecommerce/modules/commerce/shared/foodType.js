/**
 * The veg / non-veg mark on a product.
 *
 * Optional: it is printed on packaged food, and means nothing on a phone charger,
 * so anything that is not clearly one or the other is stored as null and the apps
 * show no dot. Egg products carry the non-veg mark.
 */
export const FOOD_TYPES = ['Veg', 'Non-Veg'];

export const normalizeFoodType = (value) => {
    const t = String(value ?? '').trim().toLowerCase();
    if (t === 'veg') return 'Veg';
    if (t === 'non-veg' || t === 'nonveg' || t === 'egg') return 'Non-Veg';
    return null;
};
