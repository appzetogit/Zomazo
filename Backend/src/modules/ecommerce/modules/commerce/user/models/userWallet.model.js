import { linkedCustomerWallet } from '../../../../../../core/wallet/linkedWallet.js';

/**
 * The Shop's customer wallet -- now the customer's ONE wallet, shared with Food,
 * Rides, Quick and Services (core/wallet/linkedWallet.js).
 *
 * It was its own collection (ecom_user_wallets), keyed by the Shop customer id,
 * so money added anywhere else could not be spent in the Shop, and the reverse.
 * Shop ids are translated to the platform account on the way in; a customer
 * with no platform account keeps a wallet keyed by their Shop id. Balances left
 * in the old collection are moved over by scripts/moveShopWallets.mjs.
 */
export const UserWallet = linkedCustomerWallet('EcomUserWallet');
