import mongoose from 'mongoose';

const coordinateSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

const zoneSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        zoneName: {
            type: String,
            trim: true
        },
        country: {
            type: String,
            required: true,
            trim: true,
            default: 'India',
            index: true
        },
        /** Display label e.g. city/area; optional, can mirror name */
        serviceLocation: {
            type: String,
            trim: true
        },
        unit: {
            type: String,
            enum: ['kilometer', 'miles'],
            default: 'kilometer'
        },
        coordinates: {
            type: [coordinateSchema],
            required: true,
            validate: {
                validator(v) {
                    return Array.isArray(v) && v.length >= 3;
                },
                message: 'Zone must have at least 3 coordinates (polygon).'
            }
        },
        /**
         * Quick delivery time the storefront advertises in this zone
         * ("Get it in N min"). Zones created before this field read as 10.
         */
        etaMinutes: {
            type: Number,
            min: 5,
            max: 120,
            default: 10
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        collection: 'zones',
        timestamps: true
    }
);

zoneSchema.index({ isActive: 1, name: 1 });
zoneSchema.index({ country: 1, name: 1 });

export const Zone = mongoose.model('Zone', zoneSchema);
