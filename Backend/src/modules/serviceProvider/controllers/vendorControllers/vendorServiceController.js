const mongoose = require('mongoose');
const Service = require('../../models/UserService');
const VendorService = require('../../models/VendorService');
const { validationResult } = require('express-validator');
const { SERVICE_STATUS } = require('../../utils/constants');

/**
 * Get vendor's services
 */
const getVendorServices = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query - services are linked to vendors through bookings
    // For now, we'll get all services and filter by vendor bookings
    // TODO: Add vendorId field to Service model if vendors can own services

    const query = {};
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get services (for now, return all active services)
    // In production, services should be linked to vendors
    const services = await Service.find({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    })
      .populate('categoryId', 'title slug')
      .populate('categoryIds', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments({
      ...query,
      status: SERVICE_STATUS.ACTIVE
    });

    // Lay this vendor's own availability and price over each catalog row, so the
    // vendor app shows what the vendor set rather than only the platform default.
    const overrides = await VendorService.find({
      vendorId,
      serviceId: { $in: services.map((s) => s._id) }
    }).lean();
    const byService = new Map(overrides.map((o) => [String(o.serviceId), o]));
    const data = services.map((s) => {
      const o = byService.get(String(s._id));
      return {
        ...s.toObject(),
        vendorAvailable: o ? o.isAvailable !== false : true,
        vendorPrice: o && o.customPrice != null ? o.customPrice : null
      };
    });

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services. Please try again.'
    });
  }
};

/*
 * Availability and price are the vendor's OWN overrides, kept per vendor in
 * sp_vendor_services (models/VendorService.js).
 *
 * Both handlers below used to write straight to the shared catalog row, so any
 * approved vendor could switch a service off, or reprice it, for every customer
 * and every other vendor on the platform (the old TODOs admitted as much). The
 * catalog belongs to the admin panel; a vendor only records how THEY offer it.
 */
const upsertVendorOverride = async (vendorId, serviceId, fields) => {
  if (!mongoose.Types.ObjectId.isValid(serviceId)) return null;
  const service = await Service.findById(serviceId).select('_id').lean();
  if (!service) return null;
  return VendorService.findOneAndUpdate(
    { vendorId, serviceId },
    { $set: fields },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
};

/**
 * Update service availability (enable/disable) for this vendor only
 */
const updateServiceAvailability = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { serviceId } = req.params;
    const isAvailable = req.body.isAvailable === true || req.body.isAvailable === 'true';

    const override = await upsertVendorOverride(vendorId, serviceId, { isAvailable });
    if (!override) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Service availability updated successfully',
      data: override
    });
  } catch (error) {
    console.error('Update service availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service availability. Please try again.'
    });
  }
};

/**
 * Set service pricing (vendor-specific pricing)
 */
const setServicePricing = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { serviceId } = req.params;
    // The discounted price is what the vendor actually charges when both are sent.
    // An empty value clears the override, falling back to the catalog price.
    const { basePrice, discountPrice } = req.body;
    const isSet = (v) => v !== undefined && v !== null && v !== '';
    const raw = isSet(discountPrice) ? discountPrice : basePrice;
    const customPrice = isSet(raw) ? Number(raw) : null;

    const override = await upsertVendorOverride(vendorId, serviceId, { customPrice });
    if (!override) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Service pricing updated successfully',
      data: override
    });
  } catch (error) {
    console.error('Set service pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service pricing. Please try again.'
    });
  }
};

module.exports = {
  getVendorServices,
  updateServiceAvailability,
  setServicePricing
};

