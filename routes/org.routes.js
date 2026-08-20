const express = require("express");
const router = express.Router();
const organizationController = require("../controllers/organization.controller");
const validateRequest = require("../middleware/validate");
const { authRequired, requireRole } = require("../middleware/auth");
const {
  addOrganizationSchema,
  editOrganizationSchema,
  addAdminSchema,
  editAdminSchema,
  resetPasswordSchema,
  toggleStatusSchema,
} = require("../validations/org.validation");

// Organization and admin management is a super-admin capability. The one
// exception is listing an organization's doctors, which org admins also use
// (AddUser/EditUser flows), so that route allows admin OR super-admin.
const superAdminOnly = requireRole("super-admin");
const adminOrSuperAdmin = requireRole("admin", "super-admin");

// GET /api/org/me — the caller's own organization (id + name only), for the
// clinic-context top bar. Any authenticated user; returns only their own org
// (derived from their token id, never a client-supplied org id). Static path,
// registered before the param routes so it is never captured by :id.
router.get("/me", authRequired, organizationController.getMyOrganization);

router.post(
  "/organizations",
  authRequired,
  superAdminOnly,
  validateRequest(addOrganizationSchema),
  organizationController.addOrganization
);
router.put(
  "/organizations/:id",
  authRequired,
  superAdminOnly,
  validateRequest(editOrganizationSchema),
  organizationController.editOrganization
);
router.post(
  "/organizations/:id/admins",
  authRequired,
  superAdminOnly,
  validateRequest(addAdminSchema),
  organizationController.addAdminToOrganization
);
router.delete(
  "/organizations/:id",
  authRequired,
  superAdminOnly,
  organizationController.deleteOrganization
);
router.put(
  "/admins/:id",
  authRequired,
  superAdminOnly,
  validateRequest(editAdminSchema),
  organizationController.editAdmin
);
router.post(
  "/admins/:id/reset-password",
  authRequired,
  superAdminOnly,
  validateRequest(resetPasswordSchema),
  organizationController.resetPassword
);
router.patch(
  "/admins/:id/status",
  authRequired,
  superAdminOnly,
  validateRequest(toggleStatusSchema),
  organizationController.toggleAdminStatus
);
router.delete(
  "/admins/:id",
  authRequired,
  superAdminOnly,
  organizationController.deleteAdmin
);
router.get(
  "/organizations",
  authRequired,
  superAdminOnly,
  organizationController.getAllOrganizations
);
// Organization detail + counts (super-admin org-context view)
router.get(
  "/organizations/:id",
  authRequired,
  superAdminOnly,
  organizationController.getOrganizationById
);
router.get(
  "/admins",
  authRequired,
  superAdminOnly,
  organizationController.getAllAdmins
);
router.get(
  "/organizations/:id/admins",
  authRequired,
  superAdminOnly,
  organizationController.getOrganizationAdmins
);
router.get(
  "/organization/:organizationId",
  authRequired,
  adminOrSuperAdmin,
  organizationController.getDoctorsByOrganization
);

module.exports = router;
