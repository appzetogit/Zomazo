import mongoose from 'mongoose';
import { Attribute, AttributeSet } from '../models/attribute.model.js';
import { Category } from '../models/category.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';

const str = (v) => (v == null ? '' : String(v).trim());
const HEX = /^#[0-9a-f]{6}$/i;

const toObjectId = (id, label) => {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) throw new ValidationError(`Invalid ${label}`);
    return new mongoose.Types.ObjectId(String(id));
};

function normalizeValues(raw, type) {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw)) throw new ValidationError('Attribute values must be a list');
    const seen = new Set();
    return raw.map((entry, index) => {
        let item = typeof entry === 'string' ? { value: entry } : entry || {};
        // Colour values may come as "Name:#hex" (the admin form's text shorthand).
        if (type === 'color' && !str(item.hex)) {
            const m = str(item.value).match(/^(.*?)\s*:\s*(#[0-9a-f]{6})$/i);
            if (m) item = { ...item, value: m[1], hex: m[2] };
        }
        const value = str(item.value);
        if (!value) throw new ValidationError('Attribute values cannot be empty');
        const key = value.toLowerCase();
        if (seen.has(key)) throw new ValidationError(`"${value}" is listed twice`);
        seen.add(key);
        const hex = str(item.hex);
        if (type === 'color' && hex && !HEX.test(hex)) throw new ValidationError(`Colour for ${value} must look like #1a2b3c`);
        const out = { value, hex: type === 'color' ? hex.toLowerCase() : '', sortOrder: Number(item.sortOrder ?? index) || 0 };
        if (item._id && mongoose.Types.ObjectId.isValid(String(item._id))) out._id = new mongoose.Types.ObjectId(String(item._id));
        return out;
    });
}

async function assertUniqueKey(Model, name, exceptId) {
    const clash = await Model.findOne({ key: name.toLowerCase(), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
    if (clash) throw new ValidationError(`"${clash.name}" already exists`);
}

// ---- Attributes -----------------------------------------------------------

export async function listAttributes({ activeOnly = false } = {}) {
    return Attribute.find(activeOnly ? { isActive: true } : {}).sort({ sortOrder: 1, name: 1 }).lean();
}

export async function createAttribute(body = {}) {
    const name = str(body.name);
    if (!name) throw new ValidationError('Attribute name is required');
    await assertUniqueKey(Attribute, name);
    const type = body.type === 'color' ? 'color' : 'select';
    const doc = await Attribute.create({
        name,
        key: name,
        type,
        values: normalizeValues(body.values ?? [], type),
        isFilterable: body.isFilterable !== false,
        isActive: body.isActive !== false,
        sortOrder: Number(body.sortOrder) || 0,
    });
    return doc.toObject();
}

export async function updateAttribute(id, body = {}) {
    const doc = await Attribute.findById(toObjectId(id, 'attribute id'));
    if (!doc) throw new NotFoundError('Attribute not found');
    if (body.name !== undefined) {
        const name = str(body.name);
        if (!name) throw new ValidationError('Attribute name is required');
        await assertUniqueKey(Attribute, name, doc._id);
        doc.name = name;
        doc.key = name;
    }
    if (body.type !== undefined) doc.type = body.type === 'color' ? 'color' : 'select';
    const values = normalizeValues(body.values, doc.type);
    if (values !== undefined) doc.values = values;
    if (body.isFilterable !== undefined) doc.isFilterable = body.isFilterable !== false;
    if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
    await doc.save();
    return doc.toObject();
}

export async function deleteAttribute(id) {
    const _id = toObjectId(id, 'attribute id');
    const usedBy = await AttributeSet.findOne({ attributeIds: _id }).select('name').lean();
    if (usedBy) throw new ValidationError(`Remove it from the "${usedBy.name}" attribute set first`);
    const res = await Attribute.deleteOne({ _id });
    if (!res.deletedCount) throw new NotFoundError('Attribute not found');
    return { id: String(_id) };
}

// ---- Attribute sets -------------------------------------------------------

async function resolveAttributeIds(raw) {
    if (!Array.isArray(raw)) throw new ValidationError('attributeIds must be a list');
    const ids = [...new Set(raw.map(String))].map((id) => toObjectId(id, 'attribute id'));
    const found = await Attribute.countDocuments({ _id: { $in: ids } });
    if (found !== ids.length) throw new ValidationError('One or more attributes do not exist');
    return ids;
}

export async function listAttributeSets() {
    return AttributeSet.find({}).sort({ name: 1 }).populate('attributeIds', 'name type isActive').lean();
}

export async function createAttributeSet(body = {}) {
    const name = str(body.name);
    if (!name) throw new ValidationError('Attribute set name is required');
    await assertUniqueKey(AttributeSet, name);
    const doc = await AttributeSet.create({
        name,
        key: name,
        attributeIds: await resolveAttributeIds(body.attributeIds ?? []),
        isActive: body.isActive !== false,
    });
    return doc.toObject();
}

export async function updateAttributeSet(id, body = {}) {
    const doc = await AttributeSet.findById(toObjectId(id, 'attribute set id'));
    if (!doc) throw new NotFoundError('Attribute set not found');
    if (body.name !== undefined) {
        const name = str(body.name);
        if (!name) throw new ValidationError('Attribute set name is required');
        await assertUniqueKey(AttributeSet, name, doc._id);
        doc.name = name;
        doc.key = name;
    }
    if (body.attributeIds !== undefined) doc.attributeIds = await resolveAttributeIds(body.attributeIds);
    if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
    await doc.save();
    return doc.toObject();
}

export async function deleteAttributeSet(id) {
    const _id = toObjectId(id, 'attribute set id');
    const usedBy = await Category.findOne({ attributeSetId: _id }).select('name').lean();
    if (usedBy) throw new ValidationError(`The "${usedBy.name}" category uses it; pick another set there first`);
    const res = await AttributeSet.deleteOne({ _id });
    if (!res.deletedCount) throw new NotFoundError('Attribute set not found');
    return { id: String(_id) };
}

// ---- Categories -----------------------------------------------------------

/** A category and its parent: a subcategory inherits the set and the FSSAI rule. */
async function categoryChain(categoryId) {
    if (!categoryId || !mongoose.Types.ObjectId.isValid(String(categoryId))) return [];
    const category = await Category.findById(categoryId).select('name parentId attributeSetId requiresFssai').lean();
    if (!category) return [];
    const parent = category.parentId
        ? await Category.findById(category.parentId).select('name attributeSetId requiresFssai').lean()
        : null;
    return parent ? [category, parent] : [category];
}

/** The attributes that apply to a category (its own set, else its parent's), active ones only. */
export async function getCategoryAttributes(categoryId) {
    const chain = await categoryChain(categoryId);
    const setId = chain.find((c) => c.attributeSetId)?.attributeSetId;
    if (!setId) return { attributeSet: null, attributes: [] };
    const set = await AttributeSet.findOne({ _id: setId, isActive: true }).lean();
    if (!set) return { attributeSet: null, attributes: [] };
    const attributes = await Attribute.find({ _id: { $in: set.attributeIds }, isActive: true }).lean();
    // Keep the order the admin arranged in the set.
    const byId = new Map(attributes.map((a) => [String(a._id), a]));
    return {
        attributeSet: { _id: set._id, name: set.name },
        attributes: set.attributeIds.map((id) => byId.get(String(id))).filter(Boolean),
    };
}

/**
 * When the category has an attribute set, a variant may only use its
 * attributes and their listed values, respelled to the admin's spelling so
 * "red" and "Red" filter as one. Categories without a set accept anything.
 */
export async function applyCategoryAttributes(categoryId, variants = []) {
    if (!variants.some((v) => v.attributes?.length)) return variants;
    const { attributes } = await getCategoryAttributes(categoryId);
    if (!attributes.length) return variants;

    const byKey = new Map(attributes.map((a) => [a.key, a]));
    return variants.map((variant) => ({
        ...variant,
        attributes: (variant.attributes || []).map(({ name, value }) => {
            const attribute = byKey.get(name.toLowerCase());
            if (!attribute) {
                throw new ValidationError(
                    `${name} is not an option for this category. Use: ${attributes.map((a) => a.name).join(', ')}`,
                );
            }
            const match = attribute.values.find((v) => v.value.toLowerCase() === value.toLowerCase());
            if (!match) {
                throw new ValidationError(
                    `${value} is not a listed ${attribute.name}. Use: ${attribute.values.map((v) => v.value).join(', ')}`,
                );
            }
            return { name: attribute.name, value: match.value };
        }),
    }));
}

/** Food and grocery categories need the seller's FSSAI licence on file and in date. */
export async function assertSellerMayListInCategory(seller, categoryId) {
    const chain = await categoryChain(categoryId);
    const needing = chain.find((c) => c.requiresFssai);
    if (!needing) return;
    const number = str(seller?.fssaiNumber);
    const expiry = seller?.fssaiExpiry ? new Date(seller.fssaiExpiry) : null;
    if (!number) {
        throw new ValidationError(`${needing.name} needs an FSSAI licence. Add yours in your store details first.`);
    }
    if (expiry && expiry < new Date(new Date().toDateString())) {
        throw new ValidationError(`Your FSSAI licence has expired. Renew it in your store details to list in ${needing.name}.`);
    }
}
