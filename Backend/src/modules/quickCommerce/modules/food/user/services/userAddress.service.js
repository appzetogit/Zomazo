import mongoose from 'mongoose';
import { FoodUser } from '../../../../core/users/user.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { normalizeDeliveryAddress } from '../../shared/geo.utils.js';

const toGeoPoint = ({ latitude, longitude }) => {
    if (latitude === undefined || longitude === undefined) return undefined;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return { type: 'Point', coordinates: [lng, lat] };
};

const normalizeLabel = (label) => {
    const v = String(label || '').trim();
    if (v === 'Work') return 'Office';
    if (v === 'home' || v === 'Home') return 'Home';
    if (v === 'office' || v === 'Office') return 'Office';
    if (v === 'other' || v === 'Other') return 'Other';
    return 'Other';
};

const own_listAddresses = async (userId) => {
    const user = await FoodUser.findById(userId).select('addresses').lean();
    const addresses = (user?.addresses || []).map((address) => normalizeDeliveryAddress(address));
    return { addresses };
};

const own_addAddress = async (userId, dto) => {
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = {
        label: normalizeLabel(dto.label),
        street: dto.street,
        additionalDetails: dto.additionalDetails || '',
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode || '',
        phone: dto.phone || '',
        location: toGeoPoint(dto),
        isDefault: false
    };

    // If same label exists, update-in-place (keeps "Home/Office/Other" single entry best UX)
    const existingIdx = user.addresses.findIndex((a) => String(a?.label) === String(address.label));
    if (existingIdx >= 0) {
        const existing = user.addresses[existingIdx];
        existing.label = address.label;
        existing.street = address.street;
        existing.additionalDetails = address.additionalDetails;
        existing.city = address.city;
        existing.state = address.state;
        existing.zipCode = address.zipCode;
        existing.phone = address.phone;
        if (address.location) existing.location = address.location;
        await user.save();
        return { address: normalizeDeliveryAddress(existing.toObject()) };
    }

    // First address becomes default automatically
    if (!user.addresses.some((a) => a.isDefault)) {
        address.isDefault = true;
    }

    user.addresses.push(address);
    await user.save();
    const saved = user.addresses[user.addresses.length - 1];
    return { address: normalizeDeliveryAddress(saved.toObject()) };
};

const own_updateAddress = async (userId, addressId, dto) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    if (dto.label !== undefined) address.label = normalizeLabel(dto.label);
    if (dto.street !== undefined) address.street = dto.street;
    if (dto.additionalDetails !== undefined) address.additionalDetails = dto.additionalDetails || '';
    if (dto.city !== undefined) address.city = dto.city;
    if (dto.state !== undefined) address.state = dto.state;
    if (dto.zipCode !== undefined) address.zipCode = dto.zipCode || '';
    if (dto.phone !== undefined) address.phone = dto.phone || '';
    const location = toGeoPoint(dto);
    if (location) address.location = location;

    await user.save();
    return { address: normalizeDeliveryAddress(address.toObject()) };
};

const own_deleteAddress = async (userId, addressId) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    const wasDefault = !!address.isDefault;
    address.deleteOne();

    // If deleting default, promote the newest remaining address to default
    if (wasDefault) {
        const remaining = user.addresses.filter(Boolean);
        if (remaining.length) {
            remaining.forEach((a) => {
                a.isDefault = false;
            });
            remaining[remaining.length - 1].isDefault = true;
        }
    }

    await user.save();
    return { success: true };
};

const own_setDefaultAddress = async (userId, addressId) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    user.addresses.forEach((a) => {
        a.isDefault = String(a._id) === String(addressId);
    });
    await user.save();

    const updated = user.addresses.id(addressId);
    return { address: normalizeDeliveryAddress(updated?.toObject()) };
};


/*
 * The customer's one address book lives on their platform account
 * (core/identity/addressBook.js), shared with Food, Rides, Services and the
 * Shop. A customer with no platform account keeps this service's own copy.
 */
import * as platformBook from '../../../../../food/user/services/userAddress.service.js';
import { addressBookOwner } from '../../../../../../core/identity/addressBook.js';

const viaBook = (name, own) => async (userId, ...args) => {
    const owner = await addressBookOwner(userId, 'qc_users');
    if (!owner) return own(userId, ...args);
    const result = await platformBook[name](owner, ...args);
    if (result?.addresses) return { ...result, addresses: result.addresses.map((a) => normalizeDeliveryAddress(a)) };
    if (result?.address) return { ...result, address: normalizeDeliveryAddress(result.address) };
    return result;
};

export const listAddresses = viaBook('listAddresses', own_listAddresses);
export const addAddress = viaBook('addAddress', own_addAddress);
export const updateAddress = viaBook('updateAddress', own_updateAddress);
export const deleteAddress = viaBook('deleteAddress', own_deleteAddress);
export const setDefaultAddress = viaBook('setDefaultAddress', own_setDefaultAddress);
