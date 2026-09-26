import { sendResponse, sendError } from '../../../../utils/response.js';
import { generateBulkMenuTemplate, processBulkMenuUpload } from '../services/bulkUpload.service.js';
import fs from 'fs';

export const downloadBulkMenuTemplateController = async (req, res, next) => {
    try {
        const workbook = await generateBulkMenuTemplate();
        
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=Bulk_Menu_Template.xlsx'
        );

        return workbook.xlsx.write(res).then(() => {
            res.status(200).end();
        });
    } catch (error) {
        next(error);
    }
};

export const uploadBulkMenuController = async (req, res, next) => {
    try {
        if (!req.file) {
            return sendError(res, 400, 'Please upload an Excel file (.xlsx)');
        }

        const sellerId = req.user?.userId;
        const results = await processBulkMenuUpload(sellerId, req.file.buffer);

        return sendResponse(res, 200, 'Bulk upload completed', results);
    } catch (error) {
        next(error);
    }
};

export const uploadAdminBulkMenuController = async (req, res, next) => {
    try {
        if (!req.file) {
            return sendError(res, 400, 'Please upload an Excel file (.xlsx)');
        }

        const sellerId = req.body?.sellerId;
        if (!sellerId) {
            return sendError(res, 400, 'sellerId is required');
        }

        const results = await processBulkMenuUpload(sellerId, req.file.buffer, {
            approvalStatus: 'approved',
        });

        return sendResponse(res, 200, 'Bulk upload completed', results);
    } catch (error) {
        next(error);
    }
};
