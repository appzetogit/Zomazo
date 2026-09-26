import mongoose from 'mongoose';
import { QuickHomeLayout } from '../models/quickHomeLayout.model.js';
import { Category } from '../../admin/models/category.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Reads and writes the Quick phone home's layout (QUICK_MOBILE_SPEC.md §3).
 *
 * A zone's own layout wins; without one the global layout (zoneId null) is
 * used, and without that a built-in default, so the storefront is never blank.
 */

const MAX = { themes: 12, promoTiles: 3, featured: 12, campaigns: 6, categoryGroups: 10, thumbs: 3, brands: 4 };

/** What a fresh install shows: one "All" theme and the top-level categories as groups. */
export const DEFAULT_LAYOUT = Object.freeze({
    themes: [
        {
            slug: 'all',
            label: 'All',
            iconUrl: '',
            backgroundUrl: '',
            accent: '',
            poweredBy: [],
            promoTiles: [
                { title: 'Deals of the day', imageUrl: '', link: '/quick/search?minDiscount=10' },
                { title: 'Fresh picks', imageUrl: '', link: '/quick/categories' },
                { title: 'Minimum 20% off', imageUrl: '', link: '/quick/search?minDiscount=20' },
            ],
            // "/spin" opens the Spin & Win wheel rather than a page.
            rewards: { title: 'Win assured rewards', subtitle: 'Spin daily for coins on every order', thumbs: [], link: '/spin' },
            offerStrip: { text: 'Coins on every order, usable at checkout', link: '/coins' },
            startsAt: null,
            endsAt: null,
            sortOrder: 0,
            isActive: true,
        },
    ],
    featured: [],
    campaigns: [],
    categoryGroups: [],
});

const toObjectId = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null;

/** Inside its date window (either end may be open) and switched on. */
const isLive = (item, now) =>
    item?.isActive !== false &&
    (!item?.startsAt || new Date(item.startsAt) <= now) &&
    (!item?.endsAt || new Date(item.endsAt) >= now);

const bySort = (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);

async function findLayout(zoneId) {
    const zone = toObjectId(zoneId);
    if (zone) {
        const own = await QuickHomeLayout.findOne({ zoneId: zone }).lean();
        if (own) return own;
    }
    return QuickHomeLayout.findOne({ zoneId: null }).lean();
}

/**
 * The layout a shopper sees: live items only, in order, with each category
 * group resolved to its parent and children so the app draws tiles without a
 * second request.
 */
export async function getPublicQuickHomeLayout(zoneId, now = new Date()) {
    const stored = (await findLayout(zoneId)) || DEFAULT_LAYOUT;

    const themes = (stored.themes || []).filter((t) => isLive(t, now)).sort(bySort);
    const featured = (stored.featured || []).filter((f) => isLive(f, now)).sort(bySort);
    const campaigns = (stored.campaigns || []).filter((c) => isLive(c, now)).sort(bySort);

    // Groups: the stored ones, or else every top-level category that has children.
    let groupDefs = [...(stored.categoryGroups || [])].sort(bySort);
    const categories = await Category.find({ isActive: { $ne: false }, approvalStatus: { $ne: 'rejected' } })
        .select('_id name image parentId sortOrder')
        .sort({ sortOrder: 1, name: 1 })
        .lean();
    const childrenOf = (id) => categories.filter((c) => c.parentId && String(c.parentId) === String(id));

    if (!groupDefs.length) {
        groupDefs = categories
            .filter((c) => !c.parentId && childrenOf(c._id).length)
            .map((c) => ({ title: c.name, parentCategoryId: c._id }));
    }

    const categoryGroups = groupDefs
        .map((g) => {
            const parent = categories.find((c) => String(c._id) === String(g.parentCategoryId));
            if (!parent) return null;
            const children = childrenOf(parent._id).map((c) => ({
                id: String(c._id),
                name: c.name,
                image: c.image || '',
            }));
            if (!children.length) return null;
            return { title: g.title || parent.name, parentId: String(parent._id), parentName: parent.name, children };
        })
        .filter(Boolean);

    return {
        themes: themes.length ? themes : DEFAULT_LAYOUT.themes,
        featured,
        campaigns,
        categoryGroups,
    };
}

