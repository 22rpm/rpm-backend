// services/messageService.js
const db = require("../config/knex")

class MessageService {
  async saveMessage(senderId, receiverId, message) {
    try {
      const [messageId] = await db('messages').insert({
        sender_id: senderId,
        receiver_id: receiverId,
        message: message,
        created_at: new Date(),
        updated_at: new Date()
      });
      
      return await this.getMessageById(messageId);
    } catch (error) {
      throw error;
    }
  }

  async getMessageById(messageId) {
    try {
      return await db('messages')
        .select('messages.*', 'sender.name as sender_name', 'receiver.name as receiver_name')
        .leftJoin('users as sender', 'messages.sender_id', 'sender.id')
        .leftJoin('users as receiver', 'messages.receiver_id', 'receiver.id')
        .where('messages.id', messageId)
        .first();
    } catch (error) {
      console.log(error)
      throw error;
    }
  }

  async getConversation(userId1, userId2, limit = 50) {
    try {
      return await db('messages')
        .select('messages.*', 'sender.name as sender_name')
        .leftJoin('users as sender', 'messages.sender_id', 'sender.id')
        .where(function() {
          this.where({ sender_id: userId1, receiver_id: userId2 })
              .orWhere({ sender_id: userId2, receiver_id: userId1 });
        })
        .orderBy('created_at', 'desc')
        .limit(limit);
    } catch (error) {
      console.log(error)
      throw error;
    }
  }

  async getUserConversations(userId) {
    try {
      return await db('messages')
        .select(
          db.raw('CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id', [userId]),
          db.raw('CASE WHEN sender_id = ? THEN receiver.name ELSE sender.name END as other_user_name', [userId]),
          'messages.message as last_message',
          'messages.created_at as last_message_time',
          db.raw('COUNT(CASE WHEN receiver_id = ? AND is_read = false THEN 1 END) as unread_count', [userId])
        )
        .leftJoin('users as sender', 'messages.sender_id', 'sender.id')
        .leftJoin('users as receiver', 'messages.receiver_id', 'receiver.id')
        .where('sender_id', userId)
        .orWhere('receiver_id', userId)
        .groupBy(
          db.raw('CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END', [userId]),
          'messages.id'
        )
        .orderBy('messages.created_at', 'desc');
    } catch (error) {
      console.log(error)
      throw error;
    }
  }

  async markAsRead(userId1, userId2) {
    try {
      return await db('messages')
        .where({ sender_id: userId2, receiver_id: userId1, is_read: false })
        .update({ is_read: true });
    } catch (error) {
      console.log(error)
      throw error;
    }
  }

  async getCliniciansByPatient(patientId) {
    try {
      return await db('users')
        .select('users.id', 'users.name', 'users.email')
        .leftJoin('role', 'users.id', 'role.user_id')
        .where('role.role_type', 'clinician');
    } catch (error) {
      console.log(error)
      throw error;
    }
  }
  async getPatients() {
  try {
    return await db('users')
      .select(
        'users.id',
        'users.name', 
        'users.email',
        'dev_data.data as health_data'
      )
      .leftJoin('role', 'users.id', 'role.user_id')
      .leftJoin('dev_data', 'users.id', 'dev_data.dev_id')
      .where('role.role_type', 'patient')
      .orderBy('users.name');
  } catch (error) {
    console.log(error);
    throw error;
  }
}

}

module.exports = new MessageService();