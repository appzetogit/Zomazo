import mongoose from 'mongoose';
import { Category } from '../../admin/models/category.model.js';
import { searchProducts } from './productSearch.service.js';
import { smartParse } from './queryParser.service.js';

/** A category and its subcategories (two levels down), so "Atta" finds products filed under a child. */
async function categoryWithChildren(id) {
    const ids = [String(id)];
    let frontier = [new mongoose.Types.ObjectId(String(id))];
    for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
        const children = await Category.find({ parentId: { $in: frontier } }).select('_id').lean();
        frontier = children.map((c) => c._id);
        ids.push(...frontier.map(String));
    }
    return ids;
}

/**
 * GET /catalog/search/products?smart=1: parses `q` into filters, runs the
 * normal product search with them, and returns what was applied as chips.
 *
 * Filters in the URL win over parsed ones. `smartExclude` (comma list of chip
 * ids) drops chips the shopper removed.
 */
export async function smartSearchProducts(query = {}) {
    const raw = String(query.q || '').trim().slice(0, 200);
    const parsed = await smartParse(raw, { exclude: query.smartExclude || [] });
    const f = parsed.filters;
    const merged = { ...query, q: parsed.q };
    delete merged.smart;
    delete merged.smartExclude;
    delete merged.categoryIds;

    if (f.minPrice !== undefined && (query.minPrice === undefined || query.minPrice === '')) merged.minPrice = f.minPrice;
    if (f.maxPrice !== undefined && (query.maxPrice === undefined || query.maxPrice === '')) merged.maxPrice = f.maxPrice;
    if (f.packSize && !query.packSize) merged.packSize = f.packSize;
    if (f.brand?.length && !query.brand) merged.brand = f.brand.join(',');
    if (f.attr) {
        const attr = { ...(query.attr && typeof query.attr === 'object' ? query.attr : {}) };
        for (const [name, values] of Object.entries(f.attr)) if (!attr[name]) attr[name] = values.join(',');
        merged.attr = attr;
    }
    if (f.categoryId && !query.categoryId) merged.categoryIds = await categoryWithChildren(f.categoryId);
    if (parsed.sort && (!query.sort || query.sort === 'relevance')) merged.sort = parsed.sort;

    const results = await searchProducts(merged);
    return {
        ...results,
        smart: {
            originalQuery: raw,
            query: parsed.q,
            source: parsed.source,
            appliedFilters: parsed.chips,
            filters: f,
        },
    };
}