/** The stored layout for the editor: the zone's own, else the global one, else empty. */
export async function getAdminQuickHomeLayout(zoneId) {
    const zone = toObjectId(zoneId);
    const own = await QuickHomeLayout.findOne({ zoneId: zone }).lean();
    return {
        zoneId: zone ? String(zone) : null,
        inherited: !own,
        layout: own || (zone ? await QuickHomeLayout.findOne({ zoneId: null }).lean() : null) || { ...DEFAULT_LAYOUT },
    };
}

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

/** Links must stay inside the app, so a tile can never send a shopper off-site. */
const appLink = (value) => {
    const v = text(value, 300);
    if (!v) return '';
    if (!v.startsWith('/') || v.startsWith('//')) {
        throw new ValidationError(`Links must be app paths starting with "/": ${v}`);
    }
    return v;
};

/** Uploaded images are served from /uploads, or from an https CDN. */
const imageUrl = (value) => {
    const v = text(value, 500);
    if (!v) return '';
    if (!(v.startsWith('/uploads/') || /^https:\/\//i.test(v))) {
        throw new ValidationError(`Images must be an uploaded file (/uploads/...) or an https URL: ${v}`);
    }
    return v;
};

const date = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ValidationError(`Not a date: ${value}`);
    return d;
};

const dateWindow = (item) => {
    const startsAt = date(item.startsAt);
    const endsAt = date(item.endsAt);
    // A bare date ("2026-10-01") from the editor means the whole of that day.
    if (endsAt && /^\d{4}-\d{2}-\d{2}$/.test(String(item.endsAt).trim())) {
        endsAt.setUTCHours(23, 59, 59, 999);
    }
    if (startsAt && endsAt && endsAt < startsAt) throw new ValidationError('An end date cannot come before its start');
    return { startsAt, endsAt };
};

