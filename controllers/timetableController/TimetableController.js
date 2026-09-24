/**
 * TimetableController (Barrel / Index)
 *
 * ไฟล์นี้ทำหน้าที่รวม (re-export) ทุก method จากไฟล์ย่อย
 * เพื่อให้ routers/routes.js ไม่ต้องแก้ไข require path ใดๆ
 *
 * แผนผังไฟล์:
 *   TimetableListController.js  → listScheduleClasses, getRu30Options,
 *                                  getFirstLetters, getPrefixGroups, getCoursesByPrefix
 *   TimetableQueryController.js → getAllInstructors, getInstructorAvailability,
 *                                  getSlotAvailableInstructors, getDayOptions, getTimeSlots,
 *                                  getRoomOptions, getScheduledRooms,
 *                                  checkInstructorConflicts, recommendSlots
 *   TimetableCrudController.js  → addScheduleClass, updateScheduleClass,
 *                                  deleteScheduleClass, deleteBulkScheduleClasses,
 *                                  updateScheduleSlots
 *   TimetableAutoController.js  → cloneSemester, autoScheduleSolve, autoScheduleApply
 */

const TimetableListController = require('./TimetableListController');
const TimetableQueryController = require('./TimetableQueryController');
const TimetableCrudController = require('./TimetableCrudController');
const TimetableAutoController = require('./TimetableAutoController');

const TimetableController = {
    listScheduleClasses:        TimetableListController.listScheduleClasses.bind(TimetableListController),
    getRu30Options:             TimetableListController.getRu30Options.bind(TimetableListController),
    getFirstLetters:            TimetableListController.getFirstLetters.bind(TimetableListController),
    getPrefixGroups:            TimetableListController.getPrefixGroups.bind(TimetableListController),
    getCoursesByPrefix:         TimetableListController.getCoursesByPrefix.bind(TimetableListController),

    getAllInstructors:           TimetableQueryController.getAllInstructors.bind(TimetableQueryController),
    getInstructorAvailability:  TimetableQueryController.getInstructorAvailability.bind(TimetableQueryController),
    getSlotAvailableInstructors:TimetableQueryController.getSlotAvailableInstructors.bind(TimetableQueryController),
    getDayOptions:              TimetableQueryController.getDayOptions.bind(TimetableQueryController),
    getTimeSlots:               TimetableQueryController.getTimeSlots.bind(TimetableQueryController),
    getRoomOptions:             TimetableQueryController.getRoomOptions.bind(TimetableQueryController),
    getScheduledRooms:          TimetableQueryController.getScheduledRooms.bind(TimetableQueryController),
    checkInstructorConflicts:   TimetableQueryController.checkInstructorConflicts.bind(TimetableQueryController),
    recommendSlots:             TimetableQueryController.recommendSlots.bind(TimetableQueryController),
    getReferenceRoomSchedule:   TimetableQueryController.getReferenceRoomSchedule.bind(TimetableQueryController),

    addScheduleClass:           TimetableCrudController.addScheduleClass.bind(TimetableCrudController),
    updateScheduleClass:        TimetableCrudController.updateScheduleClass.bind(TimetableCrudController),
    deleteScheduleClass:        TimetableCrudController.deleteScheduleClass.bind(TimetableCrudController),
    deleteBulkScheduleClasses:  TimetableCrudController.deleteBulkScheduleClasses.bind(TimetableCrudController),
    updateScheduleSlots:        TimetableCrudController.updateScheduleSlots.bind(TimetableCrudController),
    copySingleClass:            TimetableCrudController.copySingleClass.bind(TimetableCrudController),

    cloneSemester:              TimetableAutoController.cloneSemester.bind(TimetableAutoController),
    copySelectedClasses:        TimetableAutoController.copySelectedClasses.bind(TimetableAutoController),
    autoScheduleSolve:          TimetableAutoController.autoScheduleSolve.bind(TimetableAutoController),
    autoScheduleApply:          TimetableAutoController.autoScheduleApply.bind(TimetableAutoController),
};

module.exports = TimetableController;
