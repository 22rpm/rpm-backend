// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authMiddleware,authRequired } = require("../middleware/auth");
const { resolveOrgScope } = require("../middleware/orgScope");

router.use(authRequired); 
// router.use(authMiddleware); 

router.post('/send', messageController.sendMessage);
router.get('/conversations', messageController.getUserConversations);
router.get('/conversation/:userId', messageController.getConversation);
router.get('/clinicians', messageController.getClinicians);

//patient route
// resolveOrgScope so org-wide roles (admin/care_manager) get the org's patient
// list; super-admin's org comes from ?organizationId (frontend appends it).
router.get('/patients', resolveOrgScope, messageController.getPatients);


module.exports = router;