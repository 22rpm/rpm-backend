const Joi = require("joi");

const addOrganizationSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  code: Joi.string().min(3).max(255).required(),
  admin: Joi.object({
    username: Joi.string().min(3).max(255).required(),
    name: Joi.string().min(3).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    phoneNumber: Joi.string().max(20).allow(null, ""),
  }).required(),
});

const editOrganizationSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  code: Joi.string().min(3).max(255).required(),
});

const addAdminSchema = Joi.object({
  username: Joi.string().min(3).max(255).required(),
  name: Joi.string().min(3).max(255).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  phoneNumber: Joi.string().max(20).allow(null, ""),
});

const editAdminSchema = Joi.object({
  name: Joi.string().min(3).max(255).required(),
  email: Joi.string().email().required(),
  phoneNumber: Joi.string().max(20).allow(null, ""),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const toggleStatusSchema = Joi.object({
  status: Joi.string().valid("Active", "Inactive").required(),
});

module.exports = {
  addOrganizationSchema,
  editOrganizationSchema,
  addAdminSchema,
  editAdminSchema,
  resetPasswordSchema,
  toggleStatusSchema,
};