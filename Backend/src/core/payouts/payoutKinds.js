import mongoose from 'mongoose';

/*
 * The per-service glue for bank payouts. Each withdrawal collection differs in
 * three ways only, and that is all a kind describes:
 *
 *   - what "approved" is called and where the manual bank reference lives;
 *   - who is paid, and where their bank account / UPI id is kept on file;
 *   - what approving took from the payee, so a failed transfer can give exactly
 *     that back (`refund`, run inside the same transaction that reopens the
 *     request -- see failPayout in payout.service.js).
 *
 * Restaurant, Quick store and Shop seller balances are DERIVED from their
 * withdrawal rows (earned minus approved and pending), so moving the request
 * back to pending is itself the refund. Riders, taxi drivers and Services
 * partners hold a stored balance that approval debited, so it is credited back.
 */

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const clean = (v) => String(v ?? '').trim();

/** Bank account first (that is what a payee fills in to be paid); UPI if that is all there is. */
const accountFrom = ({ holder, number, ifsc, vpa }) => {
    if (clean(number) && clean(ifsc)) {
        return { holder: clean(holder) || 'Account holder', number: clean(number), ifsc: clean(ifsc).toUpperCase(), vpa: null };
    }
    if (clean(vpa)) return { holder: clean(holder), number: null, ifsc: null, vpa: clean(vpa) };
    return null;
};

const riderPayee = (payeeType, partner) => (partner ? {
    payeeType,
    payeeId: partner._id,
    name: partner.name,
    email: partner.email,
    phone: partner.phone,
    contactType: 'employee',
    changedAt: partner.bankDetailsChangedAt || null,
    account: accountFrom({
        holder: partner.bankAccountHolderName || partner.name,
        number: partner.bankAccountNumber,
        ifsc: partner.bankIfscCode,
        vpa: partner.upiId,
    }),
} : null);

const businessPayee = (payeeType, doc, name) => (doc ? {
    payeeType,
    payeeId: doc._id,
    name,
    email: doc.ownerEmail,
    phone: doc.ownerPhone,
    contactType: 'vendor',
    changedAt: null,
    account: accountFrom({ holder: doc.accountHolderName || name, number: doc.accountNumber, ifsc: doc.ifscCode, vpa: doc.upiId }),
} : null);

/** Credit a stored rider wallet back; the request is pending again, so its amount is held again too. */
const refundRiderWallet = (Wallet, { relock }) => async ({ record, amount, session }) => {
    await Wallet.updateOne(
        { deliveryPartnerId: record.deliveryPartnerId },
        { $inc: { balance: amount, totalSettled: -amount, ...(relock ? { lockedAmount: amount } : {}) } },
        { session },
    );
};

const PROFILE_FIELDS = 'name email phone bankAccountHolderName bankAccountNumber bankIfscCode upiId bankDetailsChangedAt';

