/**
 * Class.model.js
 *
 * A "Class" represents one subject section (e.g. CS301-A, Monday 10am).
 * Multiple Class documents can exist for the same subject (different batches).
 *
 * studentIds stored as array of ObjectIds — at 100K users, a single class
 * never has more than ~100 students, so this array stays small and is fine.
 * For very large institutions, a separate enrollment collection would scale better.
 */
const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    day:       { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat'], required: true },
    startTime: { type: String, required: true },  // "09:00"
    endTime:   { type: String, required: true },  // "10:00"
    room:      { type: String },
  },
  { _id: false }
);

const classSchema = new mongoose.Schema(
  {
    subjectCode: {
      type: String,
      required: [true, 'Subject code is required'],
      uppercase: true,
      trim: true,
    },
    subjectName: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true,
    },
    department:  { type: String, required: true, trim: true },
    semester:    { type: Number, min: 1, max: 10, required: true },
    batch:       { type: String, default: 'A' },   // section identifier

    facultyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    schedule:   [scheduleSchema],

    // Policy: students below this % get flagged
    minAttendancePct: { type: Number, default: 75, min: 0, max: 100 },

    // Classroom GPS for location validation
    classroomLatitude:  { type: Number },
    classroomLongitude: { type: Number },
    locationRadiusM:    { type: Number, default: 100 },  // metres

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
classSchema.index({ facultyId: 1 });
classSchema.index({ department: 1, semester: 1 });
classSchema.index({ subjectCode: 1, batch: 1 });
classSchema.index({ studentIds: 1 });  // for "find all classes I'm enrolled in"

// ── Virtual: total enrolled count ────────────────────────────────────────────
classSchema.virtual('enrolledCount').get(function () {
  return this.studentIds.length;
});

module.exports = mongoose.model('Class', classSchema);
