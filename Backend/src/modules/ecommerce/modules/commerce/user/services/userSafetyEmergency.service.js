import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { User } from '../../../../core/users/user.model.js';
import { SafetyEmergencyReport } from '../../admin/models/safetyEmergencyReport.model.js';

export const createSafetyEmergencyReport = async (userId, message) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const user = await User.findById(id).select('name email phone').lean();
    if (!user) {
        throw new ValidationError('User not found');
    }

    const created = await SafetyEmergencyReport.create({
        userId: new mongoose.Types.ObjectId(id),
        userName: user.name || '',
        userEmail: user.email || '',
        userPhone: user.phone || '',
        message: String(message || '').trim(),
        status: 'unread',
        priority: 'medium'
    });

    return { report: created.toObject() };
};

export const listMySafetyEmergencyReports = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { userId: new mongoose.Types.ObjectId(id) };
    const [list, total] = await Promise.all([
        SafetyEmergencyReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        SafetyEmergencyReport.countDocuments(filter)
    ]);

    return {
        safetyEmergencies: list || [],
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
};

