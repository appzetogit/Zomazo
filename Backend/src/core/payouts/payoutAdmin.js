import { initiatePayout, refreshPayout, isPayoutConfigured } from './payout.service.js';

/*
 * Express handlers for the admin "Pay via bank" / "Refresh" buttons. Each
 * service mounts them on its OWN admin router, behind the admin login and
 * finance permission that already guard its withdrawal decisions -- the five
 * admin panels sign in differently, so one shared route could not serve them.
 */

const reply = (fn) => async (req, res) => {
    try {
        const data = await fn(req);
        res.status(200).json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
};

const adminIdOf = (req) => req.user?.userId || req.user?.id || req.auth?.sub || null;

export const payoutAdminHandlers = (kindKey, param = 'id') => ({
    pay: reply((req) => initiatePayout(kindKey, req.params[param], { adminId: adminIdOf(req) })),
    refresh: reply((req) => refreshPayout(kindKey, req.params[param])),
});

/** Lets the screens show "Pay via bank" only when RazorpayX is set up. */
export const payoutConfigHandler = (_req, res) => {
    res.status(200).json({ success: true, data: { enabled: isPayoutConfigured() } });
};
