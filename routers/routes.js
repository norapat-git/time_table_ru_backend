var express = require('express'); 

const router = express.Router()

// Controllers
const test = require('../controllers/test');
const auth_sign = require('../controllers/auth/auth_sign');
const auth_login = require('../controllers/auth/microsoft/login');
const SelectDataController = require('../controllers/SelectModel');
const InsertDataController = require('../controllers/InsertModel'); 
const DeleteDataController = require('../controllers/DeleteModel');
const AccountController = require('../controllers/timetableController/AccountController');
const YearSemController = require('../controllers/timetableController/YearSemController');
const CourseController = require('../controllers/timetableController/CourseController');
const PairCourseController = require('../controllers/timetableController/PairCourseController');
const CurriculumController = require('../controllers/timetableController/CurriculumController');
const InstructorController = require('../controllers/timetableController/InstructorController');
const TimetableController = require('../controllers/timetableController/TimetableController');
const ReportMr30Controller = require('../controllers/timetableController/ReportMr30Controller');

// Public Authentication
router.post('/login', auth_login.getMicrosoftLogin);
router.post('/login/preset', auth_login.getPresetLogin);
router.post('/logout', auth_login.logout);

// JWT Authentication Guard (Protected Routes)
// ทุก Request ที่อยู่หลังจากนี้จะต้องแนบ Authorization: Bearer <token>
router.use(auth_sign.verifyToken);

// Account Management (RG_SCHEDULE_ACCOUNT)
router.get('/account/list', AccountController.listAccounts);
router.post('/account/add', AccountController.addAccount);
router.put('/account/update', AccountController.updateAccount);
router.delete('/account/delete/:email', AccountController.deleteAccount);

// Academic Year / Semester (RG_SCHEDULE_YEARSEM)
router.get('/yearsem/list', YearSemController.listYearSem);
router.get('/yearsem/active', YearSemController.getActiveYearSem);
router.post('/yearsem/add', YearSemController.addYearSem);
router.put('/yearsem/update', YearSemController.updateYearSem);
router.put('/yearsem/set-active', YearSemController.setActiveYearSem);
router.delete('/yearsem/delete/:year/:semester', YearSemController.deleteYearSem);

// Course (จัดการวิชาที่เปิดสอน)
router.get('/course/list', CourseController.listCourses);
router.get('/course/letters', CourseController.getFirstLetters);
router.get('/course/prefixes/:letter', CourseController.getPrefixGroups);
router.get('/course/search-ugb', CourseController.getCoursesByPrefix);
router.post('/course/add', CourseController.addCourse);
router.put('/course/update', CourseController.updateCourse);
router.delete('/course/delete/:year/:semester/:courseNo', CourseController.deleteCourse);
router.post('/course/delete-bulk', CourseController.deleteCoursesBulk);

// Pair Course (จัดการวิชาคู่)
router.get('/pair-course/list', PairCourseController.listPairCourses);
router.post('/pair-course/add', PairCourseController.addPairGroup);
router.put('/pair-course/update/:groupId', PairCourseController.updatePairGroup);
router.delete('/pair-course/delete/:groupId', PairCourseController.deletePairGroup);
router.post('/pair-course/delete-bulk', PairCourseController.deletePairGroupsBulk);

// Curriculum (จัดการหลักสูตร)
router.get('/curriculum/faculties', CurriculumController.getFaculties);
router.get('/curriculum/groups/:facultyNo', CurriculumController.getGroupsByFaculty);
router.get('/curriculum/sub-groups/:facultyNo/:groupNo', CurriculumController.getSubGroups);
router.get('/curriculum/list', CurriculumController.listCurriculumCourses);
router.post('/curriculum/add', CurriculumController.addCurriculumCourses);
router.post('/curriculum/delete', CurriculumController.deleteCurriculumCourse);
router.post('/curriculum/delete-bulk', CurriculumController.deleteCurriculumBulk);

// Instructor (จัดการอาจารย์ผู้สอน)
router.get('/instructor/list', InstructorController.listScheduleInstructors);
router.get('/instructor/master-list', InstructorController.getMasterInstructors);
router.post('/instructor/add', InstructorController.addScheduleInstructors);
router.post('/instructor/delete', InstructorController.deleteScheduleInstructor);
router.post('/instructor/delete-bulk', InstructorController.deleteBulkScheduleInstructors);

// Timetable (จัดการตารางสอน)
router.get('/timetable/list', TimetableController.listScheduleClasses);
router.get('/timetable/ru30-options', TimetableController.getRu30Options);
router.get('/timetable/letters', TimetableController.getFirstLetters);
router.get('/timetable/prefixes/:letter', TimetableController.getPrefixGroups);
router.get('/timetable/search-ugb', TimetableController.getCoursesByPrefix);
router.get('/timetable/instructors', TimetableController.getAllInstructors);
router.get('/timetable/instructor-availability', TimetableController.getInstructorAvailability);
router.get('/timetable/slot-available-instructors', TimetableController.getSlotAvailableInstructors);
router.get('/timetable/days', TimetableController.getDayOptions);
router.get('/timetable/times', TimetableController.getTimeSlots);
router.get('/timetable/rooms', TimetableController.getRoomOptions);
router.get('/timetable/scheduled-rooms', TimetableController.getScheduledRooms);
router.get('/timetable/check-instructor-conflicts', TimetableController.checkInstructorConflicts);
router.get('/timetable/recommend-slots', TimetableController.recommendSlots);
router.post('/timetable/clone-semester', TimetableController.cloneSemester);
router.post('/timetable/auto-schedule/solve', TimetableController.autoScheduleSolve);
router.post('/timetable/auto-schedule/apply', TimetableController.autoScheduleApply);
router.post('/timetable/add', TimetableController.addScheduleClass);
router.post('/timetable/update', TimetableController.updateScheduleClass);
router.post('/timetable/update-slots', TimetableController.updateScheduleSlots);
router.post('/timetable/delete', TimetableController.deleteScheduleClass);
router.post('/timetable/delete-bulk', TimetableController.deleteBulkScheduleClasses);

// Reports (รายงาน)
router.get('/report/mr30', ReportMr30Controller.getReportMr30);
router.get('/report/mr30/faculties', ReportMr30Controller.getFaculties);

// Test endpoints
router.get('/select', test.TestGetSelectdb);
router.get('/testinsert/:x', InsertDataController.testinsert);
router.put('/send', test.TestrevData);
router.post('/insertdb', InsertDataController.insertdb); 
router.delete('/deletedb', DeleteDataController.deletedb);
router.get('/testpool', SelectDataController.getSelectdb);

module.exports = router;
