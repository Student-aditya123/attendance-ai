/**
 * User.model.js
 *
 * Design decisions:
 * - faceEncodingRef stores only the S3 key, not the vector itself.
 *   Face vectors are 128-float arrays — querying them in Mongo is expensive
 *   and the AI service owns that data.
 * - deviceFingerprint is the last known device; stored for fraud detection.
 * - Compound index on (email) unique enforced at DB level, not just app level.
 */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const env      = require('../config/env');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,     // never returned in queries unless explicitly requested
    },
    role: {
      type: String,
      enum: ['admin', 'faculty', 'student'],
      default: 'student',
    },
    department:   { type: String, trim: true },
    rollNumber:   { type: String, trim: true, sparse: true },   // students only
    employeeId:   { type: String, trim: true, sparse: true },   // faculty/admin only
    phone:        { type: String, trim: true },

    // Face recognition
    faceEncodingRef: { type: String, default: null },  // S3 key to 128-d vector
    isFaceRegistered: { type: Boolean, default: false },

    // Anti-fraud
    deviceFingerprint: { type: String, default: null },

    // Account state
    isActive:     { type: Boolean, default: true },
    isVerified:   { type: Boolean, default: false },
    lastLoginAt:  { type: Date },

    // Password reset
    resetPasswordToken:   { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, department: 1 });
userSchema.index({ rollNumber: 1 }, { sparse: true });

// ── Pre-save hook: hash password before storing ───────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, env.BCRYPT_ROUNDS);
  next();
});

// ── Instance method: compare password ────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// ── Instance method: build JWT payload (only safe fields) ────────────────────
userSchema.methods.toJWTPayload = function () {
  return {
    id:         this._id.toString(),
    email:      this.email,
    role:       this.role,
    name:       this.name,
    department: this.department,
  };
};

module.exports = mongoose.model('User', userSchema);
