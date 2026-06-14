/**
 * Auth middleware — placeholder.
 * Will be implemented in P3 with JWT verification.
 */
function requireAuth(req, res, next) {
  next();
}

module.exports = { requireAuth };
