// middleware/auth.js
const jwt = require("jsonwebtoken");

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || "auth_token";

function authRequired(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token)
      return res.status(401).json({ ok: false, message: "Unauthorized" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, username, role }
    console.log("JWT_SECRET in middleware:", process.env.JWT_SECRET);

    next();
  } catch (err) {
    return res
      .status(401)
      .json({ ok: false, message: "Invalid or expired token" });
  }
}

// this is being used in live chat messageService
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1]; // after "Bearer"
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;  // 🔑 now req.user will exist
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}


module.exports = { authRequired, COOKIE_NAME, authMiddleware};
