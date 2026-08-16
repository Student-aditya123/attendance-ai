/**
 * user.routes.js — Admin user management
 * Full implementation in previous phase output.
 */
const express = require('express');
const User    = require('../../models/User.model');
const { protect, authorize, selfOrAdmin } = require('../../middleware/auth');
const { asyncHandler, AppError } = require('../../middleware/errorHandler');

const router = express.Router();
router.use(protect);

router.get('/stats', authorize('admin'), asyncHandler(async (req, res) => {
  const byRole = await User.aggregate([
    { $group: { _id: '$role', count: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
  ]);
  res.status(200).json({ success: true, data: { byRole } });
}));

router.get('/', authorize('admin'), asyncHandler(async (req, res) => {
  const { role, department, search, page = 1, limit = 20 } = req.query;
  const filter = {
    ...(role && { role }), ...(department && { department }),
    ...(search && { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }),
  };
  const [users, total] = await Promise.all([
    User.find(filter).select('-passwordHash').sort({ name: 1 }).skip((+page-1)*+limit).limit(+limit),
    User.countDocuments(filter),
  ]);
  res.status(200).json({ success: true, data: { users, pagination: { page:+page, limit:+limit, total, pages: Math.ceil(total/+limit) } } });
}));

router.get('/:userId', selfOrAdmin, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId).select('-passwordHash');
  if (!user) throw new AppError('User not found', 404);
  res.status(200).json({ success: true, data: { user } });
}));

router.post('/', authorize('admin'), asyncHandler(async (req, res) => {
  const existing = await User.findOne({ email: req.body.email });
  if (existing) throw new AppError('Email already registered', 409);
  const user = await User.create({ ...req.body, passwordHash: req.body.password, isVerified: true });
  res.status(201).json({ success: true, data: { user } });
}));

router.put('/:userId', asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.userId)
    throw new AppError('Cannot update another user', 403);
  const user = await User.findByIdAndUpdate(req.params.userId, req.body, { new: true }).select('-passwordHash');
  if (!user) throw new AppError('User not found', 404);
  res.status(200).json({ success: true, data: { user } });
}));

router.patch('/:userId/status', authorize('admin'), asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.userId, { isActive: req.body.isActive }, { new: true }).select('name email role isActive');
  if (!user) throw new AppError('User not found', 404);
  res.status(200).json({ success: true, data: { user } });
}));

module.exports = router;
