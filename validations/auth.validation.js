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

const registerSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required().messages({
    'any.required': 'Username is required',
    'string.alphanum': 'Username must be alphanumeric',
    'string.min': 'Username must be at least 3 characters',
    'string.max': 'Username cannot exceed 30 characters',
  }),
  name: Joi.string().min(2).max(100).required().messages({
    'any.required': 'Name is required',
    'string.min': 'Name must be at least 2 characters',
    'string.max': 'Name cannot exceed 100 characters',
  }),
  email: Joi.string().email().required().messages({
    'any.required': 'Email is required',
    'string.email': 'Email must be valid',
  }),
  phoneNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required().messages({
    'any.required': 'Phone number is required',
    'string.pattern.base': 'Phone number must be a valid international number (e.g., +1234567890)',
  }),
  password: Joi.string().min(6).max(128).required().messages({
    'any.required': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'string.max': 'Password cannot exceed 128 characters',
  }),
  role: Joi.string().valid('admin', 'clinician', 'patient','super-admin').required().messages({
    'any.required': 'Role is required',
    'any.only': 'Role must be one of: admin, clinician, patient',
  }),
  is_active: Joi.boolean().required().messages({
    'any.required': 'Status is required',
    'boolean.base': 'Status must be true (Active) or false (Inactive)',
  }),
});

module.exports = { loginSchema, registerSchema };