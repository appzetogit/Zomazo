import mongoose from 'mongoose';
import * as adminService from '../services/admin.service.js';
import * as featureSettingsService from '../services/featureSettings.service.js';
import { validateCategoryListQuery, validateCategoryRejectDto, validateCategoryUpsertDto } from '../validators/category.validator.js';
import { validateCreateOfferDto, validateUpdateOfferCartVisibilityDto } from '../validators/offer.validator.js';
import { validateAddDeliveryBonusDto } from '../validators/deliveryBonus.validator.js';
import { validateCheckCompletionsDto, validateEarningAddonHistoryActionDto, validateEarningAddonUpsertDto, validateToggleEarningAddonStatusDto } from '../validators/earningAddon.validator.js';
import { validateDeliveryCommissionRuleDto, validateOptionalStatusDto, validateSellerCommissionUpsertDto } from '../validators/commission.validator.js';
import { validateFeeSettingsUpsertDto } from '../validators/feeSettings.validator.js';
import { validateFulfilmentModeQuery } from '../validators/adminPanel.validator.js';
import { validateDeliveryEmergencyHelpUpsertDto } from '../validators/deliveryEmergencyHelp.validator.js';
import { validateReferralSettingsUpsertDto } from '../validators/referralSettings.validator.js';
import { ADMIN_ACTIONS, ADMIN_PERMISSION_SECTIONS, sanitizeAdminPermissions } from '../../../../constants/permissions.js';
import {
    deassignAndResendEmergencyOrder,
    deassignAndResendOrderAdmin,
    getOrderEmergencyRequestAdmin,
    listOrderEmergencyRequestsAdmin,
    updateOrderEmergencyRequestAdmin
} from '../../delivery/services/orderEmergencyRequest.service.js';
import { config } from '../../../../config/env.js';

