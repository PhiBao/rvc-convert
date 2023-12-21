// Error Handling Middleware
const errorMiddleware = (err, req, res, next) => {
  // Log the error for the server side (you can use a more sophisticated logger)
  console.error(err);

  // Define error format
  const errorResponse = {
    success: false,
    message: err.message || "Something went wrong",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }), // Include stack trace in development mode
  };

  // Set the status code
  const statusCode = err.statusCode || 500;

  // Send the error response
  res.status(statusCode).json(errorResponse);
};

export default errorMiddleware;
