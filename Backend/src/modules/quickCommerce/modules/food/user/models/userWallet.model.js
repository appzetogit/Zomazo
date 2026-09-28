import { clearWalletOwnerCache, linkedCustomerWallet, walletOwner } from '../../../../../../core/wallet/linkedWallet.js';

/**
 * Quick & Medical's customer wallet -- the customer's ONE wallet.
 *
 * It was its own collection (qc_user_wallets), keyed by the Quick customer id,
 * so money added in Food or Rides could not be spent on groceries or medicine,
 * and the reverse. It is now the shared wallet (food_user_wallets), with Quick
 * customer ids translated to the platform account on the way in -- the same
 * model the Shop uses (core/wallet/linkedWallet.js), which is where that
 * translation now lives. A Quick customer with no platform account keeps a
 * wallet keyed by their Quick id, in the same collection. qc_user_wallets is no
 * longer read: it held no wallets on either live site when this changed
 * (24 Sep 2026).
 */
export const FoodUserWallet = linkedCustomerWallet('QCUserWallet');

export const __testables = { walletOwner, clearCache: clearWalletOwnerCache };
