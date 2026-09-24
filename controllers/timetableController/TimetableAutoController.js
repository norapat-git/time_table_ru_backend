const SelectModel = require('../../models/db/SelectModel');
const DbTxModel = require('../../models/db/DbTxModel');
const { sanitizeUsername, formatMilitaryTime } = require('../../utils/timetableUtils');

/**
 * TimetableAutoController
 * รับผิดชอบ: การจัดตารางสอนอัตโนมัติ และการคัดลอกตารางสอน
 *  - cloneSemester      → POST /timetable/clone-semester
 *  - autoScheduleSolve  → POST /timetable/auto-schedule/solve
 *  - autoScheduleApply  → POST /timetable/auto-schedule/apply
 */
const TimetableAutoController = {
    async cloneSemester(req, res) {
        try {
            const { sourceYear, sourceSemester, targetYear, targetSemester, mode, userInsert } = req.body;
            if (!sourceYear || !sourceSemester || !targetYear || !targetSemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปี/ภาคต้นทางและปลายทาง' });
            }

            const sYear = sourceYear.toString().trim();
            const sSem = sourceSemester.toString().trim();
            const tYear = targetYear.toString().trim();
            const tSem = targetSemester.toString().trim();
            const cloneMode = mode || 'merge';
            const user = sanitizeUsername(userInsert, 'ADMIN');

            if (sYear === tYear && sSem === tSem) {
                return res.status(400).json({ success: false, message: 'ปี/ภาคต้นทางและปลายทางต้องไม่ซ้ำกัน' });
            }

            let insertedClassesCount = 0;
            let insertedCoursesCount = 0;
            let insertedInstructorsCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                if (cloneMode === 'replace') {
                    // 1. สำรองและลบข้อมูลตารางสอนเดิม
                    await tx.executeOne(`
                        INSERT INTO RG_SCHEDULE_CLASS_HIS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                        )
                        SELECT STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, (SYSDATE + 7/24), USER_INSERT, :1
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                    `, [user, tYear, tSem]);

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);

                    // 2. สำรองและลบข้อมูลรายวิชาเดิม
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_COURSE_HIS (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK,
                                INSERT_DATE, USER_INSERT, INSERT_HIS_DATE, USER_INSERT_HIS
                            )
                            SELECT 
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK,
                                INSERT_DATE, USER_INSERT, (SYSDATE + 7/24), :1
                            FROM RG_SCHEDULE_COURSE
                            WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                        `, [user, tYear, tSem]);
                    } catch (e) {
                        console.warn('[cloneSemester archiveCourse warning]', e?.message);
                    }

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_COURSE WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);

                    // 3. สำรองและลบข้อมูลอาจารย์ผู้สอนเดิม
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_INSTRUCTOR_HIS (
                                STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                                INSERT_DATE, USER_INSERT, INSERT_HIS_DATE, USER_INSERT_HIS
                            )
                            SELECT 
                                STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE,
                                INSERT_DATE, USER_INSERT, (SYSDATE + 7/24), :1
                            FROM RG_SCHEDULE_INSTRUCTOR
                            WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3
                        `, [user, tYear, tSem]);
                    } catch (e) {
                        console.warn('[cloneSemester archiveInstr warning]', e?.message);
                    }

                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_INSTRUCTOR WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                }

                // ==========================================
                // 1. คัดลอกรายวิชา (RG_SCHEDULE_COURSE)
                // ==========================================
                const srcCourses = await tx.fetchAll(`
                    SELECT TRIM(COURSE_NO) AS COURSE_NO, TRIM(COURSE_REMARK) AS COURSE_REMARK
                    FROM RG_SCHEDULE_COURSE
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `, [sYear, sSem]);

                const srcClassCourses = await tx.fetchAll(`
                    SELECT DISTINCT TRIM(COURSE_NO) AS COURSE_NO
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                      AND COURSE_NO IS NOT NULL
                `, [sYear, sSem]);

                const coursesToCopy = new Map();
                (srcCourses || []).forEach(c => {
                    const cNo = (c.COURSE_NO || '').trim().toUpperCase();
                    if (cNo) coursesToCopy.set(cNo, c.COURSE_REMARK || null);
                });
                (srcClassCourses || []).forEach(c => {
                    const cNo = (c.COURSE_NO || '').trim().toUpperCase();
                    if (cNo && !coursesToCopy.has(cNo)) {
                        coursesToCopy.set(cNo, null);
                    }
                });

                const targetExistingCourses = new Set();
                if (cloneMode === 'merge') {
                    const existCourseRes = await tx.fetchAll(`
                        SELECT TRIM(COURSE_NO) AS COURSE_NO
                        FROM RG_SCHEDULE_COURSE
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                    (existCourseRes || []).forEach(r => {
                        if (r.COURSE_NO) targetExistingCourses.add(r.COURSE_NO.trim().toUpperCase());
                    });
                }

                for (const [courseNo, remark] of coursesToCopy.entries()) {
                    if (cloneMode === 'merge' && targetExistingCourses.has(courseNo)) {
                        continue;
                    }
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_COURSE (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, :4, (SYSDATE + 7/24), :5)
                        `, [tYear, tSem, courseNo, remark, user]);
                        insertedCoursesCount++;
                        targetExistingCourses.add(courseNo);
                    } catch (cErr) {
                        console.warn('[cloneSemester course insert notice]', courseNo, cErr?.message);
                    }
                }

                // ==========================================
                // 2. คัดลอกอาจารย์ผู้สอน (RG_SCHEDULE_INSTRUCTOR)
                // ==========================================
                const srcInstructors = await tx.fetchAll(`
                    SELECT DISTINCT TRIM(INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                    FROM RG_SCHEDULE_INSTRUCTOR
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                      AND INSTRUCTOR_CODE IS NOT NULL
                `, [sYear, sSem]);

                const srcTeachInstructors = await tx.fetchAll(`
                    SELECT DISTINCT TRIM(INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                    FROM RG_SCHEDULE_TEACH
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                      AND INSTRUCTOR_CODE IS NOT NULL
                `, [sYear, sSem]);

                const instructorsToCopy = new Set();
                (srcInstructors || []).forEach(i => {
                    const code = (i.INSTRUCTOR_CODE || '').trim();
                    if (code) instructorsToCopy.add(code);
                });
                (srcTeachInstructors || []).forEach(i => {
                    const code = (i.INSTRUCTOR_CODE || '').trim();
                    if (code) instructorsToCopy.add(code);
                });

                const targetExistingInstructors = new Set();
                if (cloneMode === 'merge') {
                    const existInstrRes = await tx.fetchAll(`
                        SELECT TRIM(INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                        FROM RG_SCHEDULE_INSTRUCTOR
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                    (existInstrRes || []).forEach(r => {
                        if (r.INSTRUCTOR_CODE) targetExistingInstructors.add(r.INSTRUCTOR_CODE.trim());
                    });
                }

                for (const instrCode of instructorsToCopy) {
                    if (cloneMode === 'merge' && targetExistingInstructors.has(instrCode)) {
                        continue;
                    }
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                                STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, (SYSDATE + 7/24), :4)
                        `, [tYear, tSem, instrCode, user]);
                        insertedInstructorsCount++;
                        targetExistingInstructors.add(instrCode);
                    } catch (iErr) {
                        console.warn('[cloneSemester instructor insert notice]', instrCode, iErr?.message);
                    }
                }

                // ==========================================
                // 3. คัดลอกตารางสอนและการสอน (RG_SCHEDULE_CLASS & RG_SCHEDULE_TEACH)
                // ==========================================
                const srcClassesSql = `
                    SELECT rc.* 
                    FROM RG_SCHEDULE_CLASS rc
                    WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                `;
                const srcClasses = await tx.fetchAll(srcClassesSql, [sYear, sSem]);

                if ((!srcClasses || srcClasses.length === 0) && coursesToCopy.size === 0 && instructorsToCopy.size === 0) {
                    throw new Error(`ไม่พบข้อมูลตารางสอน, รายวิชา หรืออาจารย์ในปี ${sYear} ภาค ${sSem} ต้นทาง`);
                }

                const targetExisting = new Set();
                if (cloneMode === 'merge') {
                    const existingRes = await tx.fetchAll(`
                        SELECT TRIM(COURSE_NO) AS COURSE_NO FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `, [tYear, tSem]);
                    (existingRes || []).forEach(r => targetExisting.add((r.COURSE_NO || '').trim().toUpperCase()));
                }

                const clonedInstrGroups = new Set();

                for (const item of (srcClasses || [])) {
                    const courseNo = (item.COURSE_NO || '').trim().toUpperCase();
                    if (cloneMode === 'merge' && targetExisting.has(courseNo)) {
                        continue;
                    }

                    await tx.executeOne(`
                        INSERT INTO RG_SCHEDULE_CLASS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, USER_INSERT
                        ) VALUES (:1, :2, :3, :4, :5, :6, :7, (SYSDATE + 7/24), :8)
                    `, [
                        tYear,
                        tSem,
                        courseNo,
                        item.DAY_CODE,
                        item.TIME_CODE,
                        item.ROOM_CODE,
                        item.INSTR_GROUP,
                        user
                    ]);

                    const groupKey = item.INSTR_GROUP ? item.INSTR_GROUP.toString().trim() : null;
                    if (groupKey && !clonedInstrGroups.has(groupKey)) {
                        clonedInstrGroups.add(groupKey);

                        const teaches = await tx.fetchAll(`
                            SELECT * FROM RG_SCHEDULE_TEACH 
                            WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3
                        `, [sYear, sSem, groupKey]);

                        for (const t of (teaches || [])) {
                            try {
                                await tx.executeOne(`
                                    INSERT INTO RG_SCHEDULE_TEACH (
                                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD, INSERT_DATE, USER_INSERT
                                    ) VALUES (:1, :2, :3, :4, :5, (SYSDATE + 7/24), :6)
                                `, [
                                    tYear,
                                    tSem,
                                    groupKey,
                                    t.INSTRUCTOR_CODE,
                                    t.INSTRUCTOR_ORD,
                                    user
                                ]);
                            } catch (teachErr) {
                                console.warn('[cloneSemester teach insert notice]', teachErr?.message);
                            }
                        }
                    }

                    insertedClassesCount++;
                }

                try {
                    await tx.executeOne(`
                        DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP 
                        WHERE INSTR_GROUP NOT IN (
                            SELECT DISTINCT INSTR_GROUP 
                            FROM RG_SCHEDULE_CLASS 
                            WHERE INSTR_GROUP IS NOT NULL
                        )
                    `);
                } catch (e) {}
            });

            return res.status(200).json({
                success: true,
                message: `คัดลอกตารางสอนสำเร็จ ${insertedClassesCount} คาบ, รายวิชา ${insertedCoursesCount} วิชา, อาจารย์ ${insertedInstructorsCount} ท่าน ไปยังปี ${tYear} ภาค ${tSem}`,
                insertedCount: insertedClassesCount,
                insertedCoursesCount,
                insertedInstructorsCount
            });
        } catch (error) {
            console.error('[TimetableAutoController.cloneSemester error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async autoScheduleSolve(req, res) {
        try {
            const { studyYear, studySemester, courseNos, allowedRoomCodes, maxClassesPerDay, avoidEveningSlots } = req.body;
            if (!studyYear || !studySemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีและภาคการศึกษา' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const maxPerDay = Number(maxClassesPerDay) || 2;
            const skipEvening = avoidEveningSlots !== false;

            let coursesToSchedule = [];
            if (Array.isArray(courseNos) && courseNos.length > 0) {
                const inP = courseNos.map((_, i) => `:${i + 1}`).join(', ');
                const cSql = `
                    SELECT TRIM(c.COURSE_NO) AS COURSE_NO, MAX(TRIM(c.COURSE_NAME_THAI)) AS COURSE_NAME_THAI, MAX(c.CREDIT) AS CREDIT
                    FROM UGB_COURSE c
                    WHERE TRIM(c.COURSE_NO) IN (${inP})
                    GROUP BY TRIM(c.COURSE_NO)
                `;
                const cRes = await SelectModel.findAll(res, cSql, courseNos.map(c => c.toString().trim().toUpperCase()));
                coursesToSchedule = cRes?.rows || [];
            } else {
                const cSql = `
                    SELECT TRIM(c.COURSE_NO) AS COURSE_NO, MAX(TRIM(c.COURSE_NAME_THAI)) AS COURSE_NAME_THAI, MAX(c.CREDIT) AS CREDIT
                    FROM UGB_COURSE c
                    WHERE ROWNUM <= 25
                    GROUP BY TRIM(c.COURSE_NO)
                `;
                const cRes = await SelectModel.findAll(res, cSql, []);
                coursesToSchedule = cRes?.rows || [];
            }

            let rooms = [];
            if (Array.isArray(allowedRoomCodes) && allowedRoomCodes.length > 0) {
                rooms = allowedRoomCodes.map(r => r.toString().trim()).filter(Boolean);
            } else {
                rooms = ['1', '2', '3', '4', '5', '6'];
            }

            const occSql = `
                SELECT TRIM(ROOM_CODE) AS ROOM_CODE, DAY_CODE, TIME_CODE, TRIM(COURSE_NO) AS COURSE_NO
                FROM RG_SCHEDULE_CLASS
                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
            `;
            const occRes = await SelectModel.findAll(res, occSql, [cleanYear, cleanSem]);
            const occupiedRooms = new Set();
            (occRes?.rows || []).forEach(r => {
                occupiedRooms.add(`${r.ROOM_CODE}_${r.DAY_CODE}_${r.TIME_CODE}`);
            });

            const proposedSchedule = [];
            const unassigned = [];
            const instDailyLoads = {};

            const dayNames = {
                1: 'วันจันทร์', 2: 'วันอังคาร', 3: 'วันพุธ', 4: 'วันพฤหัสบดี',
                5: 'วันศุกร์', 6: 'วันเสาร์', 7: 'วันอาทิตย์'
            };
            const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
            const timeFlag = isSummer ? '2' : '1';
            let timeSlots = [];
            try {
                const timeSql = `
                    SELECT TRIM(TIME_CODE) AS TIME_CODE, TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                    FROM RG_SCHEDULE_TIME
                    WHERE TRIM(TIME_FLAG) = :1
                    ORDER BY TO_NUMBER(TIME_CODE) ASC
                `;
                const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag]);
                const dbRows = timeRes?.rows || [];
                if (dbRows.length > 0) {
                    timeSlots = dbRows.map(r => ({
                        timeCode: Number(r.TIME_CODE),
                        period: `${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)}`,
                        label: `คาบที่ ${r.TIME_CODE} (${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)})`
                    }));
                }
            } catch (tErr) {
                console.error('[autoScheduleSolve timeSql error]', tErr);
            }
            if (timeSlots.length === 0) {
                const fallbackRows = timeFlag === '2'
                    ? [
                        { TIME_CODE: '1', TIME_START: '0835', TIME_END: '0950' },
                        { TIME_CODE: '2', TIME_START: '0955', TIME_END: '1110' },
                        { TIME_CODE: '3', TIME_START: '1115', TIME_END: '1230' },
                        { TIME_CODE: '4', TIME_START: '1235', TIME_END: '1350' },
                        { TIME_CODE: '5', TIME_START: '1355', TIME_END: '1510' },
                    ]
                    : [
                        { TIME_CODE: '1', TIME_START: '0800', TIME_END: '0915' },
                        { TIME_CODE: '2', TIME_START: '0925', TIME_END: '1040' },
                        { TIME_CODE: '3', TIME_START: '1050', TIME_END: '1205' },
                        { TIME_CODE: '4', TIME_START: '1215', TIME_END: '1330' },
                        { TIME_CODE: '5', TIME_START: '1340', TIME_END: '1455' },
                        { TIME_CODE: '6', TIME_START: '1505', TIME_END: '1620' },
                    ];
                timeSlots = fallbackRows.map(r => ({
                    timeCode: Number(r.TIME_CODE),
                    period: `${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)}`,
                    label: `คาบที่ ${r.TIME_CODE} (${formatMilitaryTime(r.TIME_START)} - ${formatMilitaryTime(r.TIME_END)})`
                }));
            }
            const timeSlotsMap = {};
            timeSlots.forEach(ts => { timeSlotsMap[ts.timeCode] = ts; });

            for (const course of coursesToSchedule) {
                const cNo = (course.COURSE_NO || '').trim().toUpperCase();
                let placed = false;

                dayLoop: for (let day = 1; day <= 5; day++) {
                    const maxTime = skipEvening ? 5 : 7;
                    for (let time = 1; time <= maxTime; time++) {
                        for (const room of rooms) {
                            const key = `${room}_${day}_${time}`;
                            if (!occupiedRooms.has(key)) {
                                const alreadyInDay = proposedSchedule.some(p => p.courseNo === cNo && p.dayCode === day);
                                if (alreadyInDay) continue;

                                occupiedRooms.add(key);
                                proposedSchedule.push({
                                    courseNo: cNo,
                                    courseName: course.COURSE_NAME_THAI || '',
                                    credit: course.CREDIT || 3,
                                    dayCode: day,
                                    dayLabel: dayNames[day],
                                    timeCode: time,
                                    timeLabel: timeSlotsMap[time]?.label || `คาบที่ ${time}`,
                                    period: timeSlotsMap[time]?.period || '',
                                    roomCode: room,
                                });
                                placed = true;
                                break dayLoop;
                            }
                        }
                    }
                }

                if (!placed) {
                    unassigned.push({
                        courseNo: cNo,
                        courseName: course.COURSE_NAME_THAI || '',
                        reason: 'ไม่มีห้องว่างตรงกับเงื่อนไขที่กำหนด'
                    });
                }
            }

            return res.status(200).json({
                success: true,
                totalRequested: coursesToSchedule.length,
                scheduledCount: proposedSchedule.length,
                unassignedCount: unassigned.length,
                proposedSchedule,
                unassigned
            });
        } catch (error) {
            console.error('[TimetableAutoController.autoScheduleSolve error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async autoScheduleApply(req, res) {
        try {
            const { studyYear, studySemester, items, userInsert } = req.body;
            if (!studyYear || !studySemester || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุรายการที่ต้องการบันทึก' });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const user = sanitizeUsername(userInsert, 'AUTO_SCHEDULER');

            let savedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const item of items) {
                    const cNo = (item.courseNo || '').trim().toUpperCase();
                    const day = Number(item.dayCode);
                    const time = Number(item.timeCode);
                    const room = (item.roomCode || '').trim();

                    if (!cNo || isNaN(day) || isNaN(time) || !room) continue;

                    const existRes = await tx.fetchAll(`
                        SELECT COUNT(*) AS CNT FROM RG_SCHEDULE_CLASS 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3
                    `, [cleanYear, cleanSem, cNo]);

                    const count = Number(existRes?.[0]?.CNT || 0);
                    if (count > 0) {
                        await tx.executeOne(`
                            UPDATE RG_SCHEDULE_CLASS 
                            SET DAY_CODE = :1, TIME_CODE = :2, ROOM_CODE = :3, INSERT_DATE = (SYSDATE + 7/24), USER_INSERT = :4
                            WHERE TRIM(STUDY_YEAR) = :5 AND TRIM(STUDY_SEMESTER) = :6 AND TRIM(COURSE_NO) = :7
                        `, [day, time, room, user, cleanYear, cleanSem, cNo]);
                    } else {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_CLASS (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, :4, :5, :6, (SYSDATE + 7/24), :7)
                        `, [cleanYear, cleanSem, cNo, day, time, room, user]);
                    }
                    savedCount++;
                }
            });

            return res.status(200).json({
                success: true,
                message: `บันทึกผลการจัดตารางสอนสำเร็จ ${savedCount} รายการ`,
                savedCount
            });
        } catch (error) {
            console.error('[TimetableAutoController.autoScheduleApply error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    /**
     * คัดลอกรายวิชาเฉพาะที่เลือก ระหว่าง 2 ปี/ภาคการศึกษา (สำหรับ Tab จัดตารางสอนเทียบ)
     */
    async copySelectedClasses(req, res) {
        try {
            const { sourceYear, sourceSemester, targetYear, targetSemester, courseNos, copySlots, mode, userInsert } = req.body;
            if (!sourceYear || !sourceSemester || !targetYear || !targetSemester) {
                return res.status(400).json({ success: false, message: 'กรุณาระบุปีและภาคการศึกษาต้นทางและปลายทาง' });
            }

            const sYear = sourceYear.toString().trim();
            const sSem = sourceSemester.toString().trim();
            const tYear = targetYear.toString().trim();
            const tSem = targetSemester.toString().trim();
            const cloneMode = mode || 'merge';
            const user = sanitizeUsername(userInsert, 'SYSTEM');
            const shouldCopySlots = copySlots !== false;

            if (sYear === tYear && sSem === tSem) {
                return res.status(400).json({ success: false, message: 'ปี/ภาคต้นทางและปลายทางต้องไม่ซ้ำกัน' });
            }

            const rawList = Array.isArray(courseNos) ? courseNos : (courseNos ? [courseNos] : []);
            const cleanCourses = Array.from(new Set(rawList.map(c => (c || '').toString().trim().toUpperCase()).filter(Boolean)));

            if (cleanCourses.length === 0) {
                return res.status(400).json({ success: false, message: 'กรุณาเลือกรายวิชาที่ต้องการคัดลอกอย่างน้อย 1 วิชา' });
            }

            let insertedCoursesCount = 0;
            let insertedInstructorsCount = 0;
            let insertedClassesCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 1. ตรวจสอบปีภาคปลายทาง
                const semCheck = await tx.fetchOne(`
                    SELECT STUDY_YEAR, STUDY_SEMESTER FROM RG_SCHEDULE_YEARSEM 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                `, [tYear, tSem]);

                if (!semCheck) {
                    throw new Error(`ไม่พบปีการศึกษา ${tYear} ภาค ${tSem} ในระบบ กรุณาสร้างปีภาคการศึกษาก่อน`);
                }

                // 2. ดึงข้อมูลรายวิชาต้นทางจาก RG_SCHEDULE_COURSE
                const inCoursesPlaceholders = cleanCourses.map((_, i) => `:${i + 3}`).join(', ');
                const srcCourseSql = `
                    SELECT TRIM(COURSE_NO) AS COURSE_NO, TRIM(COURSE_REMARK) AS COURSE_REMARK
                    FROM RG_SCHEDULE_COURSE
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                      AND TRIM(COURSE_NO) IN (${inCoursesPlaceholders})
                `;
                const srcCourseRes = await tx.fetchAll(srcCourseSql, [sYear, sSem, ...cleanCourses]);
                const srcRemarksMap = new Map();
                (srcCourseRes || []).forEach(r => {
                    const cNo = (r.COURSE_NO || '').trim().toUpperCase();
                    if (cNo) srcRemarksMap.set(cNo, r.COURSE_REMARK || null);
                });

                // 3. ตรวจสอบวิชาที่มีอยู่แล้วในเทอมปลายทาง
                const targetExistCourseSql = `
                    SELECT TRIM(COURSE_NO) AS COURSE_NO
                    FROM RG_SCHEDULE_COURSE
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                      AND TRIM(COURSE_NO) IN (${inCoursesPlaceholders})
                `;
                const targetExistCourseRes = await tx.fetchAll(targetExistCourseSql, [tYear, tSem, ...cleanCourses]);
                const targetExistCourses = new Set((targetExistCourseRes || []).map(r => (r.COURSE_NO || '').trim().toUpperCase()));

                // เพิ่มวิชาลงใน RG_SCHEDULE_COURSE ของเทอมปลายทาง
                for (const cNo of cleanCourses) {
                    if (!targetExistCourses.has(cNo)) {
                        try {
                            const remark = srcRemarksMap.get(cNo) || null;
                            await tx.executeOne(`
                                INSERT INTO RG_SCHEDULE_COURSE (
                                    STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK, INSERT_DATE, USER_INSERT
                                ) VALUES (:1, :2, :3, :4, (SYSDATE + 7/24), :5)
                            `, [tYear, tSem, cNo, remark, user]);
                            insertedCoursesCount++;
                            targetExistCourses.add(cNo);
                        } catch (cErr) {
                            console.warn('[copySelectedClasses course insert notice]', cNo, cErr?.message);
                        }
                    }
                }

                // 4. ดึงข้อมูลอาจารย์ที่สอนวิชาเหล่านี้จากต้นทาง
                const srcInstructorsSql = `
                    SELECT DISTINCT TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                    FROM RG_SCHEDULE_CLASS rc
                    JOIN RG_SCHEDULE_TEACH rt 
                      ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR)
                     AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER)
                     AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                    WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                      AND TRIM(rc.COURSE_NO) IN (${inCoursesPlaceholders})
                      AND rt.INSTRUCTOR_CODE IS NOT NULL
                `;
                const srcInstructorsRes = await tx.fetchAll(srcInstructorsSql, [sYear, sSem, ...cleanCourses]);
                const instructorsToEnsure = Array.from(new Set(
                    (srcInstructorsRes || []).map(r => (r.INSTRUCTOR_CODE || '').trim()).filter(Boolean)
                ));

                if (instructorsToEnsure.length === 0) {
                    try {
                        const ru30InstructorsSql = `
                            SELECT DISTINCT TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                            FROM UGB_RU30 ru
                            WHERE TRIM(ru.STUDY_YEAR) = :1 AND TRIM(ru.STUDY_SEMESTER) = :2
                              AND TRIM(ru.COURSE_NO) IN (${inCoursesPlaceholders})
                              AND ru.INSTRUCTOR_CODE IS NOT NULL
                        `;
                        const ru30Res = await tx.fetchAll(ru30InstructorsSql, [sYear, sSem, ...cleanCourses]);
                        (ru30Res || []).forEach(r => {
                            const code = (r.INSTRUCTOR_CODE || '').trim();
                            if (code && !instructorsToEnsure.includes(code)) {
                                instructorsToEnsure.push(code);
                            }
                        });
                    } catch (ruErr) {
                        console.warn('[copySelectedClasses ru30 instructor notice]', ruErr?.message);
                    }
                }

                if (instructorsToEnsure.length > 0) {
                    const inInstrPlaceholders = instructorsToEnsure.map((_, i) => `:${i + 3}`).join(', ');
                    const targetExistInstrSql = `
                        SELECT TRIM(INSTRUCTOR_CODE) AS INSTRUCTOR_CODE
                        FROM RG_SCHEDULE_INSTRUCTOR
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                          AND TRIM(INSTRUCTOR_CODE) IN (${inInstrPlaceholders})
                    `;
                    const targetExistInstrRes = await tx.fetchAll(targetExistInstrSql, [tYear, tSem, ...instructorsToEnsure]);
                    const targetExistInstructors = new Set((targetExistInstrRes || []).map(r => (r.INSTRUCTOR_CODE || '').trim()));

                    for (const instrCode of instructorsToEnsure) {
                        if (!targetExistInstructors.has(instrCode)) {
                            try {
                                await tx.executeOne(`
                                    INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                                    ) VALUES (:1, :2, :3, (SYSDATE + 7/24), :4)
                                `, [tYear, tSem, instrCode, user]);
                                insertedInstructorsCount++;
                                targetExistInstructors.add(instrCode);
                            } catch (iErr) {
                                console.warn('[copySelectedClasses instructor insert notice]', instrCode, iErr?.message);
                            }
                        }
                    }
                }

                // 5. คัดลอกคาบสอน (RG_SCHEDULE_CLASS) และการมอบหมายอาจารย์ (RG_SCHEDULE_TEACH)
                if (shouldCopySlots) {
                    const srcClassesSql = `
                        SELECT rc.* 
                        FROM RG_SCHEDULE_CLASS rc
                        WHERE TRIM(rc.STUDY_YEAR) = :1 AND TRIM(rc.STUDY_SEMESTER) = :2
                          AND TRIM(rc.COURSE_NO) IN (${inCoursesPlaceholders})
                    `;
                    const srcClasses = await tx.fetchAll(srcClassesSql, [sYear, sSem, ...cleanCourses]);

                    // ดึงคาบเรียนทั้งหมดในเทอมปลายทางเพื่อตรวจจับการชนกันของห้องและเวลา (Room Conflict)
                    const targetAllClassesSql = `
                        SELECT TRIM(COURSE_NO) AS COURSE_NO, DAY_CODE, TIME_CODE, TRIM(ROOM_CODE) AS ROOM_CODE, INSTR_GROUP
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                    `;
                    const targetAllClasses = await tx.fetchAll(targetAllClassesSql, [tYear, tSem]);

                    const targetClassSlots = new Set(
                        (targetAllClasses || []).map(c => `${(c.COURSE_NO || '').trim().toUpperCase()}_${c.DAY_CODE}_${c.TIME_CODE}`)
                    );

                    // Map สำหรับค้นหาห้องที่ถูกใช้งานแล้วในปลายทาง: `${ROOM_CODE}_${DAY_CODE}_${TIME_CODE}` -> COURSE_NO
                    const occupiedRoomSlots = new Map();
                    (targetAllClasses || []).forEach(c => {
                        const rCode = (c.ROOM_CODE || '').trim().toUpperCase();
                        if (rCode) {
                            occupiedRoomSlots.set(`${rCode}_${c.DAY_CODE}_${c.TIME_CODE}`, (c.COURSE_NO || '').trim().toUpperCase());
                        }
                    });

                    const clonedInstrGroups = new Set();
                    const skippedConflicts = [];

                    for (const item of (srcClasses || [])) {
                        const cNo = (item.COURSE_NO || '').trim().toUpperCase();
                        const slotKey = `${cNo}_${item.DAY_CODE}_${item.TIME_CODE}`;
                        const rCode = (item.ROOM_CODE || '').trim().toUpperCase();
                        const roomSlotKey = rCode ? `${rCode}_${item.DAY_CODE}_${item.TIME_CODE}` : null;

                        // ตรวจสอบคาบที่ซ้ำของวิชาเดียวกัน
                        if (targetClassSlots.has(slotKey)) {
                            continue;
                        }

                        // ตรวจสอบว่าห้องเรียนในวันและคาบดังกล่าว มีวิชาอื่นใช้อยู่แล้วหรือไม่ (Room Conflict)
                        if (roomSlotKey && occupiedRoomSlots.has(roomSlotKey)) {
                            const existOtherCourse = occupiedRoomSlots.get(roomSlotKey);
                            if (existOtherCourse !== cNo) {
                                if (cloneMode === 'replace') {
                                    // หากเลือกโหมดแทนที่ ให้ลบวิชาเดิมที่ชนกันออกจากช่องห้องนี้
                                    await tx.executeOne(`
                                        DELETE FROM RG_SCHEDULE_CLASS
                                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                                          AND DAY_CODE = :3 AND TIME_CODE = :4 AND TRIM(ROOM_CODE) = :5
                                    `, [tYear, tSem, item.DAY_CODE, item.TIME_CODE, rCode]);
                                } else {
                                    // โหมด merge: ห้ามนำวิชาไปทับซ้อนในห้องเรียนเดียวกันเด็ดขาด (ป้องกันการชนกัน)
                                    skippedConflicts.push(`วิชา ${cNo} คาบวัน ${item.DAY_CODE} คาบ ${item.TIME_CODE} ชนกับวิชา ${existOtherCourse} ในห้อง ${rCode}`);
                                    continue;
                                }
                            }
                        }

                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_CLASS (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, :4, :5, :6, :7, (SYSDATE + 7/24), :8)
                        `, [
                            tYear,
                            tSem,
                            cNo,
                            item.DAY_CODE,
                            item.TIME_CODE,
                            item.ROOM_CODE,
                            item.INSTR_GROUP,
                            user
                        ]);

                        if (roomSlotKey) {
                            occupiedRoomSlots.set(roomSlotKey, cNo);
                        }
                        targetClassSlots.add(slotKey);
                        insertedClassesCount++;

                        const groupKey = item.INSTR_GROUP ? item.INSTR_GROUP.toString().trim() : null;
                        if (groupKey && !clonedInstrGroups.has(groupKey)) {
                            clonedInstrGroups.add(groupKey);

                            const teaches = await tx.fetchAll(`
                                SELECT * FROM RG_SCHEDULE_TEACH 
                                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3
                            `, [sYear, sSem, groupKey]);

                            for (const t of (teaches || [])) {
                                try {
                                    await tx.executeOne(`
                                        INSERT INTO RG_SCHEDULE_TEACH (
                                            STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD, INSERT_DATE, USER_INSERT
                                        ) VALUES (:1, :2, :3, :4, :5, (SYSDATE + 7/24), :6)
                                    `, [
                                        tYear,
                                        tSem,
                                        groupKey,
                                        t.INSTRUCTOR_CODE,
                                        t.INSTRUCTOR_ORD,
                                        user
                                    ]);
                                } catch (tErr) {
                                    console.warn('[copySelectedClasses teach insert notice]', tErr?.message);
                                }
                            }
                        }
                    }

                    // สรุปข้อความกรณีมีคาบชนกัน
                    if (skippedConflicts.length > 0) {
                        console.warn('[copySelectedClasses skipped conflicts]', skippedConflicts);
                    }
                }
            });

            return res.status(200).json({
                success: true,
                message: `คัดลอกสำเร็จ: เพิ่มรายวิชา ${insertedCoursesCount} วิชา, คาบสอน ${insertedClassesCount} คาบ, อาจารย์ ${insertedInstructorsCount} ท่าน ไปยังปี ${tYear} ภาค ${tSem}`,
                insertedCoursesCount,
                insertedClassesCount,
                insertedInstructorsCount,
            });
        } catch (error) {
            console.error('[TimetableAutoController.copySelectedClasses error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    }
};

module.exports = TimetableAutoController;
