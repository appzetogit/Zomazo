import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';

const schema = z.object({
    email: z.string().email('Invalid email').transform((v) => v.trim().toLowerCase()),
    otp: z.string().min(4, 'OTP is required').max(8, 'Invalid OTP').transform((v) => String(v).replace(/\D/g, '')),
    newPassword: z.string().min(1, 'New password is required')
});

export const validateAdminForgotPasswordResetDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0]?.message || 'Invalid input');
    }
    return result.data;
};
