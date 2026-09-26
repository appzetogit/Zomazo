import { ShippingProvider } from './shippingProvider.interface.js';

export class MockShippingProvider extends ShippingProvider {
    constructor(options = {}) {
        super();
        this.name = 'mock';
        this.defaultRate = options.defaultRate || 50;
        this.shipments = new Map();
        /** NDR actions sent, newest last (tests and demos read these). */
        this.ndrActions = [];
    }

    async checkServiceability(pincode, weightGrams = 500) {
        const pin = String(pincode || '').trim();
        // Disallow known invalid pincodes or 000000
        if (!pin || pin.length !== 6 || pin === '000000') {
            return { serviceable: false, estimatedDays: 0, couriers: [] };
        }
        return {
            serviceable: true,
            estimatedDays: 3,
            couriers: ['MockExpress', 'MockSurface'],
        };
    }

    async calculateRate({ originPincode, destPincode, weightGrams = 500 }) {
        const rate = weightGrams > 1000 ? this.defaultRate * 1.5 : this.defaultRate;
        return {
            rate,
            currency: 'INR',
            courierName: 'MockExpress',
        };
    }

    async createShipment(orderData) {
        const shipmentId = `MOCK-SHIP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const awb = `AWB${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const etd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const record = {
            shipmentId,
            awb,
            courierName: 'MockExpress',
            labelUrl: `https://shipping.mock/labels/${awb}.pdf`,
            etd,
            status: 'manifested',
            trackingHistory: [
                {
                    status: 'manifested',
                    activity: 'Shipment data manifested with courier',
                    location: 'Origin Facility',
                    timestamp: new Date(),
                },
            ],
        };
        this.shipments.set(awb, record);
        return {
            shipmentId,
            awb,
            courierName: record.courierName,
            labelUrl: record.labelUrl,
            etd: record.etd,
        };
    }

    async requestPickup(shipmentId) {
        return { success: true, pickupToken: `PK-${Date.now()}` };
    }

    async cancelShipment(shipmentId) {
        return { success: true, message: 'Shipment cancelled with mock courier' };
    }

    get supportsReturns() {
        return true;
    }

    async createReturnShipment(returnData = {}) {
        const shipmentId = `MOCK-RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const awb = `RAWB${Date.now()}${Math.floor(Math.random() * 1000)}`;
        this.shipments.set(awb, {
            shipmentId,
            awb,
            courierName: 'MockExpress',
            status: 'pickup_scheduled',
            trackingHistory: [
                { status: 'pickup_scheduled', activity: 'Return pickup scheduled', location: 'Customer address', timestamp: new Date() },
            ],
        });
        return { shipmentId, providerOrderId: `MOCK-RET-ORD-${returnData.returnId || ''}`, awb, courierName: 'MockExpress', provider: this.name };
    }

    /**
     * Test / demo helper: move a mock shipment to a status. For 'undelivered'
     * pass `{ reason }` (and optionally `attempts`) to simulate an NDR.
     */
    setStatus(awb, status, activity = '', ndr = null) {
        const record = this.shipments.get(awb);
        if (!record) return;
        record.status = status;
        if (status === 'undelivered') {
            const attempts = Number(ndr?.attempts) || (Number(record.ndr?.attempts) || 0) + 1;
            record.ndr = { attempts, reason: ndr?.reason || activity || 'Customer not available', at: new Date() };
        }
        record.trackingHistory.push({ status, activity: activity || status, location: '', timestamp: new Date() });
    }

    async trackShipment(awb) {
        const record = this.shipments.get(awb);
        if (!record) {
            return {
                currentStatus: 'in_transit',
                trackingEvents: [
                    {
                        status: 'in_transit',
                        activity: 'Package in transit to delivery hub',
                        location: 'Sorting Hub',
                        timestamp: new Date(),
                    },
                ],
            };
        }
        return {
            currentStatus: record.status,
            ndr: record.ndr || null,
            trackingEvents: record.trackingHistory,
        };
    }

    async ndrAction({ awb, action, ...rest } = {}) {
        if (!['reattempt', 'rto'].includes(action)) throw new Error(`Unsupported NDR action '${action}'`);
        this.ndrActions.push({ awb, action, ...rest, at: new Date() });
        const record = this.shipments.get(awb);
        if (record && action === 'rto') this.setStatus(awb, 'rto_initiated', 'Return to origin requested');
        return { success: true, message: `NDR ${action} recorded` };
    }
}

export const defaultShippingProvider = new MockShippingProvider();
