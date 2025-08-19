// validations/auth.validation.js
const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'any.required': 'Email is required',
    'string.email': 'Email must be valid',
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'any.required': 'Password is required',
  }),
});

// Registration schema for completeness, if needed later
const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
  role: Joi.string().valid('admin', 'clinician', 'patient').required()
});

module.exports = { loginSchema, registerSchema };