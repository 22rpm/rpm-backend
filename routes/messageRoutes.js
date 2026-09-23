// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authMiddleware, authRequired, requireRole } = require("../middleware/auth");
const { resolveOrgScope, scopePatientParam } = require("../middleware/orgScope");
const { CLINICAL_STAFF } = require("../config/roles");

router.use(authRequired);
// router.use(authMiddleware);

// STAFF: the care-team-shared Messages inbox. Org-scoped (super-admin's selected
// org via ?organizationId); visibility is org-wide for admin/care_manager/super-admin
// and assignment-scoped for clinicians (enforced in the service).
const STAFF = requireRole(...CLINICAL_STAFF);
router.get('/inbox', STAFF, resolveOrgScope, messageController.getInbox);
router.get('/unread-count', STAFF, resolveOrgScope, messageController.getUnreadCount);
router.get('/thread/:patientId', STAFF, resolveOrgScope, messageController.getPatientThread);

// Flag-gated outbound clinical SMS. STAFF + org boundary (resolveOrgScope +
// scopePatientParam) at the route; notification.sendClinicalMessage runs the full gate
// (flag, canSend, consent, opt-out, hard-disable) server-side before any Twilio call.
router.post(
  '/:patientId/clinical-sms',
  STAFF,
  resolveOrgScope,
  scopePatientParam('patientId'),
  messageController.sendClinicalSms
);

router.post('/send', messageController.sendMessage);
router.get('/conversations', messageController.getUserConversations);
router.get('/conversation/:userId', messageController.getConversation);
router.get('/clinicians', messageController.getClinicians);

//patient route
// resolveOrgScope so org-wide roles (admin/care_manager) get the org's patient
// list; super-admin's org comes from ?organizationId (frontend appends it).
router.get('/patients', resolveOrgScope, messageController.getPatients);


module.exports = router;