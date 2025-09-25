const express = require("express");
const router = express.Router();
const organizationController = require("../controllers/organization.controller");
const  validateRequest= require("../middleware/validate");
const {
  addOrganizationSchema,
  editOrganizationSchema,
  addAdminSchema,
  editAdminSchema,
  resetPasswordSchema,
  toggleStatusSchema,
} = require("../validations/org.validation");

router.post(
  "/organizations",
  validateRequest(addOrganizationSchema),
  organizationController.addOrganization
);
router.put(
  "/organizations/:id",
  validateRequest(editOrganizationSchema),
  organizationController.editOrganization
);
router.post(
  "/organizations/:id/admins",
  validateRequest(addAdminSchema),
  organizationController.addAdminToOrganization
);
router.delete("/organizations/:id", organizationController.deleteOrganization);
router.put(
  "/admins/:id",
  validateRequest(editAdminSchema),
  organizationController.editAdmin
);
router.post(
  "/admins/:id/reset-password",
  validateRequest(resetPasswordSchema),
  organizationController.resetPassword
);
router.patch(
  "/admins/:id/status",
  validateRequest(toggleStatusSchema),
  organizationController.toggleAdminStatus
);
router.delete("/admins/:id", organizationController.deleteAdmin);
router.get("/organizations", organizationController.getAllOrganizations);
router.get("/admins", organizationController.getAllAdmins);
router.get("/organizations/:id/admins", organizationController.getOrganizationAdmins);
module.exports = router;