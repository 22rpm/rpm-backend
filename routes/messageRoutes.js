// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authMiddleware } = require("../middleware/auth");

router.use(authMiddleware); 

router.post('/send', messageController.sendMessage);
router.get('/conversations', messageController.getUserConversations);
router.get('/conversation/:userId', messageController.getConversation);
router.get('/clinicians', messageController.getClinicians);

//patient route
router.get('/patients', messageController.getPatients);


module.exports = router;