export const PAYOUT_KINDS = {
    food_restaurant: {
        label: 'Food restaurant withdrawal',
        model: async () => (await import('../../modules/food/restaurant/models/foodRestaurantWithdrawal.model.js')).FoodRestaurantWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { FoodRestaurant } = await import('../../modules/food/restaurant/models/restaurant.model.js');
            const r = await FoodRestaurant.findById(record.restaurantId).lean();
            return businessPayee('food_restaurant', r, r?.restaurantName);
        },
        refund: async () => {},
    },
    food_rider: {
        label: 'Food rider withdrawal',
        model: async () => (await import('../../modules/food/delivery/models/foodDeliveryWithdrawal.model.js')).FoodDeliveryWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
            return riderPayee('food_rider', await FoodDeliveryPartner.findById(record.deliveryPartnerId).select(PROFILE_FIELDS).lean());
        },
        // Food approval debits balance and adds totalSettled; it never locked.
        refund: async (args) => {
            const { FoodDeliveryWallet } = await import('../../modules/food/delivery/models/deliveryWallet.model.js');
            return refundRiderWallet(FoodDeliveryWallet, { relock: false })(args);
        },
    },
    qc_store: {
        label: 'Quick store withdrawal',
        model: async () => (await import('../../modules/quickCommerce/modules/food/restaurant/models/foodRestaurantWithdrawal.model.js')).FoodRestaurantWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { FoodRestaurant } = await import('../../modules/quickCommerce/modules/food/restaurant/models/restaurant.model.js');
            const r = await FoodRestaurant.findById(record.restaurantId).lean();
            return businessPayee('qc_store', r, r?.restaurantName);
        },
        refund: async () => {},
    },
    qc_rider: {
        label: 'Quick rider withdrawal',
        model: async () => (await import('../../modules/quickCommerce/modules/food/delivery/models/foodDeliveryWithdrawal.model.js')).FoodDeliveryWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { FoodDeliveryPartner } = await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
            return riderPayee('qc_rider', await FoodDeliveryPartner.findById(record.deliveryPartnerId).select(PROFILE_FIELDS).lean());
        },
        refund: async (args) => {
            const { FoodDeliveryWallet } = await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryWallet.model.js');
            return refundRiderWallet(FoodDeliveryWallet, { relock: true })(args);
        },
    },
    shop_seller: {
        label: 'Shop seller withdrawal',
        model: async () => (await import('../../modules/ecommerce/modules/commerce/seller/models/sellerWithdrawal.model.js')).SellerWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { Seller } = await import('../../modules/ecommerce/modules/commerce/seller/models/seller.model.js');
            const s = await Seller.findById(record.sellerId).lean();
            return businessPayee('shop_seller', s, s?.sellerName || s?.storeName);
        },
        refund: async () => {},
    },
    shop_rider: {
        label: 'Shop rider withdrawal',
        model: async () => (await import('../../modules/ecommerce/modules/commerce/delivery/models/deliveryWithdrawal.model.js')).DeliveryWithdrawal,
        approvedStatus: 'approved',
        refField: 'transactionId',
        payee: async (record) => {
            const { DeliveryPartner } = await import('../../modules/ecommerce/modules/commerce/delivery/models/deliveryPartner.model.js');
            return riderPayee('shop_rider', await DeliveryPartner.findById(record.deliveryPartnerId).select(PROFILE_FIELDS).lean());
        },
        refund: async (args) => {
            const { DeliveryWallet } = await import('../../modules/ecommerce/modules/commerce/delivery/models/deliveryWallet.model.js');
            return refundRiderWallet(DeliveryWallet, { relock: true })(args);
        },
    },
    taxi_driver: {
        label: 'Taxi driver withdrawal',
        model: async () => (await import('../../modules/taxi/admin/models/WithdrawalRequest.js')).WithdrawalRequest,
        approvedStatus: 'completed',
        refField: 'transactionId',
        /*
         * A driver record has no bank fields. The same person's rider profile
         * (food, else Quick) does, with its 24-hour change stamp, and is what
         * the rider app edits -- so that is the account on file.
         */
        payee: async (record) => {
            const { resolveRiderIdentity } = await import('../finance/riderFinance.service.js');
            const identity = await resolveRiderIdentity(record.driver_id);
            if (identity.foodPartnerId) {
                const { FoodDeliveryPartner } = await import('../../modules/food/delivery/models/deliveryPartner.model.js');
                const p = await FoodDeliveryPartner.findById(identity.foodPartnerId).select(PROFILE_FIELDS).lean();
                if (p) return riderPayee('food_rider', p);
            }
            if (identity.qcPartnerId) {
                const { FoodDeliveryPartner } = await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js');
                const p = await FoodDeliveryPartner.findById(identity.qcPartnerId).select(PROFILE_FIELDS).lean();
                if (p) return riderPayee('qc_rider', p);
            }
            return null;
        },
        refund: async ({ record, amount, session }) => {
            const { applyDriverWalletAdjustment } = await import('../../modules/taxi/driver/services/walletService.js');
            await applyDriverWalletAdjustment({
                driverId: record.driver_id,
                amount,
                type: 'adjustment',
                description: 'Bank payout failed - withdrawal returned to wallet',
                metadata: { withdrawalRequestId: String(record._id), payoutId: record.payout?.payoutId || null },
                session,
            });
        },
    },
    sp_withdrawal: {
        label: 'Services withdrawal',
        model: async () => (await import('../../modules/serviceProvider/models/Withdrawal.js')).default,
        approvedStatus: 'approved',
        refField: 'transactionReference',
        // Services deducts TDS and the platform fee at approval; the partner receives the net.
        amountOf: (record) => Number(record.netAmount) > 0 ? Number(record.netAmount) : Number(record.amount || 0),
        /*
         * Vendors and workers keep no bank fields on their profile: the account
         * is the one given on the withdrawal request. The 24-hour hold then
         * comes from the fingerprint check in payout.service.js -- a request to
         * a different account than the last payout waits a day.
         */
        payee: async (record) => {
            const isWorker = !!record.workerId;
            const Model = (await import(`../../modules/serviceProvider/models/${isWorker ? 'Worker' : 'Vendor'}.js`)).default;
            const p = await Model.findById(isWorker ? record.workerId : record.vendorId).lean();
            if (!p) return null;
            const b = record.bankDetails || {};
            return {
                payeeType: isWorker ? 'sp_worker' : 'sp_vendor',
                payeeId: p._id,
                name: p.businessName || p.name,
                email: p.email,
                phone: p.phone,
                contactType: isWorker ? 'employee' : 'vendor',
                changedAt: null,
                account: accountFrom({ holder: b.accountHolderName || p.name, number: b.accountNumber, ifsc: b.ifscCode, vpa: b.upiId }),
            };
        },
        // Approval took the GROSS amount from the wallet; all of it goes back.
        refund: async ({ record, session }) => {
            const isWorker = !!record.workerId;
            const Model = (await import(`../../modules/serviceProvider/models/${isWorker ? 'Worker' : 'Vendor'}.js`)).default;
            const gross = Number(record.amount || 0);
            const field = isWorker ? 'wallet.balance' : 'wallet.earnings';
            await Model.updateOne(
                { _id: oid(isWorker ? record.workerId : record.vendorId) },
                { $inc: { [field]: gross, 'wallet.totalWithdrawn': -gross } },
                { session },
            );
            // The approval's ledger rows said "completed"; the money never arrived.
            const Transaction = (await import('../../modules/serviceProvider/models/Transaction.js')).default;
            await Transaction.updateMany(
                { 'metadata.withdrawalId': oid(record._id), status: 'completed' },
                { $set: { status: 'failed' } },
                { session },
            );
        },
    },
};

export const getPayoutKind = (key) => {
    const kind = PAYOUT_KINDS[key];
    if (!kind) throw Object.assign(new Error(`Unknown payout kind: ${key}`), { statusCode: 400 });
    return kind;
};
