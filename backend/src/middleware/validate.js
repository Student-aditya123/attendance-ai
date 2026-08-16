/**
 * validate.js — Zod request validation middleware factory
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), authController.register)
 *
 * Validates req.body, req.params, and req.query against a Zod schema.
 * Returns 422 with structured field errors on failure — not a generic 400.
 * This makes it easy for the frontend to highlight the specific broken field.
 */
const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body:   req.body,
      params: req.params,
      query:  req.query,
    });

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field:   issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    // Attach parsed (type-safe) data back onto request
    req.body   = result.data.body   ?? req.body;
    req.params = result.data.params ?? req.params;
    req.query  = result.data.query  ?? req.query;

    next();
  };
}

module.exports = validate;
