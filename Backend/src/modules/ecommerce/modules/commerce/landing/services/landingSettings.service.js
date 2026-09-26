import { LandingSettings } from '../models/landingSettings.model.js';

export const getLandingSettings = async () => {
    let doc = await LandingSettings.findOne().lean();
    if (!doc) {
        doc = (await LandingSettings.create({})).toObject();
    }
    return doc;
};

export const updateLandingSettings = async (payload) => {
    const doc = await LandingSettings.findOneAndUpdate({}, payload, {
        new: true,
        upsert: true
    }).lean();
    return doc;
};

