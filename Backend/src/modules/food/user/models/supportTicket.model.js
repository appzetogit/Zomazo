import mongoose from 'mongoose';

const supportTicketSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
        type: { type: String, enum: ['order', 'restaurant', 'other'], required: true },
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', default: null },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', default: null },
        issueType: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        status: { type: String, enum: ['open', 'in-progress', 'resolved'], default: 'open', index: true },
        adminResponse: { type: String, default: '' },
        /*
         * Raised from the super app's help centre about a service that has no
         * ticket desk of its own (Services bookings): which service, and the
         * booking's number. Empty for Food's own tickets.
         */
        service: { type: String, default: '', trim: true },
        orderRef: { type: String, default: '', trim: true }
    },
    { collection: 'food_support_tickets', timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });

export const FoodSupportTicket = mongoose.model('FoodSupportTicket', supportTicketSchema);
