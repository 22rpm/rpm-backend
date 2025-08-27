// controllers/messageController.js
const messageService = require('../services/messageService');
const { getIO } = require('../socket/socketServer');

class MessageController {
  async sendMessage(req, res) {
    try {
      const { receiverId, message } = req.body;
      const senderId = req.user.id; // From JWT middleware
      console.log('sendMessage called with:', { senderId, receiverId, message });

      const savedMessage = await messageService.saveMessage(senderId, receiverId, message);

      // Emit through socket
      const io = getIO();
      const roomId = [senderId, receiverId].sort().join('_');
      io.to(roomId).emit('new_message', {
        ...savedMessage,
        senderId,
        receiverId
      });

      res.status(201).json({
        success: true,
        message: 'Message sent successfully',
        data: savedMessage
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: error.message
      });
    }
  }

  async getConversation(req, res) {
    try {
      const { userId } = req.params;
      const currentUserId = req.user.id;
      const limit = req.query.limit || 50;

      const messages = await messageService.getConversation(currentUserId, parseInt(userId), limit);

      // Mark messages as read
      await messageService.markAsRead(currentUserId, parseInt(userId));

      res.json({
        success: true,
        data: messages.reverse() // Show oldest first
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get conversation',
        error: error.message
      });
    }
  }

  async getUserConversations(req, res) {
    try {
      console.log(req.user);
      const userId = req.user.id;
      console.log('Fetching conversations for userId:', userId);
      const conversations = await messageService.getUserConversations(userId);

      res.json({
        success: true,
        data: conversations
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get conversations',
        error: error.message
      });
    }
  }

  async getClinicians(req, res) {
    try {
      const clinicians = await messageService.getCliniciansByPatient(req.user.id);

      res.json({
        success: true,
        data: clinicians
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get clinicians',
        error: error.message
      });
    }
  }
  
  async getPatients(req, res) {
  try {
    const patients = await messageService.getPatients();
    
    // Process health data and add status
    const processedPatients = patients.map(patient => {
      let status = 'Normal';
      let heartRate = 72;
      let lastReading = 'No data';
      
      if (patient.health_data) {
        const healthData = typeof patient.health_data === 'string' 
          ? JSON.parse(patient.health_data) 
          : patient.health_data;
        
        heartRate = healthData.heartRate || 72;
        lastReading = healthData.lastReading || 'No data';
        
        // Determine status based on heart rate
        if (heartRate > 90) {
          status = 'Alert';
        } else if (heartRate < 50 || heartRate > 100) {
          status = 'Critical';
        }
      }
      
      return {
        id: patient.id,
        name: patient.name,
        email: patient.email,
        status,
        heartRate,
        lastReading
      };
    });

    res.json({
      success: true,
      data: processedPatients
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get patients',
      error: error.message
    });
  }
}

}

module.exports = new MessageController();