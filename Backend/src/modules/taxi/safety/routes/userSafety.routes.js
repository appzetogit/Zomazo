import express from 'express';
import * as userSafetyController from '../controllers/userSafety.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import multer from 'multer';

export const userSafetyRouter = express.Router();

// A driver report carries one photo and one voice/video note. Bounded and typed
// like the other upload routes: this was the one multer with neither, so any
// signed-in user could fill the disk or park any file type on the server.
const SAFETY_MAX_BYTES = 15 * 1024 * 1024;
const SAFETY_TYPES = {
  image: /^image\/(jpeg|jpg|png|webp|heic|heif)$/,
  audio: /^(audio|video)\/[a-z0-9.+-]+$/,
};
const upload = multer({
  dest: 'uploads/safety/',
  limits: { fileSize: SAFETY_MAX_BYTES, files: 2 },
  fileFilter: (_req, file, cb) => {
    const allowed = SAFETY_TYPES[file.fieldname];
    if (allowed && allowed.test(String(file.mimetype || '').toLowerCase())) return cb(null, true);
    const err = new Error(file.fieldname === 'image' ? 'Only JPEG, PNG, WebP or HEIC photos are allowed' : 'Only audio or video recordings are allowed');
    err.statusCode = 400;
    return cb(err);
  },
});
// Exported for tests/taxi-small-holes.smoke.mjs.
export const uploadMiddleware = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]);

userSafetyRouter.use(authMiddleware);

// Trusted Contacts
userSafetyRouter.get('/trusted-contacts', userSafetyController.getTrustedContacts);
userSafetyRouter.post('/trusted-contacts', userSafetyController.addTrustedContact);
userSafetyRouter.put('/trusted-contacts/:id', userSafetyController.updateTrustedContact);
userSafetyRouter.delete('/trusted-contacts/:id', userSafetyController.deleteTrustedContact);

// Emergency & Safety
userSafetyRouter.post('/sos', userSafetyController.triggerSOS);
userSafetyRouter.post('/trip/share', userSafetyController.shareTrip);
userSafetyRouter.post('/driver/report', uploadMiddleware, userSafetyController.reportDriver);
userSafetyRouter.post('/ride-check-response', userSafetyController.submitRideCheck);

// General Safety Info
userSafetyRouter.get('/tips', userSafetyController.getSafetyTips);
userSafetyRouter.get('/settings', userSafetyController.getEmergencySettings);
