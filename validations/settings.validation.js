const Joi = require("joi");

const updateSettingsSchema = Joi.object({
  name: Joi.string().min(3).max(30).optional(),
  username: Joi.string().min(3).max(30).optional(),
  email: Joi.string().email().optional(),
  phoneNumber: Joi.string()
    .pattern(/^\+92[0-9]{10}$/) // must start with +92 and have exactly 10 digits after
    .message("Phone number must be in format +923XXXXXXXXX")
    .optional(),
}).min(1); // At least one field must be provided

module.exports = { updateSettingsSchema };
