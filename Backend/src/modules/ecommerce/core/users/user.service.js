import { User } from './user.model.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../utils/helpers.js';

export const findOrCreateUserByPhone = async ({ phone, countryCode = '+91' }) => {
    let user = await User.findOne({ phone }).lean();

    if (!user) {
        const created = await User.create({ phone, countryCode });
        user = created.toObject();
    }

    return user;
};

export const getUsers = async (query) => {
    const { page, limit, skip } = buildPaginationOptions(query);

    const [docs, total] = await Promise.all([
        User.find().skip(skip).limit(limit).lean(),
        User.countDocuments()
    ]);

    return buildPaginatedResult({ docs, total, page, limit });
};