const brands = (list) =>
    (Array.isArray(list) ? list : []).slice(0, MAX.brands).map((b) => ({ name: text(b?.name, 60), logoUrl: imageUrl(b?.logoUrl) }));

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Checks and normalises a layout sent by the editor. */
export function normaliseQuickHomeLayout(payload = {}) {
    const themes = (Array.isArray(payload.themes) ? payload.themes : []).slice(0, MAX.themes).map((t, i) => {
        const slug = text(t?.slug, 41).toLowerCase();
        if (!SLUG.test(slug)) throw new ValidationError(`Theme ${i + 1}: slug must be lowercase letters, numbers and dashes`);
        const label = text(t?.label, 30);
        if (!label) throw new ValidationError(`Theme "${slug}" needs a label`);
        return {
            ...(t?._id && mongoose.Types.ObjectId.isValid(String(t._id)) ? { _id: t._id } : {}),
            slug,
            label,
            iconUrl: imageUrl(t?.iconUrl),
            backgroundUrl: imageUrl(t?.backgroundUrl),
            accent: /^#[0-9a-f]{3,8}$/i.test(text(t?.accent, 9)) ? text(t.accent, 9) : '',
            poweredBy: brands(t?.poweredBy),
            promoTiles: (Array.isArray(t?.promoTiles) ? t.promoTiles : []).slice(0, MAX.promoTiles).map((p) => ({
                title: text(p?.title, 40),
                imageUrl: imageUrl(p?.imageUrl),
                link: appLink(p?.link),
            })),
            rewards: {
                title: text(t?.rewards?.title, 60),
                subtitle: text(t?.rewards?.subtitle, 90),
                thumbs: (Array.isArray(t?.rewards?.thumbs) ? t.rewards.thumbs : []).slice(0, MAX.thumbs).map(imageUrl).filter(Boolean),
                link: appLink(t?.rewards?.link),
            },
            offerStrip: { text: text(t?.offerStrip?.text, 90), link: appLink(t?.offerStrip?.link) },
            ...dateWindow(t || {}),
            sortOrder: Number.isFinite(Number(t?.sortOrder)) ? Number(t.sortOrder) : i,
            isActive: t?.isActive !== false,
        };
    });

    const slugs = themes.map((t) => t.slug);
    const dupe = slugs.find((s, i) => slugs.indexOf(s) !== i);
    if (dupe) throw new ValidationError(`Two themes share the slug "${dupe}"`);

    const featured = (Array.isArray(payload.featured) ? payload.featured : []).slice(0, MAX.featured).map((f, i) => {
        const title = text(f?.title, 40);
        if (!title) throw new ValidationError(`Featured card ${i + 1} needs a title`);
        return {
            ...(f?._id && mongoose.Types.ObjectId.isValid(String(f._id)) ? { _id: f._id } : {}),
            title,
            badge: text(f?.badge, 24) || 'Featured',
            style: f?.style === 'launch' ? 'launch' : 'featured',
            artUrl: imageUrl(f?.artUrl),
            link: appLink(f?.link),
            sortOrder: Number.isFinite(Number(f?.sortOrder)) ? Number(f.sortOrder) : i,
            isActive: f?.isActive !== false,
        };
    });

    const campaigns = (Array.isArray(payload.campaigns) ? payload.campaigns : []).slice(0, MAX.campaigns).map((c, i) => {
        const title = text(c?.title, 70);
        if (!title) throw new ValidationError(`Campaign ${i + 1} needs a title`);
        return {
            ...(c?._id && mongoose.Types.ObjectId.isValid(String(c._id)) ? { _id: c._id } : {}),
            title,
            subtitle: text(c?.subtitle, 90),
            artUrl: imageUrl(c?.artUrl),
            poweredBy: brands(c?.poweredBy),
            ctaText: text(c?.ctaText, 20) || 'Shop now',
            link: appLink(c?.link),
            tint: /^#[0-9a-f]{3,8}$/i.test(text(c?.tint, 9)) ? text(c.tint, 9) : '',
            ...dateWindow(c || {}),
            sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : i,
            isActive: c?.isActive !== false,
        };
    });

    const categoryGroups = (Array.isArray(payload.categoryGroups) ? payload.categoryGroups : [])
        .slice(0, MAX.categoryGroups)
        .map((g, i) => {
            const parentCategoryId = toObjectId(g?.parentCategoryId);
            if (!parentCategoryId) throw new ValidationError(`Category group ${i + 1} needs a category`);
            return {
                ...(g?._id && mongoose.Types.ObjectId.isValid(String(g._id)) ? { _id: g._id } : {}),
                title: text(g?.title, 40),
                parentCategoryId,
                sortOrder: Number.isFinite(Number(g?.sortOrder)) ? Number(g.sortOrder) : i,
            };
        });

    return { themes, featured, campaigns, categoryGroups };
}

/** Saves a zone's layout (or the global one for zoneId null). */
export async function saveQuickHomeLayout(zoneId, payload) {
    const zone = toObjectId(zoneId);
    if (zoneId && !zone) throw new ValidationError('zoneId is not valid');
    const clean = normaliseQuickHomeLayout(payload);

    if (clean.categoryGroups.length) {
        const ids = clean.categoryGroups.map((g) => g.parentCategoryId);
        const found = await Category.countDocuments({ _id: { $in: ids } });
        if (found !== new Set(ids.map(String)).size) throw new ValidationError('A category group points at a category that does not exist');
    }

    const saved = await QuickHomeLayout.findOneAndUpdate(
        { zoneId: zone },
        { $set: { zoneId: zone, ...clean } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    return saved;
}

/** Drops a zone's own layout so it falls back to the global one. */
export async function resetQuickHomeLayout(zoneId) {
    const zone = toObjectId(zoneId);
    if (!zone) throw new ValidationError('Only a zone layout can be reset; the global one is the fallback');
    const res = await QuickHomeLayout.deleteOne({ zoneId: zone });
    return { removed: res.deletedCount > 0 };
}
