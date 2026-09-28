const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isUser } = require('../../middleware/roleMiddleware');
const User = require('../../models/User');
const Service = require('../../models/UserService');
require('../../models/Brand');

/*
 * Saved services: the customer's shortlist to book again. Kept on the SP user
 * (favouriteServices). Only active services are listed; one an admin switched
 * off stays saved and comes back if it is switched on again.
 */

const MAX_FAVOURITES = 100;
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));

// The same shape /public/services lists, so the app draws them with one card.
const listView = (svc) => ({
  id: svc._id.toString(),
  title: svc.title,
  icon: svc.iconUrl,
  basePrice: svc.basePrice,
  discountPrice: svc.discountPrice,
  gstPercentage: svc.gstPercentage,
  pricingUnit: svc.pricingUnit,
  description: svc.description,
  categoryId: svc.categoryId?.toString(),
  brandId: svc.brandId?._id,
  brandName: svc.brandId?.title,
  brandIcon: svc.brandId?.iconUrl
});

const idsOf = (user) => (user?.favouriteServices || []).map(String);

router.get('/favourites', authenticate, isUser, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('favouriteServices').lean();
    const ids = idsOf(user);
    const services = ids.length
      ? await Service.find({ _id: { $in: ids }, status: 'active' }).populate('brandId', 'title iconUrl').lean()
      : [];
    const byId = new Map(services.map((s) => [String(s._id), s]));
    // Most recently saved first.
    const data = ids.slice().reverse().map((id) => byId.get(id)).filter(Boolean).map(listView);
    res.status(200).json({ success: true, data, ids });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

router.put('/favourites/:serviceId', authenticate, isUser, async (req, res) => {
  try {
    const { serviceId } = req.params;
    if (!isId(serviceId) || !(await Service.exists({ _id: serviceId, status: 'active' }))) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }
    const oid = new mongoose.Types.ObjectId(serviceId);
    // Capped in the filter, so two saves at once cannot run past the limit.
    const saved = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        $or: [{ favouriteServices: oid }, { [`favouriteServices.${MAX_FAVOURITES - 1}`]: { $exists: false } }]
      },
      { $addToSet: { favouriteServices: oid } },
      { new: true }
    ).select('favouriteServices').lean();
    if (!saved) {
      return res.status(400).json({ success: false, message: `You can save up to ${MAX_FAVOURITES} services. Remove one first.` });
    }
    res.status(200).json({ success: true, ids: idsOf(saved) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

router.delete('/favourites/:serviceId', authenticate, isUser, async (req, res) => {
  try {
    const { serviceId } = req.params;
    if (!isId(serviceId)) return res.status(404).json({ success: false, message: 'Service not found' });
    const saved = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { favouriteServices: new mongoose.Types.ObjectId(serviceId) } },
      { new: true }
    ).select('favouriteServices').lean();
    res.status(200).json({ success: true, ids: idsOf(saved) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

module.exports = router;
