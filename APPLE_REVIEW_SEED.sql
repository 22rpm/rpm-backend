-- ============================================================================
-- Apple App Review account seed (PHI-free, fully isolated)
--
-- Creates a dedicated review ORG + one PATIENT user + fake BP readings, so an
-- App Review reviewer can log in (with the fixed OTP wired in auth.controller.js)
-- and see a functional, populated app with NO real patient data.
--
-- Run on PROD (rpm_db_v1). mysqldump FIRST — prod has no backups.
--
-- STEP A — generate the bcrypt hash for the review password, in rpm-backend/:
--   node -e "console.log(require('bcrypt').hashSync('AppReview!2026', 12))"
-- Paste the printed hash into @pw below. The password + fixed OTP go in Apple's
-- App Review notes.
--
-- STEP B — run this whole block. Note the user id it prints at the end and set
-- APPLE_REVIEW_USER_ID in controllers/auth.controller.js to it, then deploy.
--
-- Isolation (why this is safe): its own org (no shared org data); role = patient
-- (a patient sees only its OWN dev_data, keyed on user_id); NO patient_doctor_
-- assignments rows (so it links to no real clinician/patient and sees none). All
-- names/emails/readings are fabricated.
-- ============================================================================

SET @pw := '$2b$12$REPLACE_WITH_BCRYPT_HASH_FROM_STEP_A';

START TRANSACTION;

-- 1. Dedicated review org (isolated).
INSERT INTO organizations (name, org_code, is_deleted, created_at, updated_at)
VALUES ('Apple Review - DO NOT USE', 'APPLEREVIEW', 0, NOW(), NOW());
SET @org_id := LAST_INSERT_ID();

-- 2. Review patient user. phoneNumber NULL on purpose (forces email channel and
--    leaves no SMS path even if the login gate were ever removed).
INSERT INTO users (username, name, email, password, phoneNumber, organization_id, is_active, created_at, updated_at)
VALUES ('applereview', 'App Review', 'appreview@twentytwohealth.com', @pw, NULL, @org_id, 1, NOW(), NOW());
SET @uid := LAST_INSERT_ID();

-- 3. Patient role.
INSERT INTO role (user_id, role_type, created_at, updated_at)
VALUES (@uid, 'patient', NOW(), NOW());

-- 4. Fake BP history so the app looks functional (no connected cuff needed).
--    Plausible, self-consistent values; spread over the last week. data.timestamp
--    is what the app displays/keys on.
INSERT INTO dev_data (dev_id, user_id, dev_type, data, created_at) VALUES
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',122,'diastolic',78,'pulse',70,'mean',93, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 6 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 6 DAY),
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',118,'diastolic',74,'pulse',68,'mean',89, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 5 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 5 DAY),
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',126,'diastolic',81,'pulse',72,'mean',96, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 4 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 4 DAY),
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',120,'diastolic',76,'pulse',69,'mean',91, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 3 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 3 DAY),
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',124,'diastolic',79,'pulse',71,'mean',94, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 2 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 2 DAY),
 ('review_cuff_001', @uid, 'bp', JSON_OBJECT('systolic',119,'diastolic',75,'pulse',67,'mean',90, 'timestamp', DATE_FORMAT(NOW() - INTERVAL 1 DAY,'%Y-%m-%dT%H:%i:%s.000Z')), NOW() - INTERVAL 1 DAY);

COMMIT;

-- 5. The number to hardcode in auth.controller.js (APPLE_REVIEW_USER_ID):
SELECT @uid AS apple_review_user_id, @org_id AS apple_review_org_id;

-- Sanity: confirm it is a patient, in the review org, with NO assignments and
-- only its own readings.
SELECT (SELECT role_type FROM role WHERE user_id=@uid)                          AS role_type,
       (SELECT COUNT(*) FROM patient_doctor_assignments WHERE patient_id=@uid)  AS assignment_rows_should_be_0,
       (SELECT COUNT(*) FROM dev_data WHERE user_id=@uid)                       AS reading_rows;
