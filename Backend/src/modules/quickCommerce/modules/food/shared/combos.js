import { FoodItem } from '../admin/models/food.model.js';
import { createComboService } from '../../../../food/shared/combo.service.js';

/**
 * A quick-commerce seller's combos: food's rules over this store's own
 * products. The parts total is shown as the MRP a grocery listing strikes
 * through, and the combo tracks no stock of its own -- an order reserves its
 * components' stock (orders/services/inventory.service.js).
 */
export const qcCombo = createComboService(FoodItem, {
    decorate: (_fields, built) => ({ mrp: built.componentTotal, otherPrice: built.componentTotal, stockQty: null }),
});
