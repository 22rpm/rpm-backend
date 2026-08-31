// services/messageService.js
const db = require("../config/knex");
const { isOrgWide } = require("./patientAccess");

class MessageService {
  async saveMessage(senderId, receiverId, message) {
    try {
      const [messageId] = await db("messages").insert({
        sender_id: senderId,
        receiver_id: receiverId,
        message: message,
        created_at: new Date(),
        updated_at: new Date(),
      });

      return await this.getMessageById(messageId);
    } catch (error) {
      throw error;
    }
  }

  async getMessageById(messageId) {
    try {
      return await db("messages")
        .select(
          "messages.*",
          "sender.name as sender_name",
          "receiver.name as receiver_name"
        )
        .leftJoin("users as sender", "messages.sender_id", "sender.id")
        .leftJoin("users as receiver", "messages.receiver_id", "receiver.id")
        .where("messages.id", messageId)
        .first();
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  async getConversation(userId1, userId2, limit = 50) {
    try {
      return await db("messages")
        .select("messages.*", "sender.name as sender_name")
        .leftJoin("users as sender", "messages.sender_id", "sender.id")
        .where(function () {
          this.where({ sender_id: userId1, receiver_id: userId2 }).orWhere({
            sender_id: userId2,
            receiver_id: userId1,
          });
        })
        .orderBy("created_at", "desc")
        .limit(limit);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  async getUserConversations(userId) {
    try {
      return await db("messages as m1")
        .select(
          db.raw(
            "CASE WHEN m1.sender_id = ? THEN m1.receiver_id ELSE m1.sender_id END as other_user_id",
            [userId]
          ),
          db.raw(
            "CASE WHEN m1.sender_id = ? THEN r.name ELSE s.name END as other_user_name",
            [userId]
          ),
          "m1.message as last_message",
          "m1.created_at as last_message_time",
          db.raw(
            "SUM(CASE WHEN m1.receiver_id = ? AND m1.is_read = false THEN 1 ELSE 0 END) as unread_count",
            [userId]
          )
        )
        .leftJoin("users as s", "m1.sender_id", "s.id")
        .leftJoin("users as r", "m1.receiver_id", "r.id")
        .where(function () {
          this.where("m1.sender_id", userId).orWhere("m1.receiver_id", userId);
        })
        .andWhere("m1.created_at", function () {
          this.select(db.raw("MAX(m2.created_at)"))
            .from("messages as m2")
            .whereRaw(
              "(CASE WHEN m2.sender_id = ? THEN m2.receiver_id ELSE m2.sender_id END) = (CASE WHEN m1.sender_id = ? THEN m1.receiver_id ELSE m1.sender_id END)",
              [userId, userId]
            );
        })
        .groupBy(
          "other_user_id",
          "other_user_name",
          "last_message",
          "last_message_time"
        );
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  //   async getUserConversations(userId) {
  //   try {
  //     const subquery = db("messages")
  //       .select(
  //         db.raw("CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id", [userId]),
  //         db.raw("CASE WHEN sender_id = ? THEN receiver.name ELSE sender.name END as other_user_name", [userId]),
  //         db.raw("MAX(created_at) as max_created_at")
  //       )
  //       .leftJoin("users as sender", "messages.sender_id", "sender.id")
  //       .leftJoin("users as receiver", "messages.receiver_id", "receiver.id")
  //       .where("sender_id", userId)
  //       .orWhere("receiver_id", userId)
  //       .groupBy("other_user_id", "other_user_name")
  //       .as("conv");

  //     return await db("messages as m")
  //       .select(
  //         "conv.other_user_id",
  //         "conv.other_user_name",
  //         "m.message as last_message",
  //         "m.created_at as last_message_time",
  //         db.raw("SUM(CASE WHEN m.receiver_id = ? AND m.is_read = false THEN 1 ELSE 0 END) as unread_count", [userId])
  //       )
  //       .join(subquery, function () {
  //         this.on(function () {
  //           this.on("m.sender_id", "=", db.raw("?", [userId]))
  //             .andOn("m.receiver_id", "=", "conv.other_user_id")
  //             .orOn(function () {
  //               this.on("m.receiver_id", "=", db.raw("?", [userId]))
  //                 .andOn("m.sender_id", "=", "conv.other_user_id");
  //             });
  //         })
  //         .andOn("m.created_at", "=", "conv.max_created_at");
  //       })
  //       .groupBy("conv.other_user_id", "conv.other_user_name", "m.message", "m.created_at")
  //       .orderBy("m.created_at", "desc");
  //   } catch (error) {
  //     console.error(error);
  //     throw error;
  //   }
  // }

  async markAsRead(userId1, userId2) {
    try {
      return await db("messages")
        .where({ sender_id: userId2, receiver_id: userId1, is_read: false })
        .update({ is_read: true });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  // Who a patient may message. Was UNSCOPED — every clinician in every org, a
  // live cross-org exposure (a patient could message a clinician in another
  // organization). Now: hard-bounded to the patient's OWN org; their assigned
  // clinician(s) when an assignment exists, else all active clinicians in the
  // org so an orphaned patient (ORG_CONTEXT #6) can still reach someone. Never
  // cross-org. Recipients are clinicians only — patients message the responsible
  // physician, not org staff.
  async getCliniciansByPatient(patientId) {
    try {
      const patient = await db("users")
        .select("organization_id")
        .where("id", patientId)
        .first();
      if (!patient || patient.organization_id == null) return [];
      const org = patient.organization_id;

      const assigned = await db("users")
        .select("users.id", "users.name", "users.email")
        .innerJoin("role", "users.id", "role.user_id")
        .innerJoin(
          "patient_doctor_assignments",
          "users.id",
          "patient_doctor_assignments.doctor_id"
        )
        .where("patient_doctor_assignments.patient_id", patientId)
        .where("role.role_type", "clinician")
        .where("users.is_active", true)
        .where("users.organization_id", org);
      if (assigned.length) return assigned;

      // Orphan fallback — org-scoped, never cross-org.
      return await db("users")
        .select("users.id", "users.name", "users.email")
        .innerJoin("role", "users.id", "role.user_id")
        .where("role.role_type", "clinician")
        .where("users.is_active", true)
        .where("users.organization_id", org);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  async getPatients(user, orgScope) {
    try {
      // Visibility model (services/patientAccess): org-wide roles
      // (super-admin/admin/care_manager) see all patients in the org scope; a
      // clinician sees only assigned patients. Previously assignment-only with NO
      // org filter, so admin/care_manager saw an empty list and the query was
      // unscoped by org.
      let q = db("users")
        .select("users.id", "users.name", "users.email")
        .innerJoin("role", "users.id", "role.user_id")
        .where("role.role_type", "patient");
      if (isOrgWide(user)) {
        q = q.where("users.organization_id", orgScope);
      } else {
        q = q
          .innerJoin(
            "patient_doctor_assignments",
            "users.id",
            "patient_doctor_assignments.patient_id"
          )
          .where("patient_doctor_assignments.doctor_id", user.id);
      }
      const patients = await q.orderBy("users.name");

      // For each patient, get their latest BP reading
      const patientsWithData = await Promise.all(
        patients.map(async (patient) => {
          const latestBP = await db("dev_data")
            .select("data", "created_at")
            .where("user_id", patient.id)
            .where("dev_type", "bp")
            .orderBy("created_at", "desc")
            .first();

          // Safely parse data if it's a string, otherwise just return it
          let latestBPData = null;
          if (latestBP) {
            latestBPData =
              typeof latestBP.data === "string"
                ? JSON.parse(latestBP.data)
                : latestBP.data;
          }

          return {
            ...patient,
            latest_bp_data: latestBPData,
            last_reading_time: latestBP ? latestBP.created_at : null,
          };
        })
      );

      return patientsWithData;
    } catch (error) {
      console.error("Error in getPatients:", error);
      throw error;
    }
  }
}

module.exports = new MessageService();
