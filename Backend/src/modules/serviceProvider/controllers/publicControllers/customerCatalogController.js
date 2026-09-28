const mongoose = require('mongoose');
const Category = require('../../models/Category');
const Service = require('../../models/UserService');
const Review = require('../../models/Review');
const Settings = require('../../models/Settings');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
// Registered so Review.populate('userId') resolves; see ../../models/index.js.
require('../../models/User');

/**
 * Read-only endpoints for the super app's customer Services screens (/services).
 *
 * The catalogue endpoints next door (catalogController) list categories, brands
 * and services, but the customer app also needs two things they never offered:
 * one service with its ratings, and who actually does the work in a category.
 * Both are public -- a signed-out customer browses before logging in -- so both
 * return only what a listing page shows: no phone, email, address or documents.
 */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && /^[a-f0-9]{24}$/i.test(String(v));

// A reviewer is shown by first name only; the rest of a customer's name is theirs.
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Customer';

/**
 * GET /public/services/:id
 * One bookable service, its brand and category, and what customers said about it.
 */
const getPublicServiceDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isId(id)) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const service = await Service.findOne({ _id: id, status: 'active' })
      .populate('brandId', 'title iconUrl categoryIds')
      .populate('categoryId', 'title slug homeIconUrl')
      .lean();
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // Hidden or deleted reviews are an admin's decision and stay out of the page.
    const match = { serviceId: service._id, status: 'active' };
    const [summaryRows, recent] = await Promise.all([
      Review.aggregate([
        { $match: match },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ]),
      Review.find(match)
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name')
        .select('rating review images createdAt userId')
        .lean()
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    for (const row of summaryRows) {
      const stars = Math.round(Number(row._id) || 0);
      if (stars < 1 || stars > 5) continue;
      distribution[stars] += row.count;
      total += row.count;
      sum += stars * row.count;
    }

    // A service saved without a category inherits its brand's first one, which is
    // how the booking controller resolves it too.
    let category = service.categoryId && typeof service.categoryId === 'object' ? service.categoryId : null;
    if (!category && service.brandId?.categoryIds?.[0]) {
      category = await Category.findById(service.brandId.categoryIds[0]).select('title slug homeIconUrl').lean();
    }

    res.status(200).json({
      success: true,
      service: {
        id: service._id.toString(),
        title: service.title,
        description: service.description || '',
        icon: service.iconUrl || '',
        basePrice: service.basePrice || 0,
        gstPercentage: service.gstPercentage ?? 18,
        pricingUnit: service.pricingUnit || '',
        brandId: service.brandId?._id?.toString() || null,
        brandName: service.brandId?.title || '',
        brandIcon: service.brandId?.iconUrl || '',
        category: category
          ? { id: category._id.toString(), title: category.title, slug: category.slug, icon: category.homeIconUrl || '' }
          : null
      },
      rating: {
        average: total ? Math.round((sum / total) * 10) / 10 : 0,
        total,
        distribution
      },
      reviews: recent.map((r) => ({
        id: r._id.toString(),
        rating: r.rating,
        review: r.review || '',
        images: r.images || [],
        createdAt: r.createdAt,
        author: firstName(r.userId?.name)
      }))
    });
  } catch (error) {
    console.error('Get public service detail error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch service' });
  }
};

/**
 * GET /public/providers?categoryId=&limit=
 *
 * The professionals who take jobs in a category. Bookings here are dispatched,
 * not picked -- the nearest free partner accepts -- so this is the customer's
 * view of who may come, not a choice. It follows the same bookingModel setting
 * the booking controller does: workers in worker mode, vendors otherwise.
 */
const getPublicProviders = async (req, res) => {
  try {
    const { categoryId } = req.query;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    let categoryTitle = null;
    if (categoryId) {
      if (!isId(categoryId)) return res.status(200).json({ success: true, providers: [] });
      const category = await Category.findById(categoryId).select('title').lean();
      if (!category) return res.status(200).json({ success: true, providers: [] });
      categoryTitle = category.title;
    }

    const settings = await Settings.findOne({ type: 'global' }).select('bookingModel').lean();
    const bookingModel = settings?.bookingModel || 'worker';

    let rows;
    if (bookingModel === 'worker') {
      const query = { approvalStatus: 'approved', isActive: true };
      if (categoryTitle) query.serviceCategories = { $in: [categoryTitle] };
      rows = await Worker.find(query)
        .select('name profilePhoto rating totalReviews completedJobs address.city isOnline serviceCategories')
        .sort({ rating: -1, completedJobs: -1 })
        .limit(limit)
        .lean();
    } else {
      const query = { approvalStatus: 'approved', isActive: true };
      if (categoryTitle) query.$or = [{ service: categoryTitle }, { categories: categoryTitle }];
      rows = await Vendor.find(query)
        .select('name businessName profilePhoto rating totalReviews completedJobs address.city isOnline service categories')
        .sort({ rating: -1, completedJobs: -1 })
        .limit(limit)
        .lean();
    }

    res.status(200).json({
      success: true,
      bookingModel,
      providers: rows.map((p) => ({
        id: p._id.toString(),
        name: p.businessName || p.name || 'Professional',
        photo: p.profilePhoto || '',
        rating: Number(p.rating) || 0,
        totalReviews: Number(p.totalReviews) || 0,
        completedJobs: Number(p.completedJobs) || 0,
        city: p.address?.city || '',
        isOnline: Boolean(p.isOnline),
        skills: [...new Set([...(p.serviceCategories || []), ...(p.service || []), ...(p.categories || [])])].slice(0, 6)
      }))
    });
  } catch (error) {
    console.error('Get public providers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch professionals' });
  }
};

module.exports = { getPublicServiceDetail, getPublicProviders };
