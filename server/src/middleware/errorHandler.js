/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, next) {
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}

module.exports = { errorHandler };
