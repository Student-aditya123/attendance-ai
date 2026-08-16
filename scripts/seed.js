/**
 * scripts/seed.js — Database seeder
 * Usage: node scripts/seed.js          (add demo data)
 *        node scripts/seed.js --reset  (drop all data, then seed)
 *
 * All passwords: Password@123
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/attendance_db';

const c = {
  reset:'\x1b[0m', bold:'\x1b[1m',
  green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m',
};
const ok  = m => console.log(`${c.green}✓${c.reset}  ${m}`);
const info= m => console.log(`${c.cyan}→${c.reset}  ${m}`);

const bcrypt = require('bcryptjs');
const HASH   = bcrypt.hashSync('Password@123', 10);

async function seed() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');

  console.log(`\n${c.bold}🌱  AttendanceAI Database Seeder${c.reset}`);
  console.log('─'.repeat(50));

  await mongoose.connect(MONGO_URI);
  ok('Connected to MongoDB');

  const db = mongoose.connection.db;

  if (reset) {
    for (const col of ['users','classes','qrsessions','attendances','analytics']) {
      await db.collection(col).deleteMany({});
    }
    ok('Existing data cleared');
  }

  const { ObjectId } = mongoose.Types;

  // ── Users ──────────────────────────────────────────────────────────────────
  const adminId    = new ObjectId();
  const faculty1Id = new ObjectId();
  const faculty2Id = new ObjectId();
  const faculty3Id = new ObjectId();

  const studentData = [
    ['Aarav Shah',      'CS21001','CS', 88], ['Diya Gupta',    'CS21002','CS', 91],
    ['Kabir Mehta',     'CS21003','CS', 44], ['Meera Pillai',  'CS21004','CS', 68],
    ['Rohan Joshi',     'CS21005','CS', 82], ['Tanvi Desai',   'CS21006','CS', 55],
    ['Ishaan Jain',     'CS21007','CS', 95], ['Pooja Iyer',    'CS21008','CS', 73],
    ['Aryan Kapoor',    'CS21009','CS', 49], ['Nisha Thomas',  'CS21010','CS', 88],
    ['Kiran Bose',    'ECE21001','ECE', 86], ['Ananya Singh', 'ECE21002','ECE', 92],
    ['Dev Patel',     'ECE21003','ECE', 61], ['Riya Verma',   'ECE21004','ECE', 78],
    ['Siddharth Rao', 'ECE21005','ECE', 97], ['Priya Sharma',  'ME21001','ME',  58],
    ['Vikram Nair',    'ME21002','ME',  47], ['Sara Khan',     'ME21003','ME',  74],
    ['Aditya Kumar',   'ME21004','ME',  83], ['Sneha Reddy',   'ME21005','ME',  66],
  ];

  const studentIds = studentData.map(() => new ObjectId());

  info('Creating users...');
  await db.collection('users').insertMany([
    { _id:adminId, name:'Dr. Rajesh Kumar', email:'admin@university.edu', passwordHash:HASH, role:'admin', department:'Administration', isActive:true, isVerified:true, createdAt:new Date() },
    { _id:faculty1Id, name:'Prof. Ankit Verma', email:'faculty1@university.edu', passwordHash:HASH, role:'faculty', department:'CS',  employeeId:'F001', isActive:true, isVerified:true, createdAt:new Date() },
    { _id:faculty2Id, name:'Dr. Meena Iyer',    email:'faculty2@university.edu', passwordHash:HASH, role:'faculty', department:'ECE', employeeId:'F002', isActive:true, isVerified:true, createdAt:new Date() },
    { _id:faculty3Id, name:'Prof. Suresh Nair', email:'faculty3@university.edu', passwordHash:HASH, role:'faculty', department:'ME',  employeeId:'F003', isActive:true, isVerified:true, createdAt:new Date() },
    ...studentData.map(([name,roll,dept,], i) => ({
      _id:studentIds[i], name, rollNumber:roll, department:dept,
      email:`${roll.toLowerCase()}@university.edu`,
      passwordHash:HASH, role:'student', isActive:true, isVerified:true, createdAt:new Date(),
    })),
  ]);
  ok(`Created ${studentData.length} students, 3 faculty, 1 admin`);

  // ── Classes ────────────────────────────────────────────────────────────────
  const csStudents  = studentIds.filter((_,i) => studentData[i][2]==='CS');
  const eceStudents = studentIds.filter((_,i) => studentData[i][2]==='ECE');
  const meStudents  = studentIds.filter((_,i) => studentData[i][2]==='ME');

  const class1Id = new ObjectId(), class2Id = new ObjectId(), class3Id = new ObjectId(),
        class4Id = new ObjectId(), class5Id = new ObjectId();

  info('Creating classes...');
  await db.collection('classes').insertMany([
    { _id:class1Id, subjectCode:'CS301',  subjectName:'Data Structures',   department:'CS',  semester:3, batch:'A', facultyId:faculty1Id, studentIds:csStudents,  minAttendancePct:75, classroomLatitude:28.7041, classroomLongitude:77.1025, locationRadiusM:100, isActive:true, createdAt:new Date() },
    { _id:class2Id, subjectCode:'CS401',  subjectName:'Machine Learning',  department:'CS',  semester:5, batch:'A', facultyId:faculty1Id, studentIds:csStudents,  minAttendancePct:75, isActive:true, createdAt:new Date() },
    { _id:class3Id, subjectCode:'ECE301', subjectName:'Digital Circuits',  department:'ECE', semester:3, batch:'A', facultyId:faculty2Id, studentIds:eceStudents, minAttendancePct:75, isActive:true, createdAt:new Date() },
    { _id:class4Id, subjectCode:'ME201',  subjectName:'Thermodynamics',    department:'ME',  semester:3, batch:'A', facultyId:faculty3Id, studentIds:meStudents,  minAttendancePct:75, isActive:true, createdAt:new Date() },
    { _id:class5Id, subjectCode:'CS202',  subjectName:'Operating Systems', department:'CS',  semester:4, batch:'A', facultyId:faculty1Id, studentIds:csStudents,  minAttendancePct:75, isActive:true, createdAt:new Date() },
  ]);
  ok('Created 5 classes');

  // ── Attendance records (60 days of history) ───────────────────────────────
  info('Generating attendance history (60 days)...');
  const sessions = [], records = [];
  const classDefs = [
    { id:class1Id, students:csStudents,  fac:faculty1Id },
    { id:class2Id, students:csStudents,  fac:faculty1Id },
    { id:class3Id, students:eceStudents, fac:faculty2Id },
    { id:class4Id, students:meStudents,  fac:faculty3Id },
    { id:class5Id, students:csStudents,  fac:faculty1Id },
  ];

  for (let daysBack = 60; daysBack >= 1; daysBack--) {
    const date = new Date(); date.setDate(date.getDate() - daysBack);
    if ([0,6].includes(date.getDay())) continue;

    for (const cls of classDefs) {
      if (Math.random() > 0.8) continue;
      const sessId = new ObjectId();
      sessions.push({ _id:sessId, classId:cls.id, facultyId:cls.fac, currentNonce:`nonce-${sessId}`, latitude:28.7041, longitude:77.1025, radiusMeters:100, lectureDate:date, isActive:false, startedAt:date, endedAt:new Date(date.getTime()+3600000), expiresAt:new Date(date.getTime()+5400000), scannedStudentIds:[], fraudAttempts:[], createdAt:date });

      for (let si = 0; si < cls.students.length; si++) {
        const sid = cls.students[si];
        const sData = studentData.find(([,,, ], idx) => studentIds[idx]?.equals(sid));
        const targetPct = sData ? sData[3] : 75;
        if (Math.random()*100 >= targetPct) continue;
        records.push({ studentId:sid, classId:cls.id, qrSessionId:sessId, lectureDate:date, method:Math.random()>.3?'qr':'face', status:'present', latitude:28.7041, longitude:77.1025, distanceFromClassroom:Math.floor(Math.random()*80), markedAt:new Date(date.getTime()+Math.random()*600000), createdAt:date });
      }
    }
  }

  if (sessions.length) await db.collection('qrsessions').insertMany(sessions);
  if (records.length)  await db.collection('attendances').insertMany(records);
  ok(`Created ${sessions.length} QR sessions, ${records.length} attendance records`);

  // ── Analytics snapshots ───────────────────────────────────────────────────
  info('Creating analytics snapshots...');
  const snapshots = studentData.map(([,,, pct], i) => {
    const level = pct<60?'critical':pct<75?'warning':pct<85?'moderate':'good';
    return { studentId:studentIds[i], department:studentData[i][2], overallPercentage:pct, totalClasses:20, totalAttended:Math.round(20*pct/100), riskScore:Math.max(0,100-pct), riskLevel:level, consecutiveAbsences:pct<60?7:pct<75?3:0, weeklyTrend:[1,2,3,4].map(w=>({week:w,year:2025,percentage:pct+(Math.random()-.5)*5})), subjectBreakdown:[], periodStart:new Date(Date.now()-30*86400000), periodEnd:new Date(), computedAt:new Date() };
  });
  await db.collection('analytics').insertMany(snapshots);
  ok(`Created analytics snapshots for ${snapshots.length} students`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`${c.bold}🎉  Seeding complete!${c.reset}\n`);
  console.log(`  ${c.bold}Login credentials (password: Password@123)${c.reset}`);
  console.log('  Admin:   admin@university.edu');
  console.log('  Faculty: faculty1@university.edu');
  console.log('  Student: cs21001@university.edu\n');
  console.log('  Open: http://localhost:5173\n');

  await mongoose.disconnect();
}

seed().catch(e => { console.error('\n❌  Seed failed:', e.message); process.exit(1); });
