import mongoose from 'mongoose';

/*
 * A flat amount added to every quick-commerce delivery in a zone while it is
 * switched on -- rain, a festival night, a zone short of riders. The rider is
 * paid it in full; the platform only passes it through.
 *
 * Its own collection rather than food's: food's surge rows point at food_zones,
 * and a quick or medical zone id would never match one (zone-separation smoke).
 * Quick and medical zones live in different collections, so `vertical` records
 * which map the zone was drawn on; ids never collide across them, so one row
 * per zone is still unique.
 */
const deliverySurgeZoneSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            unique: true,
            index: true
        },
        vertical: { type: String, enum: ['quick', 'medical'], default: 'quick', index: true },
        isEnabled: { type: Boolean, default: false, index: true },
        surgeAmount: { type: Number, default: 0, min: 0 },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null }
    },
    { collection: 'qc_delivery_surge_zones', timestamps: true }
);

export const QCDeliverySurgeZone =
    mongoose.models.QCDeliverySurgeZone ||
    mongoose.model('QCDeliverySurgeZone', deliverySurgeZoneSchema);

/**
 * The surge an order in this zone pays right now: the configured amount when
 * the zone's surge is on, else 0. Never throws -- a lookup failure must not
 * block a checkout, and charging no surge is the customer-safe direction.
 */
export async function zoneSurgeAmount(zoneId) {
    if (!zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) return 0;
    try {
        const cfg = await QCDeliverySurgeZone.findOne({ zoneId }).select('isEnabled surgeAmount').lean();
        if (!cfg?.isEnabled) return 0;
        return Math.round((Number(cfg.surgeAmount) || 0) * 100) / 100;
    } catch {
        return 0;
    }
}
