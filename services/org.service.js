const dummyOrganizations = [
  {
    id: 1,
    name: "HealthCare Corp",
    org_code: "HCC001",
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T00:00:00Z",
    is_deleted: false,
  },
  {
    id: 2,
    name: "MediCare Solutions",
    org_code: "MCS002",
    created_at: "2025-03-22T00:00:00Z",
    updated_at: "2025-03-22T00:00:00Z",
    is_deleted: false,
  },
  {
    id: 3,
    name: "Wellness Group",
    org_code: "WG003",
    created_at: "2025-06-10T00:00:00Z",
    updated_at: "2025-06-10T00:00:00Z",
    is_deleted: false,
  },
];

const dummyUsers = [
  {
    id: 1,
    username: "john_doe",
    name: "John Doe",
    email: "john.doe@healthcare.com",
    password: "hashed_password_1",
    phoneNumber: "+1234567890",
    organization_id: 1,
    is_active: true,
    last_login: "2025-09-20T00:00:00Z",
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T00:00:00Z",
  },
  {
    id: 2,
    username: "jane_smith",
    name: "Jane Smith",
    email: "jane.smith@healthcare.com",
    password: "hashed_password_2",
    phoneNumber: "+1234567891",
    organization_id: 1,
    is_active: false,
    last_login: "2025-08-10T00:00:00Z",
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T00:00:00Z",
  },
  {
    id: 3,
    username: "alice_johnson",
    name: "Alice Johnson",
    email: "alice.johnson@medicare.com",
    password: "hashed_password_3",
    phoneNumber: "+1234567892",
    organization_id: 2,
    is_active: true,
    last_login: "2025-09-21T00:00:00Z",
    created_at: "2025-03-22T00:00:00Z",
    updated_at: "2025-03-22T00:00:00Z",
  },
  {
    id: 4,
    username: "bob_wilson",
    name: "Bob Wilson",
    email: "bob.wilson@wellness.com",
    password: "hashed_password_4",
    phoneNumber: "+1234567893",
    organization_id: 3,
    is_active: true,
    last_login: null,
    created_at: "2025-06-10T00:00:00Z",
    updated_at: "2025-06-10T00:00:00Z",
  },
];

const dummyRoles = [
  { id: 1, user_id: 1, username: "john_doe", role_type: "admin", created_at: "2025-01-15T00:00:00Z", updated_at: "2025-01-15T00:00:00Z" },
  { id: 2, user_id: 2, username: "jane_smith", role_type: "admin", created_at: "2025-01-15T00:00:00Z", updated_at: "2025-01-15T00:00:00Z" },
  { id: 3, user_id: 3, username: "alice_johnson", role_type: "admin", created_at: "2025-03-22T00:00:00Z", updated_at: "2025-03-22T00:00:00Z" },
  { id: 4, user_id: 4, username: "bob_wilson", role_type: "admin", created_at: "2025-06-10T00:00:00Z", updated_at: "2025-06-10T00:00:00Z" },
];

async function createOrganization({ name, code }) {
  const newOrg = {
    id: dummyOrganizations.length + 1,
    name,
    org_code: code,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_deleted: false,
  };
  dummyOrganizations.push(newOrg);
  return newOrg.id;
}

async function findOrganizationById(id) {
  return dummyOrganizations.find((org) => org.id === parseInt(id) && !org.is_deleted);
}

async function findOrganizationByCode(code) {
  return dummyOrganizations.find((org) => org.org_code === code && !org.is_deleted);
}

async function updateOrganization(id, { name, code }) {
  const orgIndex = dummyOrganizations.findIndex((org) => org.id === parseInt(id));
  if (orgIndex !== -1) {
    dummyOrganizations[orgIndex] = {
      ...dummyOrganizations[orgIndex],
      name,
      org_code: code,
      updated_at: new Date().toISOString(),
    };
  }
}

async function softDeleteOrganization(id) {
  const orgIndex = dummyOrganizations.findIndex((org) => org.id === parseInt(id));
  if (orgIndex !== -1) {
    dummyOrganizations[orgIndex].is_deleted = true;
    dummyOrganizations[orgIndex].updated_at = new Date().toISOString();
  }
}

async function getOrganizationById(id) {
  return dummyOrganizations.find((org) => org.id === parseInt(id) && !org.is_deleted);
}

async function getAllOrganizations() {
  return dummyOrganizations.filter((org) => !org.is_deleted);
}

async function createUser({ username, name, email, password, phoneNumber, organization_id, is_active }) {
  const newUser = {
    id: dummyUsers.length + 1,
    username,
    name,
    email,
    password,
    phoneNumber,
    organization_id,
    is_active,
    last_login: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  dummyUsers.push(newUser);
  return newUser.id;
}

async function findUserById(id) {
  return dummyUsers.find((user) => user.id === parseInt(id));
}

async function findUserByEmail(email) {
  return dummyUsers.find((user) => user.email === email);
}

async function updateUser(id, { name, email, phoneNumber }) {
  const userIndex = dummyUsers.findIndex((user) => user.id === parseInt(id));
  if (userIndex !== -1) {
    dummyUsers[userIndex] = {
      ...dummyUsers[userIndex],
      name,
      email,
      phoneNumber,
      updated_at: new Date().toISOString(),
    };
  }
}

async function updateUserPassword(id, hashedPassword) {
  const userIndex = dummyUsers.findIndex((user) => user.id === parseInt(id));
  if (userIndex !== -1) {
    dummyUsers[userIndex].password = hashedPassword;
    dummyUsers[userIndex].updated_at = new Date().toISOString();
  }
}

async function updateUserStatus(id, isActive) {
  const userIndex = dummyUsers.findIndex((user) => user.id === parseInt(id));
  if (userIndex !== -1) {
    dummyUsers[userIndex].is_active = isActive;
    dummyUsers[userIndex].updated_at = new Date().toISOString();
  }
}

async function deleteUser(id) {
  const userIndex = dummyUsers.findIndex((user) => user.id === parseInt(id));
  if (userIndex !== -1) {
    dummyUsers.splice(userIndex, 1);
    const roleIndex = dummyRoles.findIndex((role) => role.user_id === parseInt(id));
    if (roleIndex !== -1) {
      dummyRoles.splice(roleIndex, 1);
    }
  }
}

async function assignRole({ username, userId, role }) {
  const newRole = {
    id: dummyRoles.length + 1,
    user_id: userId,
    username,
    role_type: role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  dummyRoles.push(newRole);
}

async function getAllAdmins() {
  return dummyUsers.filter((user) =>
    dummyRoles.some((role) => role.user_id === user.id && role.role_type === "admin")
  );
}

module.exports = {
  createOrganization,
  findOrganizationById,
  findOrganizationByCode,
  updateOrganization,
  softDeleteOrganization,
  getOrganizationById,
  getAllOrganizations,
  createUser,
  findUserById,
  findUserByEmail,
  updateUser,
  updateUserPassword,
  updateUserStatus,
  deleteUser,
  assignRole,
  getAllAdmins,
};