import { FoodUser } from '../../../../core/users/user.model.js';
import { AuthError, ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';

const parseIsoDateOrNull = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(`${String(value)}T00:00:00.000Z`);
    // Keep null for invalid; validation is handled by DTO, but be defensive.
    return Number.isNaN(d.getTime()) ? null : d;
};

const own_getCurrentUserProfile = async (userId) => {
    const user = await FoodUser.findById(userId).lean();
    if (!user) throw new AuthError('Profile not found');
    return { user };
};

const own_updateCurrentUserProfile = async (userId, body) => {
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    if (body.phone !== undefined) {
        const nextPhone = String(body.phone || '').trim();
        const currentPhone = String(user.phone || '').trim();
        // OTP login is phone-based in this project; don't allow changing it from profile edit.
        if (nextPhone && nextPhone !== currentPhone) {
            throw new ValidationError('Phone number cannot be changed');
        }
    }

    if (body.name !== undefined) user.name = String(body.name || '').trim();
    if (body.email !== undefined) {
        const nextEmail = String(body.email || '').trim().toLowerCase();
        if (nextEmail) {
            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(nextEmail)) {
                throw new ValidationError('Invalid email format');
            }
            const domainParts = nextEmail.split('@')[1].split('.');
            for (let i = 0; i < domainParts.length - 1; i++) {
                if (domainParts[i] === domainParts[i + 1] && domainParts[i].length > 0) {
                    throw new ValidationError('Invalid email domain structure (e.g., .com.com)');
                }
            }
            if (nextEmail.includes('..')) {
                throw new ValidationError('Email cannot contain consecutive dots');
            }
        }
        user.email = nextEmail;
    }
    if (body.profileImage !== undefined) user.profileImage = String(body.profileImage || '').trim();
    if (body.gender !== undefined) user.gender = String(body.gender || '').trim();

    const dob = parseIsoDateOrNull(body.dateOfBirth);
    if (dob !== undefined) user.dateOfBirth = dob;
    const ann = parseIsoDateOrNull(body.anniversary);
    if (ann !== undefined) user.anniversary = ann;

    await user.save();
    return { user: user.toObject() };
};

const own_uploadCurrentUserProfileImage = async (userId, file) => {
    if (!file || !file.buffer) {
        throw new ValidationError('File is required');
    }
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    const url = await uploadImageBuffer(file.buffer, 'food/users/profile');
    user.profileImage = String(url || '').trim();
    await user.save();
    return { profileImage: user.profileImage, user: user.toObject() };
};

/**
 * Delete a user and their associated wallet data permanently.
 */
export const deleteCurrentUserAccount = async (userId) => {
    // We import dynamically to avoid circular dependencies if any
    const { FoodUserWallet } = await import('../models/userWallet.model.js');
    
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    // Remove Wallet
    await FoodUserWallet.findOneAndDelete({ userId });

    // Remove User
    await FoodUser.findByIdAndDelete(userId);

    return { success: true };
};


/*
 * One profile across services (core/identity/sharedProfile.js): the customer's
 * name, email, photo and dates are shown from their platform account, and an
 * edit here is saved there too.
 */
import { SHARED_PROFILE_FIELDS, saveSharedProfile, withSharedProfile } from '../../../../../../core/identity/sharedProfile.js';

export const getCurrentUserProfile = async (userId) => {
    const result = await own_getCurrentUserProfile(userId);
    return { ...result, user: await withSharedProfile(result.user) };
};

export const updateCurrentUserProfile = async (userId, body = {}) => {
    const result = await own_updateCurrentUserProfile(userId, body);
    const changed = Object.fromEntries(
        SHARED_PROFILE_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, result.user?.[f]]),
    );
    await saveSharedProfile(userId, changed);
    return { ...result, user: await withSharedProfile(result.user) };
};

export const uploadCurrentUserProfileImage = async (userId, file) => {
    const result = await own_uploadCurrentUserProfileImage(userId, file);
    await saveSharedProfile(userId, { profileImage: result.profileImage });
    return result;
};
