// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authMiddleware,authRequired } = require("../middleware/auth");

// Public webhook — Twilio can't authenticate; validated by SID lookup in our log.
router.post('/notifications/twilio-status', messageController.twilioStatusCallback);

router.use(authRequired);
// router.use(authMiddleware);

router.post('/send', messageController.sendMessage);
router.get('/conversations', messageController.getUserConversations);

// Clinician-side (assignment + active gated)
router.get('/inbox', messageController.getClinicianInbox);
router.get('/unread-count', messageController.getUnreadCount);
router.get('/conversation/:userId', messageController.getConversation);
router.get('/clinicians', messageController.getClinicians);

//patient route
router.get('/patients', messageController.getPatients);

// Physician notification preferences + dashboard failure indicator (authed)
router.get('/notification-preferences', messageController.getNotificationPrefs);
router.put('/notification-preferences', messageController.updateNotificationPrefs);
router.get('/notification-failures', messageController.getNotificationFailures);


module.exports = router;