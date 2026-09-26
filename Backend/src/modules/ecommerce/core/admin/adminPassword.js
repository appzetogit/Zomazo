import { ValidationError } from '../auth/errors.js';

/**
 * The admin password rule, enforced on every path that sets an admin password
 * (sub-admin create, change password, reset with OTP): 8+ characters with an
 * upper-case letter, a lower-case letter, a digit and a special character.
 * The admin UI shows the same rule; this is the check that counts.
 */
export const ADMIN_PASSWORD_RULE =
    'Password must be at least 8 characters and include an upper-case letter, a lower-case letter, a number and a special character';

/** What the password lacks, as short phrases. Empty = strong enough. */
export function adminPasswordProblems(password) {
    const value = typeof password === 'string' ? password : '';
    const problems = [];
    if (value.length < 8) problems.push('at least 8 characters');
    if (!/[A-Z]/.test(value)) problems.push('an upper-case letter');
    if (!/[a-z]/.test(value)) problems.push('a lower-case letter');
    if (!/\d/.test(value)) problems.push('a number');
    if (!/[^A-Za-z0-9]/.test(value)) problems.push('a special character');
    return problems;
}

export function assertStrongAdminPassword(password) {
    const missing = adminPasswordProblems(password);
    if (missing.length) {
        throw new ValidationError(`${ADMIN_PASSWORD_RULE}. Missing: ${missing.join(', ')}.`, { missing });
    }
}