// ----- Customers / Users -----
export async function getCustomers(req, res, next) {
    try {
        const data = await adminService.getCustomers(req.query || {});
        res.status(200).json({ success: true, message: 'Customers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCustomerById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await adminService.getCustomerById(id);
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer fetched successfully', data: { user: customer, customer } });
    } catch (error) {
        next(error);
    }
}

export async function updateCustomerStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const isActive = req.body?.isActive;
        const updated = await adminService.updateCustomerStatus(id, isActive);
        if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer status updated successfully', data: { user: updated, customer: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Safety / Emergency Reports -----
export async function getSafetyEmergencyReports(req, res, next) {
    try {
        const data = await adminService.getSafetyEmergencyReports(req.query || {});
        res.status(200).json({ success: true, message: 'Safety emergency reports fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyStatus(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyStatus(id, req.body?.status);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyPriority(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyPriority(id, req.body?.priority);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Priority updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSafetyEmergencyReport(req, res, next) {
    try {
        const { id } = req.params;
        const deleted = await adminService.deleteSafetyEmergencyReport(id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Safety emergency report deleted successfully', data: { report: deleted } });
    } catch (error) {
        next(error);
    }
}

export async function getOrderEmergencyRequests(req, res, next) {
    try {
        const data = await listOrderEmergencyRequestsAdmin(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Order reassignment requests fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function updateOrderEmergencyRequest(req, res, next) {
    try {
        const request = await updateOrderEmergencyRequestAdmin(
            req.params.id,
            req.body || {}
        );
        res.status(200).json({
            success: true,
            message: 'Order reassignment request updated successfully',
            data: { request }
        });
    } catch (error) {
        next(error);
    }
}

export async function getOrderEmergencyRequest(req, res, next) {
    try {
        const request = await getOrderEmergencyRequestAdmin(req.params.id);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Order reassignment request not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Order reassignment request fetched successfully',
            data: { request }
        });
    } catch (error) {
        next(error);
    }
}

export async function deassignAndResendOrderEmergencyRequest(req, res, next) {
    try {
        const result = await deassignAndResendEmergencyOrder(
            req.params.id,
            req.user?.userId
        );
        res.status(200).json({
            success: true,
            message: result.alreadyResolved
                ? 'Order reassignment was already completed'
                : 'Delivery partner deassigned and order dispatch restarted',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function deassignAndResendOrder(req, res, next) {
    try {
        const result = await deassignAndResendOrderAdmin(
            req.params.orderId,
            req.user?.userId
        );
        res.status(200).json({
            success: true,
            message: 'Delivery partner deassigned and order dispatch restarted',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerComplaint(req, res, next) {
    try {
        const { id } = req.params;
        const { status, adminResponse } = req.body;
        const updated = await adminService.updateSellerComplaint(id, { status, adminResponse });
        res.status(200).json({ success: true, message: 'Complaint updated successfully', data: { complaint: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Sellers -----
export async function getSellerComplaints(req, res, next) {
    try {
        const data = await adminService.getSellerComplaints(req.query || {});
        res.status(200).json({ success: true, message: 'Store complaints fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSellerComplaintStatsController(req, res, next) {
    try {
        const data = await adminService.getSellerComplaintStats(req.query || {});
        res.status(200).json({ success: true, message: 'Store complaint stats fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function globalSearch(req, res, next) {
    try {
        const { query } = req.query;
        const data = await adminService.globalSearch(query);
        res.status(200).json({
            success: true,
            message: 'Global search results fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSellers(req, res, next) {
    try {
        const data = await adminService.getSellers(req.query);
        res.status(200).json({
            success: true,
            message: 'Stores fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSellerReport(req, res, next) {
    try {
        const data = await adminService.getSellerReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Store report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDashboardStats(req, res, next) {
    try {
        const fulfilmentMode = validateFulfilmentModeQuery(req.query);
        const data = await adminService.getDashboardStats({ ...(req.query || {}), fulfilmentMode });
        res.status(200).json({
            success: true,
            message: 'Dashboard stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTransactionReport(req, res, next) {
    try {
        const data = await adminService.getTransactionReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Transaction report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

const ensureSuperAdmin = (req, res) => {
    const adminType = req.adminAccess?.adminType || req.user?.adminType;
    if (adminType && adminType !== 'super_admin') {
        res.status(403).json({ success: false, message: 'Only super admin can perform this action' });
        return false;
    }
    return true;
};

const normalizePermissionPayload = (permissions) => sanitizeAdminPermissions(permissions || {});

export async function createSubAdmin(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const created = await adminService.createSubAdmin(req.body || {}, req.user?.userId);
        res.status(201).json({ success: true, message: 'Sub-admin created successfully', data: { subAdmin: created } });
    } catch (error) {
        next(error);
    }
}

export async function listSubAdmins(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = await adminService.getSubAdmins(req.query || {});
        res.status(200).json({ success: true, message: 'Sub-admins fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSubAdminDetails(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = await adminService.getSubAdminById(req.params.id);
        res.status(200).json({ success: true, message: 'Sub-admin fetched successfully', data: { subAdmin: data } });
    } catch (error) {
        next(error);
    }
}

export async function updateSubAdminProfile(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = await adminService.updateSubAdminProfile(req.params.id, req.body || {}, req.user?.userId);
        res.status(200).json({ success: true, message: 'Sub-admin profile updated', data: { subAdmin: data } });
    } catch (error) {
        next(error);
    }
}

export async function updateSubAdminPermissions(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const normalized = normalizePermissionPayload(req.body?.permissions || {});
        const data = await adminService.updateSubAdminPermissions(req.params.id, normalized, req.user?.userId);
        res.status(200).json({ success: true, message: 'Sub-admin permissions updated', data: { subAdmin: data } });
    } catch (error) {
        next(error);
    }
}

export async function updateSubAdminStatus(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = await adminService.updateSubAdminStatus(req.params.id, req.body?.isActive, req.user?.userId);
        res.status(200).json({ success: true, message: 'Sub-admin status updated', data: { subAdmin: data } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSubAdmin(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = await adminService.deleteSubAdmin(req.params.id, req.user?.userId);
        res.status(200).json({ success: true, message: 'Sub-admin deleted successfully', data: { subAdmin: data } });
    } catch (error) {
        next(error);
    }
}

export async function getAdminPermissionCatalog(req, res, next) {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const data = adminService.getAdminPermissionCatalog();
        const visibleActions = ADMIN_ACTIONS.filter((action) => action !== 'export');
        const sections = Array.isArray(data?.sections)
            ? data.sections.map((section) => ({
                  ...section,
                  actions: Array.isArray(section?.actions)
                      ? section.actions.filter((action) => action !== 'export')
                      : visibleActions,
              }))
            : [];
        res.status(200).json({
            success: true,
            message: 'Permission catalog fetched successfully',
            data: {
                actions: visibleActions,
                sections,
                supportedSections: ADMIN_PERMISSION_SECTIONS,
            },
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReport(req, res, next) {
    try {
        const data = await adminService.getTaxReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReportDetail(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.getTaxReportDetail(id, req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report detail fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSellerReviews(req, res, next) {
    try {
        const data = await adminService.getSellerReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Store reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSellerById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const seller = await adminService.getSellerById(id);
        if (!seller) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Store fetched successfully',
            data: seller
        });
    } catch (error) {
        next(error);
    }
}

export async function getSellerAnalytics(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const data = await adminService.getSellerAnalytics(id);
        if (!data) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Store analytics fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const updated = await adminService.updateSellerById(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({ success: true, message: 'Store updated successfully', data: { seller: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const updated = await adminService.updateSellerStatus(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({ success: true, message: 'Store status updated successfully', data: { seller: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerLocation(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const updated = await adminService.updateSellerLocation(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({ success: true, message: 'Store location updated successfully', data: { seller: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSeller(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid store id' });
        }
        const result = await adminService.deleteSeller(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        res.status(200).json({ success: true, message: 'Store deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

// ----- Products -----
export async function getProducts(req, res, next) {
    try {
        const fulfilmentMode = validateFulfilmentModeQuery(req.query);
        const data = await adminService.getProducts({ ...(req.query || {}), fulfilmentMode });
        res.status(200).json({ success: true, message: 'Products fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createProduct(req, res, next) {
    try {
        const created = await adminService.createProduct(req.body || {});
        res.status(201).json({ success: true, message: 'Product created successfully', data: { product: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateProduct(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }
        const updated = await adminService.updateProduct(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, message: 'Product updated successfully', data: { product: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteProduct(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }
        const result = await adminService.deleteProduct(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        res.status(200).json({ success: true, message: 'Product deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

// ----- Categories -----
export async function getCategories(req, res, next) {
    try {
        const query = validateCategoryListQuery(req.query || {});
        const data = await adminService.getCategories(query);
        res.status(200).json({ success: true, message: 'Categories fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createCategory(req, res, next) {
    try {
        const body = validateCategoryUpsertDto(req.body || {});
        const created = await adminService.createCategory(body);
        res.status(201).json({ success: true, message: 'Category created successfully', data: { category: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryUpsertDto(req.body || {});
        const updated = await adminService.updateCategory(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const result = await adminService.deleteCategory(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleCategoryStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.toggleCategoryStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category status updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function approveCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.approveCategory(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found or already approved' });
        }
        res.status(200).json({ success: true, message: 'Category approved successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function rejectCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryRejectDto(req.body || {});
        const updated = await adminService.rejectCategory(id, body.reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category rejected successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function makeCategoryGlobal(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.makeCategoryGlobal(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category is now global', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Offers & Coupons -----
export async function getAllOffers(req, res, next) {
    try {
        const data = await adminService.getAllOffers(req.query || {});
        res.status(200).json({ success: true, message: 'Offers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createAdminOffer(req, res, next) {
    try {
        const body = validateCreateOfferDto(req.body || {});
        const created = await adminService.createAdminOffer(body);
        res.status(201).json({ success: true, message: 'Offer created successfully', data: { offer: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateAdminOfferCartVisibility(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const body = validateUpdateOfferCartVisibilityDto(req.body || {});
        const updated = await adminService.updateAdminOfferCartVisibility(id, body.itemId, body.showInCart);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer updated successfully', data: { offer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteAdminOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const result = await adminService.deleteAdminOffer(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTicketsController(req, res, next) {
    try {
        const data = await adminService.getSupportTickets(req.query || {});
        res.status(200).json({ success: true, message: 'Support tickets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getUserSupportTicketStatsController(req, res, next) {
    try {
        const data = await adminService.getUserSupportTicketStats(req.query || {});
        res.status(200).json({ success: true, message: 'Support ticket stats fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicketController(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket id' });
        }
        const updated = await adminService.updateSupportTicket(id, req.body || {});
        if (!updated) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.status(200).json({ success: true, message: 'Support ticket updated successfully', data: { ticket: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getPendingSellers(req, res, next) {
    try {
        const pending = await adminService.getPendingSellers();
        res.status(200).json({
            success: true,
            message: 'Pending stores fetched successfully',
            data: pending
        });
    } catch (error) {
        next(error);
    }
}

export async function getUnregisteredSellers(req, res, next) {
    try {
        const list = await adminService.getUnregisteredSellers();
        res.status(200).json({
            success: true,
            message: 'Unregistered stores fetched successfully',
            data: list
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteUnregisteredSeller(req, res, next) {
    try {
        const { id } = req.params;
        const result = await adminService.deleteUnregisteredSeller(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Unregistered store not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Unregistered store deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partner bonus (admin) -----
export async function getDeliveryPartnerBonusTransactions(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartnerBonusTransactions(req.query || {});
        res.status(200).json({ success: true, message: 'Bonus transactions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function addDeliveryPartnerBonus(req, res, next) {
    try {
        const body = validateAddDeliveryBonusDto(req.body || {});
        const created = await adminService.addDeliveryPartnerBonus(body, req.user);
        res.status(201).json({ success: true, message: 'Bonus added successfully', data: { transaction: created } });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryEarnings(req, res, next) {
    try {
        const data = await adminService.getDeliveryEarnings(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery earnings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Earning Addon (admin) -----
export async function getEarningAddons(req, res, next) {
    try {
        const data = await adminService.getEarningAddons();
        res.status(200).json({ success: true, message: 'Earning addons fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createEarningAddon(req, res, next) {
    try {
        const body = validateEarningAddonUpsertDto(req.body || {});
        const created = await adminService.createEarningAddon(body);
        res.status(201).json({ success: true, message: 'Earning addon created successfully', data: { earningAddon: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const body = validateEarningAddonUpsertDto(req.body || {});
        const updated = await adminService.updateEarningAddon(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const result = await adminService.deleteEarningAddon(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleEarningAddonStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const { status } = validateToggleEarningAddonStatusDto(req.body || {});
        const updated = await adminService.toggleEarningAddonStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getEarningAddonHistory(req, res, next) {
    try {
        const data = await adminService.getEarningAddonHistory(req.query || {});
        res.status(200).json({ success: true, message: 'Earning addon history fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function creditEarningToWallet(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { notes } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.creditEarningAddonHistory(id, notes);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning credited successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function cancelEarningAddonHistory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { reason } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.cancelEarningAddonHistory(id, reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning cancelled successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function checkEarningAddonCompletions(req, res, next) {
    try {
        const { deliveryPartnerId, force } = validateCheckCompletionsDto(req.body || {});
        const data = await adminService.checkEarningAddonCompletions(deliveryPartnerId, force);
        res.status(200).json({ success: true, message: 'Completion check done', data });
    } catch (error) {
        next(error);
    }
}

// ----- Seller Commission (admin) -----
export async function getSellerCommissions(req, res, next) {
    try {
        const data = await adminService.getSellerCommissions();
        res.status(200).json({ success: true, message: 'Store commissions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSellerCommissionBootstrap(req, res, next) {
    try {
        const data = await adminService.getSellerCommissionBootstrap();
        res.status(200).json({ success: true, message: 'Store commission bootstrap fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSellerCommissionById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const commission = await adminService.getSellerCommissionById(id);
        if (!commission) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission fetched successfully', data: { commission } });
    } catch (error) {
        next(error);
    }
}

export async function createSellerCommission(req, res, next) {
    try {
        const body = validateSellerCommissionUpsertDto(req.body || {});
        const created = await adminService.createSellerCommission(body);
        res.status(201).json({ success: true, message: 'Commission created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateSellerCommissionUpsertDto(req.body || {});
        const updated = await adminService.updateSellerCommission(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSellerCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteSellerCommission(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleSellerCommissionStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const updated = await adminService.toggleSellerCommissionStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery commission rules (admin) -----
export async function getDeliveryCommissionRules(req, res, next) {
    try {
        const data = await adminService.getDeliveryCommissionRules();
        res.status(200).json({ success: true, message: 'Commission rules fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createDeliveryCommissionRule(req, res, next) {
    try {
        const body = validateDeliveryCommissionRuleDto(req.body || {});
        const created = await adminService.createDeliveryCommissionRule(body);
        res.status(201).json({ success: true, message: 'Commission rule created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateDeliveryCommissionRuleDto(req.body || {});
        const updated = await adminService.updateDeliveryCommissionRule(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteDeliveryCommissionRule(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleDeliveryCommissionRuleStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const { status } = validateOptionalStatusDto(req.body || {});
        if (typeof status !== 'boolean') {
            return res.status(400).json({ success: false, message: 'status is required' });
        }
        const updated = await adminService.toggleDeliveryCommissionRuleStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Fee Settings (admin) -----
export async function getFeeSettings(req, res, next) {
    try {
        const data = await adminService.getFeeSettings();
        res.status(200).json({ success: true, message: 'Fee settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateFeeSettings(req, res, next) {
    try {
        console.log('[DEBUG] req.body:', JSON.stringify(req.body, null, 2));
        const body = validateFeeSettingsUpsertDto(req.body || {});
        const feeSettings = await adminService.upsertFeeSettings(body);
        res.status(200).json({ success: true, message: 'Fee settings saved successfully', data: { feeSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Referral Settings (admin) -----
export async function getReferralSettings(req, res, next) {
    try {
        const data = await adminService.getReferralSettings();
        res.status(200).json({ success: true, message: 'Referral settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateReferralSettings(req, res, next) {
    try {
        const body = validateReferralSettingsUpsertDto(req.body || {});
        const referralSettings = await adminService.upsertReferralSettings(body);
        res.status(200).json({ success: true, message: 'Referral settings saved successfully', data: { referralSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Cash Limit (admin) -----
export async function getDeliveryCashLimit(req, res, next) {
    try {
        const data = await adminService.getDeliveryCashLimitSettings();
        res.status(200).json({ success: true, message: 'Delivery cash limit fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCashLimit(req, res, next) {
    try {
        const data = await adminService.upsertDeliveryCashLimitSettings(req.body || {});
        res.status(200).json({ success: true, message: 'Delivery cash limit updated successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Emergency Help (admin) -----
export async function getEmergencyHelp(req, res, next) {
    try {
        const data = await adminService.getDeliveryEmergencyHelp();
        res.status(200).json({ success: true, message: 'Emergency help fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateEmergencyHelp(req, res, next) {
    try {
        const body = validateDeliveryEmergencyHelpUpsertDto(req.body || {});
        const data = await adminService.upsertDeliveryEmergencyHelp(body);
        res.status(200).json({ success: true, message: 'Emergency help saved successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function approveSeller(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid store id'
            });
        }
        const seller = await adminService.approveSeller(id);
        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Store approved successfully',
            data: seller
        });
    } catch (error) {
        next(error);
    }
}

export async function createSeller(req, res, next) {
    try {
        const seller = await adminService.createSellerByAdmin(req.body || {});
        res.status(201).json({
            success: true,
            message: 'Store created successfully',
            data: seller
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectSeller(req, res, next) {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid store id'
            });
        }
        const seller = await adminService.rejectSeller(id, reason);
        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Store rejected successfully',
            data: seller
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery join requests -----
export async function getDeliveryJoinRequests(req, res, next) {
    try {
        const data = await adminService.getDeliveryJoinRequests(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery join requests fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}


// ----- Support tickets -----
export async function getSupportTicketStats(req, res, next) {
    try {
        const data = await adminService.getSupportTicketStats();
        res.status(200).json({
            success: true,
            message: 'Support ticket stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTickets(req, res, next) {
    try {
        const data = await adminService.getDeliverySupportTickets(req.query);
        res.status(200).json({
            success: true,
            message: 'Support tickets fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicket(req, res, next) {
    try {
        const ticket = await adminService.updateDeliverySupportTicket(req.params.id, req.body);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Support ticket not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Support ticket updated successfully',
            data: ticket
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partners -----
export async function getDeliveryPartners(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartners(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery partners fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliverymanReviews(req, res, next) {
    try {
        const data = await adminService.getDeliverymanReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Deliveryman reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getContactMessages(req, res, next) {
    try {
        const data = await adminService.getContactMessages(req.query);
        res.status(200).json({
            success: true,
            message: 'Contact messages fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryPartnerById(req, res, next) {
    try {
        const delivery = await adminService.getDeliveryPartnerById(req.params.id);
        if (!delivery) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner fetched successfully',
            data: { delivery }
        });
    } catch (error) {
        next(error);
    }
}

export async function approveDeliveryPartner(req, res, next) {
    try {
        const partner = await adminService.approveDeliveryPartner(req.params.id);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner approved successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectDeliveryPartner(req, res, next) {
    try {
        const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
        const partner = await adminService.rejectDeliveryPartner(req.params.id, reason);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner rejected successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

// ----- Zones -----
export async function getZones(req, res, next) {
    try {
        const data = await adminService.getZones(req.query);
        res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getZoneById(req, res, next) {
    try {
        const zone = await adminService.getZoneById(req.params.id);
        if (!zone) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone fetched successfully',
            data: { zone }
        });
    } catch (error) {
        next(error);
    }
}

export async function createZone(req, res, next) {
    try {
        const result = await adminService.createZone(req.body || {});
        if (result.error) {
            return res.status(400).json({
                success: false,
                message: result.error
            });
        }
        res.status(201).json({
            success: true,
            message: 'Zone created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function updateZone(req, res, next) {
    try {
        const result = await adminService.updateZone(req.params.id, req.body || {});
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }
        res.status(200).json({
            success: true,
            message: 'Zone updated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteZone(req, res, next) {
    try {
        const result = await adminService.deleteZone(req.params.id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function getWithdrawals(req, res, next) {
    try {
        const data = await adminService.getWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWithdrawals(req, res, next) {
    try {
        const data = await adminService.getDeliveryWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateDeliveryWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWallets(req, res, next) {
    try {
        const data = await adminService.getDeliveryWallets(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery wallets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryBoyWallet(req, res, next) {
    try {
        const data = await adminService.updateDeliveryBoyWallet(req.body);
        res.status(200).json({ success: true, message: 'Wallet updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryPartnerProfile(req, res, next) {
    try {
        const { id } = req.params;
        const { name, phone } = req.body || {};
        const data = await adminService.updateDeliveryPartnerProfile(id, { name, phone });
        res.status(200).json({
            success: true,
            message: 'Delivery partner updated successfully',
            data,
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteDeliveryPartner(req, res, next) {
    try {
        const { id } = req.params;
        await adminService.deleteDeliveryPartner(id);
        res.status(200).json({ success: true, message: 'Delivery partner deactivated successfully' });
    } catch (error) {
        next(error);
    }
}

export async function getCashLimitSettlements(req, res, next) {
    try {
        const data = await adminService.getCashLimitSettlements(req.query || {});
        res.status(200).json({ success: true, message: 'Cash limit settlements fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSidebarBadges(req, res, next) {
    try {
        const fulfilmentMode = validateFulfilmentModeQuery(req.query);
        const counts = await adminService.getSidebarBadges({ fulfilmentMode });
        res.status(200).json({ success: true, counts });
    } catch (error) {
        next(error);
    }
}

export async function getExpiredFssaiNotifications(req, res, next) {
    try {
        const { listExpiredFssaiSellers } = await import('../../seller/services/fssaiExpiry.service.js');
        const items = await listExpiredFssaiSellers();
        res.status(200).json({
            success: true,
            message: 'Expired FSSAI notifications fetched successfully',
            data: { items }
        });
    } catch (error) {
        next(error);
    }
}
export async function bulkApproveProducts(req, res, next) {
    try {
        const { sellerId, productIds, channel } = req.body || {};
        const result = await adminService.bulkApproveProducts({ sellerId, productIds, channel });
        res.status(200).json({
            success: true,
            message: `Approved ${result.modifiedCount} product${result.modifiedCount === 1 ? '' : 's'}`,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function bulkDeleteProducts(req, res, next) {
    try {
        const { sellerId, productIds, selectAll, search } = req.body || {};
        const result = await adminService.bulkDeleteProducts({
            sellerId,
            productIds,
            selectAll: selectAll === true,
            search,
        });
        res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} item(s)`,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}

// ----- Subscription Settings -----
export async function getSellerSubscriptionSettings(req, res, next) {
    try {
        const data = await adminService.getSellerSubscriptionSettings();
        res.status(200).json({ success: true, message: 'Subscription settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSellerSubscriptionSettings(req, res, next) {
    try {
        const data = await adminService.updateSellerSubscriptionSettings(req.body);
        res.status(200).json({ success: true, message: 'Subscription settings updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSellerSubscriptionHistory(req, res, next) {
    try {
        const data = await adminService.getAdminSellerSubscriptionHistory(req.query || {});
        res.status(200).json({ success: true, message: 'Store subscription history fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Feature Settings -----
export async function getFeatureSettings(req, res, next) {
    try {
        const data = await featureSettingsService.listFeatureSettings();
        res.status(200).json({ success: true, message: 'Feature settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateFeatureSetting(req, res, next) {
    try {
        const key = req.params?.key;
        const data = await featureSettingsService.updateFeatureSetting(key, req.body || {});
        if (!data) {
            return res.status(404).json({ success: false, message: 'Feature not found' });
        }
        res.status(200).json({ success: true, message: 'Feature setting updated successfully', data });
    } catch (error) {
        next(error);
    }
}

/** PATCH /admin/sellers/:id/channels/:channel — { action: 'approve'|'reject', reason? }. */
export async function decideSellerChannel(req, res, next) {
    try {
        const { decideSellerChannel: decide } = await import('../../seller/services/sellerChannels.service.js');
        const seller = await decide(req.params.id, req.params.channel, req.body || {});
        return res.status(200).json({ success: true, message: 'Channel updated', data: seller });
    } catch (error) {
        next(error);
    }
}
