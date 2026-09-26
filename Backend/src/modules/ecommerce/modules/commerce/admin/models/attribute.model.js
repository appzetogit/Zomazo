import mongoose from 'mongoose';

/**
 * A property a variant can vary by, with the values sellers pick from:
 * Size (S, M, L), Color (Red #d32f2f, Blue #1976d2), Storage (64 GB, 128 GB).
 *
 * Managed by the admin so every seller spells "Red" the same way; that is what
 * makes the customer's colour filter work across stores.
 */
const attributeValueSchema = new mongoose.Schema(
    {
        value: { type: String, required: true, trim: true },
        /** Swatch colour for `color` attributes, as #rrggbb. */
        hex: { type: String, trim: true, default: '' },
        sortOrder: { type: Number, default: 0 },
    },
    { _id: true }
);

const attributeSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        /** Lower-case name, unique, so "Size" and "size" cannot both exist. */
        key: { type: String, required: true, trim: true, lowercase: true, unique: true },
        /** How pickers draw it: buttons (`select`) or swatches (`color`). */
        type: { type: String, enum: ['select', 'color'], default: 'select' },
        values: { type: [attributeValueSchema], default: [] },
        /** Offered as a filter on customer listings. */
        isFilterable: { type: Boolean, default: true },
        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 },
    },
    { collection: 'attributes', timestamps: true }
);

export const Attribute = mongoose.model('Attribute', attributeSchema);

/**
 * The attributes that apply to a kind of product, attached to categories:
 * "Apparel" = Size + Color, "Phones" = Storage + Color.
 */
const attributeSetSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        key: { type: String, required: true, trim: true, lowercase: true, unique: true },
        attributeIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Attribute' }], default: [] },
        isActive: { type: Boolean, default: true },
    },
    { collection: 'attribute_sets', timestamps: true }
);

export const AttributeSet = mongoose.model('AttributeSet', attributeSetSchema);
