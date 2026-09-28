const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const broadcastService = require('../../services/broadcastService');

/*
 * Push broadcasts from the Services admin (Notifications > Broadcast).
 * Same paths as the Food and Quick admins (/admin/notifications/broadcast), so
 * the Master broadcast screen can call every service the same way.
 */

router.post('/notifications/broadcast', authenticate, isAdmin, async (req, res) => {
  try {
    const { title, message, link } = req.body || {};
    // `audiences` is the Services name; `targetType` is what Food and Quick take
    // (ALL | USER | ...), accepted so one caller can address every service.
    const byTarget = { ALL: 'all', USER: 'customers', CUSTOMER: 'customers', VENDOR: 'vendors', WORKER: 'workers' };
    const audiences = req.body?.audiences
      ?? byTarget[String(req.body?.targetType || '').toUpperCase()]
      ?? 'all';
    const { broadcast } = await broadcastService.createBroadcast({
      title,
      message,
      link,
      audiences,
      sentBy: mongoose.Types.ObjectId.isValid(req.user?.id) ? req.user.id : null
    });
    res.status(202).json({ success: true, message: 'Broadcast is being sent', data: broadcast });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

router.get('/notifications/broadcast', authenticate, isAdmin, async (req, res) => {
  try {
    const data = await broadcastService.listBroadcasts(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

router.delete('/notifications/broadcast/:id', authenticate, isAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Broadcast not found' });
    }
    const removed = await broadcastService.deleteBroadcast(req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'Broadcast not found' });
    res.status(200).json({ success: true, message: 'Removed from history' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

module.exports = router;
