import { sendResponse } from '../../../../utils/response.js';
import * as attributes from '../services/attribute.service.js';

const handle = (fn, status = 200, message = 'OK') => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (error) {
        return next(error);
    }
};

// Admin
export const listAttributesController = handle(async () => ({ attributes: await attributes.listAttributes() }));
export const createAttributeController = handle(
    async (req) => ({ attribute: await attributes.createAttribute(req.body) }), 201, 'Attribute created');
export const updateAttributeController = handle(
    async (req) => ({ attribute: await attributes.updateAttribute(req.params.id, req.body) }), 200, 'Attribute updated');
export const deleteAttributeController = handle(
    async (req) => attributes.deleteAttribute(req.params.id), 200, 'Attribute deleted');

export const listAttributeSetsController = handle(async () => ({ attributeSets: await attributes.listAttributeSets() }));
export const createAttributeSetController = handle(
    async (req) => ({ attributeSet: await attributes.createAttributeSet(req.body) }), 201, 'Attribute set created');
export const updateAttributeSetController = handle(
    async (req) => ({ attributeSet: await attributes.updateAttributeSet(req.params.id, req.body) }), 200, 'Attribute set updated');
export const deleteAttributeSetController = handle(
    async (req) => attributes.deleteAttributeSet(req.params.id), 200, 'Attribute set deleted');

// Public: what filters to offer, and what a category's products vary by.
export const listPublicAttributesController = handle(async () => ({
    attributes: (await attributes.listAttributes({ activeOnly: true })).filter((a) => a.isFilterable !== false),
}));
export const getCategoryAttributesController = handle(async (req) => attributes.getCategoryAttributes(req.params.id));
