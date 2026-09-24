const SelectModel = require('../../models/db/SelectModel');
const DbTxModel = require('../../models/db/DbTxModel');
const { sanitizeUsername, formatMilitaryTime, isTimeOverlapping } = require('../../utils/timetableUtils');

/**
 * รีเซ็ต Sequence NEXT_GROUP ให้กลับมาเริ่มที่ 1 (เมื่อไม่มีข้อมูลในตาราง RG_SCHEDULE_INSTRUCTOR_GROUP)
 */
async function resetNextGroupSequence(tx) {
    try {
        await tx.executeOne(`DROP SEQUENCE NEXT_GROUP`);
        await tx.executeOne(`CREATE SEQUENCE NEXT_GROUP START WITH 1 INCREMENT BY 1 CACHE 20`);
    } catch (err) {
        console.warn('[resetNextGroupSequence notice]', err?.message);
    }
}

/**
 * ล้างกลุ่มผู้สอนที่ไม่มีคลาสใดใน RG_SCHEDULE_CLASS ใช้งานแล้ว ออกจาก RG_SCHEDULE_TEACH และ RG_SCHEDULE_INSTRUCTOR_GROUP
 */
async function cleanupOrphanInstructorGroups(tx) {
    try {
        await tx.executeOne(`
            DELETE FROM RG_SCHEDULE_TEACH 
            WHERE TRIM(INSTRUCTOR_GROUP) NOT IN (
                SELECT DISTINCT TRIM(TO_CHAR(INSTR_GROUP)) 
                FROM RG_SCHEDULE_CLASS 
                WHERE INSTR_GROUP IS NOT NULL
            )
        `);
        await tx.executeOne(`
            DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP 
            WHERE INSTR_GROUP NOT IN (
                SELECT DISTINCT INSTR_GROUP 
                FROM RG_SCHEDULE_CLASS 
                WHERE INSTR_GROUP IS NOT NULL
            )
        `);

        const countRes = await tx.fetchOne(`SELECT COUNT(*) AS CNT FROM RG_SCHEDULE_INSTRUCTOR_GROUP`);
        if (Number(countRes?.CNT || 0) === 0) {
            await resetNextGroupSequence(tx);
        }
    } catch (err) {
        console.warn('[cleanupOrphanInstructorGroups notice]', err?.message);
    }
}


async function getNextInstrGroup(tx) {
    const countRes = await tx.fetchOne(`SELECT COUNT(*) AS CNT FROM RG_SCHEDULE_INSTRUCTOR_GROUP`);
    const totalGroups = Number(countRes?.CNT || 0);

    if (totalGroups === 0) {
        await resetNextGroupSequence(tx);
    }
    const seqRow = await tx.fetchOne(`SELECT NEXT_GROUP.NEXTVAL AS NEXT_ID FROM DUAL`);
    let nextGroup = Number(seqRow?.NEXT_ID || 1);

    const checkSql = `
        SELECT 1 FROM (
            SELECT INSTR_GROUP FROM RG_SCHEDULE_CLASS WHERE INSTR_GROUP = :1
            UNION
            SELECT INSTR_GROUP FROM RG_SCHEDULE_INSTRUCTOR_GROUP WHERE INSTR_GROUP = :1
            UNION
            SELECT TO_NUMBER(INSTRUCTOR_GROUP) AS INSTR_GROUP 
            FROM RG_SCHEDULE_TEACH 
            WHERE REGEXP_LIKE(TRIM(INSTRUCTOR_GROUP), '^[0-9]+$') AND TO_NUMBER(INSTRUCTOR_GROUP) = :1
        ) WHERE ROWNUM = 1
    `;
    let exists = await tx.fetchOne(checkSql, [nextGroup]);
    while (exists) {
        const nextSeq = await tx.fetchOne(`SELECT NEXT_GROUP.NEXTVAL AS NEXT_ID FROM DUAL`);
        nextGroup = Number(nextSeq?.NEXT_ID || (nextGroup + 1));
        exists = await tx.fetchOne(checkSql, [nextGroup]);
    }

    return nextGroup;
}

/**
 * TimetableCrudController
 * รับผิดชอบ: เพิ่ม / แก้ไข / ลบ / ย้ายคาบตารางสอน
 *  - addScheduleClass          → POST /timetable/add
 *  - updateScheduleClass       → POST /timetable/update
 *  - deleteScheduleClass       → POST /timetable/delete
 *  - deleteBulkScheduleClasses → POST /timetable/delete-bulk
 *  - updateScheduleSlots       → POST /timetable/update-slots
 */
const TimetableCrudController = {
    async addScheduleClass(req, res) {
        try {
            const { studyYear, studySemester, courseNo, dayCode, timeCode, timeCodes, roomCode, instructorCodes, userInsert } = req.body;

            let targetTimeCodes = [];
            if (Array.isArray(timeCodes) && timeCodes.length > 0) {
                targetTimeCodes = Array.from(new Set(timeCodes.map(Number).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
            } else if (timeCode !== undefined && timeCode !== null && timeCode !== '') {
                targetTimeCodes = [Number(timeCode)];
            }

            if (!studyYear || !studySemester || !courseNo || dayCode === undefined || dayCode === null || targetTimeCodes.length === 0 || !roomCode || !roomCode.toString().trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุข้อมูลจำเป็นให้ครบถ้วน (ปี, ภาค, รหัสวิชา, วัน, คาบเวลา, ห้องเรียน)',
                });
            }

            if (targetTimeCodes.length > 1) {
                for (let i = 0; i < targetTimeCodes.length - 1; i++) {
                    if (targetTimeCodes[i + 1] !== targetTimeCodes[i] + 1) {
                        return res.status(400).json({
                            success: false,
                            message: 'คาบเวลาที่เลือกมากกว่า 1 คาบจะต้องเป็นคาบที่ติดกันเท่านั้น',
                        });
                    }
                }
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanDay = Number(dayCode);
            const cleanRoom = (roomCode || '').toString().trim();
            const user = sanitizeUsername(userInsert, 'ADMIN');

            if (cleanRoom && cleanRoom !== '-') {
                for (const cleanTime of targetTimeCodes) {
                    const roomCheckSql = `
                        SELECT 
                            TRIM(rc.COURSE_NO) AS COURSE_NO,
                            uc.COURSE_NAME_THAI
                        FROM RG_SCHEDULE_CLASS rc
                        LEFT JOIN (
                            SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI
                            FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                        ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                        WHERE TRIM(rc.STUDY_YEAR) = :1
                          AND TRIM(rc.STUDY_SEMESTER) = :2
                          AND rc.DAY_CODE = :3
                          AND rc.TIME_CODE = :4
                          AND UPPER(TRIM(rc.ROOM_CODE)) = UPPER(TRIM(:5))
                    `;
                    const roomCheckRes = await SelectModel.findAll(res, roomCheckSql, [cleanYear, cleanSem, cleanDay, cleanTime, cleanRoom]);
                    const existingRoomClasses = roomCheckRes.rows || [];

                    if (existingRoomClasses.length > 0) {
                        for (const er of existingRoomClasses) {
                            const existingCourseNo = (er.COURSE_NO || '').trim().toUpperCase();
                            if (existingCourseNo === cleanCourseNo) {
                                return res.status(400).json({
                                    success: false,
                                    message: `วิชา ${cleanCourseNo} มีการจัดตารางสอนในห้อง ${cleanRoom} วันดังกล่าว คาบที่ ${cleanTime} อยู่แล้ว`,
                                });
                            }

                            const pairCheckSql = `
                                SELECT COUNT(*) AS CNT
                                FROM RG_SCHEDULE_PAIR_COURSE p1
                                JOIN RG_SCHEDULE_PAIR_COURSE p2 
                                  ON p1.PAIR_COURSE_GROUP_ID = p2.PAIR_COURSE_GROUP_ID
                                WHERE UPPER(TRIM(p1.COURSE_NO)) = :1 
                                  AND UPPER(TRIM(p2.COURSE_NO)) = :2
                            `;
                            const pairRes = await SelectModel.findAll(res, pairCheckSql, [cleanCourseNo, existingCourseNo]);
                            const isPaired = (pairRes.rows?.[0]?.CNT || 0) > 0;

                            if (!isPaired) {
                                const thaiName = er.COURSE_NAME_THAI ? ` (${er.COURSE_NAME_THAI})` : '';
                                return res.status(400).json({
                                    success: false,
                                    message: `ห้อง ${cleanRoom} ในวันดังกล่าว คาบที่ ${cleanTime} มีวิชา ${existingCourseNo}${thaiName} ใช้งานอยู่แล้ว (ห้ามจัดห้องชนกัน)`,
                                });
                            }
                        }
                    }

                    const checkCourseSql = `
                        SELECT COUNT(*) AS CNT
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :1
                          AND TRIM(STUDY_SEMESTER) = :2
                          AND UPPER(TRIM(COURSE_NO)) = :3
                          AND DAY_CODE = :4
                          AND TIME_CODE = :5
                    `;
                    const checkCourseRes = await SelectModel.findAll(res, checkCourseSql, [cleanYear, cleanSem, cleanCourseNo, cleanDay, cleanTime]);
                    if (Number(checkCourseRes.rows?.[0]?.CNT ?? 0) > 0) {
                        return res.status(400).json({
                            success: false,
                            message: `วิชา ${cleanCourseNo} มีการจัดตารางสอนในวันดังกล่าว คาบที่ ${cleanTime} อยู่แล้ว`,
                        });
                    }
                }
            }

            const rawCodes = Array.isArray(instructorCodes) ? instructorCodes : [];
            const uniqueCodes = Array.from(new Set(rawCodes.map((c) => (c || '').toString().trim()).filter(Boolean))).sort();

            if (uniqueCodes.length > 0) {
                const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
                const timeFlag = isSummer ? '2' : '1';
                let targetSlotTimes = [];
                try {
                    const inTimeP = targetTimeCodes.map((_, i) => `:${i + 2}`).join(', ');
                    const timeSql = `
                        SELECT TRIM(TIME_CODE) AS TIME_CODE, TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                        FROM RG_SCHEDULE_TIME
                        WHERE TRIM(TIME_FLAG) = :1 AND TRIM(TIME_CODE) IN (${inTimeP})
                    `;
                    const timeRes = await SelectModel.findAll(res, timeSql, [timeFlag, ...targetTimeCodes.map(String)]);
                    targetSlotTimes = (timeRes?.rows || []).map(r => ({
                        timeCode: Number(r.TIME_CODE),
                        timeStart: r.TIME_START,
                        timeEnd: r.TIME_END
                    }));
                } catch (tErr) {
                    console.error('[addScheduleClass timeSql error]', tErr);
                }

                if (targetSlotTimes.length === 0) {
                    const defaultTimes = timeFlag === '2'
                        ? { 1: ['0835', '0950'], 2: ['0955', '1110'], 3: ['1115', '1230'], 4: ['1235', '1350'], 5: ['1355', '1510'] }
                        : { 1: ['0800', '0915'], 2: ['0925', '1040'], 3: ['1050', '1205'], 4: ['1215', '1330'], 5: ['1340', '1455'], 6: ['1505', '1620'] };
                    targetSlotTimes = targetTimeCodes.map(t => ({
                        timeCode: t,
                        timeStart: defaultTimes[t] ? defaultTimes[t][0] : '0800',
                        timeEnd: defaultTimes[t] ? defaultTimes[t][1] : '0915'
                    }));
                }

                try {
                    const inInstP = uniqueCodes.map((_, i) => `:${i + 4}`).join(', ');
                    const ru30Sql = `
                        SELECT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                            TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                            ru.DAY_CODE,
                            TRIM(ts.TIME_START) AS RU30_START,
                            TRIM(ts.TIME_END) AS RU30_END,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                        WHERE TRIM(ru.STUDY_YEAR) = :1 
                          AND TRIM(ru.STUDY_SEMESTER) = :2
                          AND ru.DAY_CODE = :3
                          AND TRIM(ru.INSTRUCTOR_CODE) IN (${inInstP})
                    `;
                    let ru30Res = await SelectModel.findAll(res, ru30Sql, [cleanYear, cleanSem, cleanDay, ...uniqueCodes]);
                    let ru30Rows = ru30Res?.rows || [];

                    for (const r of ru30Rows) {
                        for (const slot of targetSlotTimes) {
                            if (isTimeOverlapping(slot.timeStart, slot.timeEnd, r.RU30_START, r.RU30_END)) {
                                const instName = `${r.RANK_NAME_THAI_S || ''} ${r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE}`.trim();
                                const ruPeriod = (r.RU30_START && r.RU30_END)
                                    ? `${formatMilitaryTime(r.RU30_START)} - ${formatMilitaryTime(r.RU30_END)}`
                                    : '';
                                const slotPeriod = `${formatMilitaryTime(slot.timeStart)} - ${formatMilitaryTime(slot.timeEnd)}`;
                                return res.status(400).json({
                                    success: false,
                                    message: `อาจารย์ ${instName} (${r.INSTRUCTOR_CODE}) ติดสอนในระบบส่วนกลาง (มร.30) วิชา ${r.RU30_COURSE_NO} เวลา ${ruPeriod} ซึ่งชนกับคาบที่ ${slot.timeCode} (${slotPeriod})`,
                                });
                            }
                        }
                    }
                } catch (ru30Err) {
                    console.error('[addScheduleClass ru30 error]', ru30Err);
                }
            }

            if (uniqueCodes.length > 0) {
                for (const cleanTime of targetTimeCodes) {
                    const instPlaceholders = uniqueCodes.map((_, idx) => `:${idx + 6}`).join(',');
                    const instCheckSql = `
                        SELECT 
                            TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                            TRIM(rc.COURSE_NO) AS COURSE_NO,
                            TRIM(rc.ROOM_CODE) AS ROOM_CODE
                        FROM RG_SCHEDULE_CLASS rc
                        JOIN RG_SCHEDULE_TEACH rt 
                          ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                         AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                         AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        WHERE TRIM(rc.STUDY_YEAR) = :1
                          AND TRIM(rc.STUDY_SEMESTER) = :2
                          AND rc.DAY_CODE = :3
                          AND rc.TIME_CODE = :4
                          AND UPPER(TRIM(rc.COURSE_NO)) != :5
                          AND TRIM(rt.INSTRUCTOR_CODE) IN (${instPlaceholders})
                    `;
                    const instCheckParams = [cleanYear, cleanSem, cleanDay, cleanTime, cleanCourseNo, ...uniqueCodes];
                    const instCheckRes = await SelectModel.findAll(res, instCheckSql, instCheckParams);
                    const busyTeachers = instCheckRes.rows || [];

                    if (busyTeachers.length > 0) {
                        for (const bt of busyTeachers) {
                            const busyCourseNo = (bt.COURSE_NO || '').trim().toUpperCase();
                            const pairCheckSql = `
                                SELECT COUNT(*) AS CNT
                                FROM RG_SCHEDULE_PAIR_COURSE p1
                                JOIN RG_SCHEDULE_PAIR_COURSE p2 
                                  ON p1.PAIR_COURSE_GROUP_ID = p2.PAIR_COURSE_GROUP_ID
                                WHERE UPPER(TRIM(p1.COURSE_NO)) = :1 
                                  AND UPPER(TRIM(p2.COURSE_NO)) = :2
                            `;
                            const pairRes = await SelectModel.findAll(res, pairCheckSql, [cleanCourseNo, busyCourseNo]);
                            const isPaired = (pairRes.rows?.[0]?.CNT || 0) > 0;

                            if (!isPaired) {
                                const instName = bt.INSTRUCTOR_NAME_THAI || bt.INSTRUCTOR_CODE;
                                const roomInfo = bt.ROOM_CODE ? ` (ห้อง ${bt.ROOM_CODE})` : '';
                                return res.status(400).json({
                                    success: false,
                                    message: `อาจารย์ ${instName} มีตารางสอนวิชา ${busyCourseNo}${roomInfo} ในวันดังกล่าว คาบที่ ${cleanTime} อยู่แล้ว`,
                                });
                            }
                        }
                    }
                }
            }

            let targetInstrGroup = null;

            await DbTxModel.withTransaction(async (conn, tx) => {
                // Ensure Course in RG_SCHEDULE_COURSE
                const courseExists = await tx.fetchOne(`
                    SELECT 1 FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND UPPER(TRIM(COURSE_NO)) = :3
                `, [cleanYear, cleanSem, cleanCourseNo]);

                if (!courseExists) {
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_COURSE (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, NULL, (SYSDATE + 7/24), :4)
                        `, [cleanYear, cleanSem, cleanCourseNo, user]);
                    } catch (cErr) {
                        console.warn('[addScheduleClass insert course notice]', cErr?.message);
                    }
                }

                // Ensure Instructors in RG_SCHEDULE_INSTRUCTOR
                for (const code of uniqueCodes) {
                    const instrExists = await tx.fetchOne(`
                        SELECT 1 FROM RG_SCHEDULE_INSTRUCTOR 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_CODE) = :3
                    `, [cleanYear, cleanSem, code]);

                    if (!instrExists) {
                        try {
                            await tx.executeOne(`
                                INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                                ) VALUES (:1, :2, :3, (SYSDATE + 7/24), :4)
                            `, [cleanYear, cleanSem, code, user]);
                        } catch (iErr) {
                            console.warn('[addScheduleClass insert instructor notice]', iErr?.message);
                        }
                    }
                }

                if (uniqueCodes.length > 0) {
                    const sameCourseSql = `
                        SELECT DISTINCT INSTR_GROUP 
                        FROM RG_SCHEDULE_CLASS 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3 AND INSTR_GROUP IS NOT NULL AND INSTR_GROUP > 0
                    `;
                    const sameCourseRes = await tx.fetchOne(sameCourseSql, [cleanYear, cleanSem, cleanCourseNo]);

                    if (sameCourseRes && sameCourseRes.INSTR_GROUP) {
                        targetInstrGroup = Number(sameCourseRes.INSTR_GROUP);
                    } else {
                        targetInstrGroup = await getNextInstrGroup(tx);

                        try {
                            await tx.executeOne(
                                `INSERT INTO RG_SCHEDULE_INSTRUCTOR_GROUP (INSTR_GROUP) VALUES (:1)`,
                                [targetInstrGroup]
                            );
                        } catch (igErr) {
                            console.warn('[RG_SCHEDULE_INSTRUCTOR_GROUP insert notice]', igErr?.message);
                        }

                        for (let i = 0; i < uniqueCodes.length; i++) {
                            const instrCode = uniqueCodes[i];
                            const insertTeachSql = `
                                INSERT INTO RG_SCHEDULE_TEACH (
                                    STUDY_YEAR,
                                    STUDY_SEMESTER,
                                    INSTRUCTOR_GROUP,
                                    INSTRUCTOR_CODE,
                                    INSTRUCTOR_ORD,
                                    INSERT_DATE,
                                    USER_INSERT
                                ) VALUES (
                                    :1, :2, :3, :4, :5, (SYSDATE + 7/24), :6
                                )
                            `;
                            await tx.executeOne(insertTeachSql, [
                                cleanYear,
                                cleanSem,
                                targetInstrGroup.toString(),
                                instrCode,
                                (i + 1).toString(),
                                user,
                            ]);
                        }
                    }
                }

                for (const cleanTime of targetTimeCodes) {
                    const insertClassSql = `
                        INSERT INTO RG_SCHEDULE_CLASS (
                            STUDY_YEAR,
                            STUDY_SEMESTER,
                            COURSE_NO,
                            DAY_CODE,
                            TIME_CODE,
                            ROOM_CODE,
                            INSTR_GROUP,
                            INSERT_DATE,
                            USER_INSERT
                        ) VALUES (
                            :1, :2, :3, :4, :5, :6, :7, (SYSDATE + 7/24), :8
                        )
                    `;
                    await tx.executeOne(insertClassSql, [
                        cleanYear,
                        cleanSem,
                        cleanCourseNo,
                        cleanDay,
                        cleanTime,
                        cleanRoom,
                        targetInstrGroup,
                        user,
                    ]);
                }
            });

            return res.status(200).json({
                success: true,
                message: `บันทึกข้อมูลตารางสอนวิชา ${cleanCourseNo} เรียบร้อยแล้ว`,
                instrGroup: targetInstrGroup,
            });
        } catch (error) {
            console.error('[TimetableCrudController.addScheduleClass error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async updateScheduleClass(req, res) {
        try {
            const {
                studyYear,
                studySemester,
                courseNo,
                dayCode,
                timeCode,
                timeCodes,
                roomCode,
                instructorCodes,
                userInsert
            } = req.body;

            let targetTimeCodes = [];
            if (Array.isArray(timeCodes) && timeCodes.length > 0) {
                targetTimeCodes = Array.from(new Set(timeCodes.map(Number).filter(n => !isNaN(n) && n > 0))).sort((a, b) => a - b);
            } else if (timeCode !== undefined && timeCode !== null && timeCode !== '') {
                targetTimeCodes = [Number(timeCode)];
            }

            if (!studyYear || !studySemester || !courseNo || dayCode === undefined || dayCode === null || targetTimeCodes.length === 0 || !roomCode || !roomCode.toString().trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุข้อมูลจำเป็นให้ครบถ้วน (ปี, ภาค, รหัสวิชา, วัน, คาบเวลา, ห้องเรียน)',
                });
            }

            if (targetTimeCodes.length > 1) {
                for (let i = 0; i < targetTimeCodes.length - 1; i++) {
                    if (targetTimeCodes[i + 1] !== targetTimeCodes[i] + 1) {
                        return res.status(400).json({
                            success: false,
                            message: 'คาบเวลาที่เลือกมากกว่า 1 คาบจะต้องเป็นคาบที่ติดกันเท่านั้น',
                        });
                    }
                }
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanDay = Number(dayCode);
            const cleanRoom = roomCode.toString().trim();
            const user = sanitizeUsername(userInsert, 'ADMIN');

            if (cleanRoom && cleanRoom !== '-') {
                for (const cleanTime of targetTimeCodes) {
                    const roomCheckSql = `
                        SELECT 
                            TRIM(rc.COURSE_NO) AS COURSE_NO,
                            uc.COURSE_NAME_THAI
                        FROM RG_SCHEDULE_CLASS rc
                        LEFT JOIN (
                            SELECT TRIM(COURSE_NO) AS COURSE_NO, MAX(TRIM(COURSE_NAME_THAI)) AS COURSE_NAME_THAI
                            FROM UGB_COURSE GROUP BY TRIM(COURSE_NO)
                        ) uc ON TRIM(rc.COURSE_NO) = uc.COURSE_NO
                        WHERE TRIM(rc.STUDY_YEAR) = :1
                          AND TRIM(rc.STUDY_SEMESTER) = :2
                          AND rc.DAY_CODE = :3
                          AND rc.TIME_CODE = :4
                          AND UPPER(TRIM(rc.ROOM_CODE)) = UPPER(TRIM(:5))
                          AND UPPER(TRIM(rc.COURSE_NO)) != :6
                    `;
                    const roomCheckRes = await SelectModel.findAll(res, roomCheckSql, [cleanYear, cleanSem, cleanDay, cleanTime, cleanRoom, cleanCourseNo]);
                    const existingRoomClasses = roomCheckRes.rows || [];

                    if (existingRoomClasses.length > 0) {
                        for (const er of existingRoomClasses) {
                            const existingCourseNo = (er.COURSE_NO || '').trim().toUpperCase();

                            const pairCheckSql = `
                                SELECT COUNT(*) AS CNT
                                FROM RG_SCHEDULE_PAIR_COURSE p1
                                JOIN RG_SCHEDULE_PAIR_COURSE p2 
                                  ON p1.PAIR_COURSE_GROUP_ID = p2.PAIR_COURSE_GROUP_ID
                                WHERE UPPER(TRIM(p1.COURSE_NO)) = :1 
                                  AND UPPER(TRIM(p2.COURSE_NO)) = :2
                            `;
                            const pairRes = await SelectModel.findAll(res, pairCheckSql, [cleanCourseNo, existingCourseNo]);
                            const pairCount = Number(pairRes?.rows?.[0]?.CNT || 0);

                            if (pairCount === 0) {
                                return res.status(400).json({
                                    success: false,
                                    message: `ห้องเรียน ${cleanRoom} ในวันดังกล่าว คาบที่ ${cleanTime} ถูกจัดสอนโดยวิชา ${existingCourseNo} (${er.COURSE_NAME_THAI || 'ไม่มีชื่อ'}) แล้ว`,
                                });
                            }
                        }
                    }
                }
            }

            await DbTxModel.withTransaction(async (conn, tx) => {
                const curClassSql = `
                    SELECT INSTR_GROUP, ROOM_CODE, DAY_CODE, TIME_CODE
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :1 
                      AND TRIM(STUDY_SEMESTER) = :2 
                      AND TRIM(COURSE_NO) = :3
                `;
                const curClassRes = await tx.fetchAll(curClassSql, [cleanYear, cleanSem, cleanCourseNo]);
                if (!curClassRes || curClassRes.length === 0) {
                    throw new Error(`ไม่พบข้อมูลวิชา ${cleanCourseNo} ในปี ${cleanYear} ภาค ${cleanSem}`);
                }
                let targetInstrGroup = curClassRes[0].INSTR_GROUP;

                const hisClassSql = `
                    INSERT INTO RG_SCHEDULE_CLASS_HIS (
                        STUDY_YEAR,
                        STUDY_SEMESTER,
                        COURSE_NO,
                        DAY_CODE,
                        TIME_CODE,
                        ROOM_CODE,
                        INSTR_GROUP,
                        INSERT_DATE,
                        INSERT_HIS_DATE,
                        USER_INSERT,
                        USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR,
                        STUDY_SEMESTER,
                        COURSE_NO,
                        DAY_CODE,
                        TIME_CODE,
                        ROOM_CODE,
                        INSTR_GROUP,
                        INSERT_DATE,
                        (SYSDATE + 7/24),
                        USER_INSERT,
                        :1
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :2 
                      AND TRIM(STUDY_SEMESTER) = :3 
                      AND TRIM(COURSE_NO) = :4
                `;
                await tx.executeOne(hisClassSql, [user, cleanYear, cleanSem, cleanCourseNo]);

                const rawCodes = Array.isArray(instructorCodes)
                    ? instructorCodes.map(c => (c || '').toString().trim()).filter(Boolean)
                    : (typeof instructorCodes === 'string' ? instructorCodes.split(',').map(c => c.trim()).filter(Boolean) : []);
                const uniqueInstructors = Array.from(new Set(rawCodes));

                if (uniqueInstructors.length === 0) {
                    if (targetInstrGroup && targetInstrGroup > 0) {
                        const hisTeachSql = `
                            INSERT INTO RG_SCHEDULE_TEACH_HIS (
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                INSERT_HIS_DATE,
                                USER_INSERT,
                                USER_INSERT_HIS
                            )
                            SELECT 
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                (SYSDATE + 7/24),
                                USER_INSERT,
                                :1
                            FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(STUDY_YEAR) = :2 
                              AND TRIM(STUDY_SEMESTER) = :3 
                              AND TRIM(INSTRUCTOR_GROUP) = :4
                        `;
                        try {
                            await tx.executeOne(hisTeachSql, [user, cleanYear, cleanSem, targetInstrGroup.toString()]);
                        } catch (e) {
                            console.warn('[RG_SCHEDULE_TEACH_HIS backup warning in update]', e?.message);
                        }

                        await tx.executeOne(
                            `DELETE FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3`,
                            [cleanYear, cleanSem, targetInstrGroup.toString()]
                        );
                    }
                    targetInstrGroup = null;
                } else {
                    if (!targetInstrGroup || targetInstrGroup <= 0) {
                        targetInstrGroup = await getNextInstrGroup(tx);
                        await tx.executeOne(
                            `INSERT INTO RG_SCHEDULE_INSTRUCTOR_GROUP (INSTR_GROUP) VALUES (:1)`,
                            [targetInstrGroup]
                        );
                    } else {
                        const hisTeachSql = `
                            INSERT INTO RG_SCHEDULE_TEACH_HIS (
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                INSERT_HIS_DATE,
                                USER_INSERT,
                                USER_INSERT_HIS
                            )
                            SELECT 
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                (SYSDATE + 7/24),
                                USER_INSERT,
                                :1
                            FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(STUDY_YEAR) = :2 
                              AND TRIM(STUDY_SEMESTER) = :3 
                              AND TRIM(INSTRUCTOR_GROUP) = :4
                        `;
                        try {
                            await tx.executeOne(hisTeachSql, [user, cleanYear, cleanSem, targetInstrGroup.toString()]);
                        } catch (e) {
                            console.warn('[RG_SCHEDULE_TEACH_HIS backup warning in update]', e?.message);
                        }

                        await tx.executeOne(
                            `DELETE FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3`,
                            [cleanYear, cleanSem, targetInstrGroup.toString()]
                        );
                    }

                    for (let i = 0; i < uniqueInstructors.length; i++) {
                        const code = uniqueInstructors[i];

                        // Ensure Instructor in RG_SCHEDULE_INSTRUCTOR
                        const instrExists = await tx.fetchOne(`
                            SELECT 1 FROM RG_SCHEDULE_INSTRUCTOR 
                            WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_CODE) = :3
                        `, [cleanYear, cleanSem, code]);

                        if (!instrExists) {
                            try {
                                await tx.executeOne(`
                                    INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                                        STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                                    ) VALUES (:1, :2, :3, (SYSDATE + 7/24), :4)
                                `, [cleanYear, cleanSem, code, user]);
                            } catch (iErr) {
                                console.warn('[updateScheduleClass insert instructor notice]', iErr?.message);
                            }
                        }
                        const insertTeachSql = `
                            INSERT INTO RG_SCHEDULE_TEACH (
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                USER_INSERT
                            ) VALUES (:1, :2, :3, :4, :5, (SYSDATE + 7/24), :6)
                        `;
                        await tx.executeOne(insertTeachSql, [
                            cleanYear,
                            cleanSem,
                            targetInstrGroup.toString(),
                            code,
                            i + 1,
                            user
                        ]);
                    }
                }

                await tx.executeOne(
                    `DELETE FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3`,
                    [cleanYear, cleanSem, cleanCourseNo]
                );

                for (const cleanTime of targetTimeCodes) {
                    const insertClassSql = `
                        INSERT INTO RG_SCHEDULE_CLASS (
                            STUDY_YEAR,
                            STUDY_SEMESTER,
                            COURSE_NO,
                            DAY_CODE,
                            TIME_CODE,
                            ROOM_CODE,
                            INSTR_GROUP,
                            INSERT_DATE,
                            USER_INSERT
                        ) VALUES (
                            :1, :2, :3, :4, :5, :6, :7, (SYSDATE + 7/24), :8
                        )
                    `;
                    await tx.executeOne(insertClassSql, [
                        cleanYear,
                        cleanSem,
                        cleanCourseNo,
                        cleanDay,
                        cleanTime,
                        cleanRoom,
                        targetInstrGroup,
                        user,
                    ]);
                }

                await cleanupOrphanInstructorGroups(tx);
            });

            return res.status(200).json({
                success: true,
                message: `แก้ไขข้อมูลตารางสอนวิชา ${cleanCourseNo} เรียบร้อยแล้ว`,
            });
        } catch (error) {
            console.error('[TimetableCrudController.updateScheduleClass error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async deleteScheduleClass(req, res) {
        try {
            const { studyYear, studySemester, courseNo, instrGroup, dayCode, timeCode, timeCodes, roomCode, userInsert } = req.body;

            if (!studyYear || !studySemester || !courseNo) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุข้อมูลที่ต้องการลบให้ครบถ้วน (ปี, ภาค, รหัสวิชา)',
                });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanGroup = instrGroup !== undefined && instrGroup !== null && instrGroup !== '' ? Number(instrGroup) : null;
            const cleanDay = (dayCode !== undefined && dayCode !== null && dayCode !== '') ? Number(dayCode) : null;
            const cleanTime = (timeCode !== undefined && timeCode !== null && timeCode !== '') ? Number(timeCode) : null;
            const cleanRoom = (roomCode !== undefined && roomCode !== null && roomCode !== '') ? roomCode.toString().trim() : null;
            const user = sanitizeUsername(userInsert, 'ADMIN');

            let targetTimeList = [];
            if (Array.isArray(timeCodes) && timeCodes.length > 0) {
                targetTimeList = timeCodes.map(Number).filter(n => !isNaN(n));
            } else if (cleanTime !== null && !isNaN(cleanTime)) {
                targetTimeList = [cleanTime];
            }

            await DbTxModel.withTransaction(async (conn, tx) => {
                let whereClause = `
                    WHERE TRIM(STUDY_YEAR) = :1 
                      AND TRIM(STUDY_SEMESTER) = :2 
                      AND TRIM(COURSE_NO) = :3
                `;
                const filterParams = [cleanYear, cleanSem, cleanCourseNo];
                let pIdx = 4;
                if (cleanDay !== null && !isNaN(cleanDay)) {
                    whereClause += ` AND DAY_CODE = :${pIdx++}`;
                    filterParams.push(cleanDay);
                }
                if (targetTimeList.length > 0) {
                    if (targetTimeList.length === 1) {
                        whereClause += ` AND TIME_CODE = :${pIdx++}`;
                        filterParams.push(targetTimeList[0]);
                    } else {
                        const placeholders = targetTimeList.map((_, i) => `:${pIdx + i}`).join(', ');
                        whereClause += ` AND TIME_CODE IN (${placeholders})`;
                        filterParams.push(...targetTimeList);
                        pIdx += targetTimeList.length;
                    }
                }
                if (cleanRoom && cleanRoom !== '-') {
                    whereClause += ` AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:${pIdx++}))`;
                    filterParams.push(cleanRoom);
                } else if (cleanRoom === '-') {
                    whereClause += ` AND (ROOM_CODE IS NULL OR TRIM(ROOM_CODE) = '-' OR TRIM(ROOM_CODE) = '')`;
                }
                if (cleanGroup !== null && !isNaN(cleanGroup)) {
                    whereClause += ` AND INSTR_GROUP = :${pIdx++}`;
                    filterParams.push(cleanGroup);
                }

                const findGroupSql = `
                    SELECT DISTINCT INSTR_GROUP
                    FROM RG_SCHEDULE_CLASS
                    ${whereClause}
                `;
                const groupRows = await tx.fetchAll(findGroupSql, filterParams);
                let affectedGroups = (groupRows || [])
                    .map(r => Number(r.INSTR_GROUP))
                    .filter(g => g !== null && !isNaN(g) && g > 0);

                if (cleanGroup !== null && !isNaN(cleanGroup) && cleanGroup > 0 && !affectedGroups.includes(cleanGroup)) {
                    affectedGroups.push(cleanGroup);
                }

                const hisWhereClause = whereClause.replace(/:(\d+)/g, (_, num) => `:${Number(num) + 1}`);
                const hisClassSql = `
                    INSERT INTO RG_SCHEDULE_CLASS_HIS (
                        STUDY_YEAR,
                        STUDY_SEMESTER,
                        COURSE_NO,
                        DAY_CODE,
                        TIME_CODE,
                        ROOM_CODE,
                        INSTR_GROUP,
                        INSERT_DATE,
                        INSERT_HIS_DATE,
                        USER_INSERT,
                        USER_INSERT_HIS
                    )
                    SELECT 
                        STUDY_YEAR,
                        STUDY_SEMESTER,
                        COURSE_NO,
                        DAY_CODE,
                        TIME_CODE,
                        ROOM_CODE,
                        INSTR_GROUP,
                        INSERT_DATE,
                        (SYSDATE + 7/24),
                        USER_INSERT,
                        :1
                    FROM RG_SCHEDULE_CLASS
                    ${hisWhereClause}
                `;
                await tx.executeOne(hisClassSql, [user, ...filterParams]);

                const delClassSql = `
                    DELETE FROM RG_SCHEDULE_CLASS
                    ${whereClause}
                `;
                await tx.executeOne(delClassSql, filterParams);

                for (const grp of affectedGroups) {
                    const checkRemainingSql = `
                        SELECT COUNT(*) AS CNT
                        FROM RG_SCHEDULE_CLASS
                        WHERE INSTR_GROUP = :1
                    `;
                    const remainingRes = await tx.fetchOne(checkRemainingSql, [grp]);
                    const remainingCount = Number(remainingRes?.CNT || 0);

                    if (remainingCount === 0) {
                        const hisTeachSql = `
                            INSERT INTO RG_SCHEDULE_TEACH_HIS (
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                INSERT_HIS_DATE,
                                USER_INSERT,
                                USER_INSERT_HIS
                            )
                            SELECT 
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                (SYSDATE + 7/24),
                                USER_INSERT,
                                :1
                            FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(INSTRUCTOR_GROUP) = :2
                        `;
                        try {
                            await tx.executeOne(hisTeachSql, [user, grp.toString()]);
                        } catch (e) {
                            console.warn('[RG_SCHEDULE_TEACH_HIS backup warning]', e?.message);
                        }

                        const delTeachSql = `
                            DELETE FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(INSTRUCTOR_GROUP) = :1
                        `;
                        await tx.executeOne(delTeachSql, [grp.toString()]);

                        try {
                            await tx.executeOne(`DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP WHERE INSTR_GROUP = :1`, [grp]);
                        } catch (e) {
                            console.warn('[RG_SCHEDULE_INSTRUCTOR_GROUP delete notice]', e?.message);
                        }
                    }
                }

                await cleanupOrphanInstructorGroups(tx);
            });

            return res.status(200).json({
                success: true,
                message: `ลบข้อมูลตารางสอนวิชา ${cleanCourseNo} และข้อมูลอาจารย์ผู้สอนเรียบร้อยแล้ว`,
            });
        } catch (error) {
            console.error('[TimetableCrudController.deleteScheduleClass error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async deleteBulkScheduleClasses(req, res) {
        try {
            const { studyYear, studySemester, items, userInsert } = req.body;

            if (!studyYear || !studySemester || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุรายการที่ต้องการลบ',
                });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const user = sanitizeUsername(userInsert, 'ADMIN');
            let deletedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const item of items) {
                    const cleanCourseNo = (item.courseNo || '').toString().trim().toUpperCase();
                    const cleanGroup = item.instrGroup !== undefined && item.instrGroup !== null ? Number(item.instrGroup) : null;
                    const cleanDay = (item.dayCode !== undefined && item.dayCode !== null && item.dayCode !== '') ? Number(item.dayCode) : null;
                    const cleanTime = (item.timeCode !== undefined && item.timeCode !== null && item.timeCode !== '') ? Number(item.timeCode) : null;
                    const cleanRoom = (item.roomCode !== undefined && item.roomCode !== null && item.roomCode !== '') ? item.roomCode.toString().trim() : null;

                    if (!cleanCourseNo) continue;

                    let whereClause = `
                        WHERE TRIM(STUDY_YEAR) = :1 
                          AND TRIM(STUDY_SEMESTER) = :2 
                          AND TRIM(COURSE_NO) = :3
                    `;
                    const filterParams = [cleanYear, cleanSem, cleanCourseNo];
                    let pIdx = 4;
                    if (cleanDay !== null && !isNaN(cleanDay)) {
                        whereClause += ` AND DAY_CODE = :${pIdx++}`;
                        filterParams.push(cleanDay);
                    }
                    if (cleanTime !== null && !isNaN(cleanTime)) {
                        whereClause += ` AND TIME_CODE = :${pIdx++}`;
                        filterParams.push(cleanTime);
                    }
                    if (cleanRoom && cleanRoom !== '-') {
                        whereClause += ` AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:${pIdx++}))`;
                        filterParams.push(cleanRoom);
                    } else if (cleanRoom === '-') {
                        whereClause += ` AND (ROOM_CODE IS NULL OR TRIM(ROOM_CODE) = '-' OR TRIM(ROOM_CODE) = '')`;
                    }
                    if (cleanGroup !== null && !isNaN(cleanGroup)) {
                        whereClause += ` AND INSTR_GROUP = :${pIdx++}`;
                        filterParams.push(cleanGroup);
                    }

                    const hisWhereClause = whereClause.replace(/:(\d+)/g, (_, num) => `:${Number(num) + 1}`);
                    const hisClassSql = `
                        INSERT INTO RG_SCHEDULE_CLASS_HIS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                            INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                        )
                        SELECT 
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                            INSERT_DATE, (SYSDATE + 7/24), USER_INSERT, :1
                        FROM RG_SCHEDULE_CLASS
                        ${hisWhereClause}
                    `;
                    await tx.executeOne(hisClassSql, [user, ...filterParams]);

                    const delClassSql = `
                        DELETE FROM RG_SCHEDULE_CLASS
                        ${whereClause}
                    `;
                    await tx.executeOne(delClassSql, filterParams);

                    if (cleanGroup !== null && !isNaN(cleanGroup) && cleanGroup > 0) {
                        const checkRemainingSql = `
                            SELECT COUNT(*) AS CNT
                            FROM RG_SCHEDULE_CLASS
                            WHERE INSTR_GROUP = :1
                        `;
                        const remainingRes = await tx.fetchOne(checkRemainingSql, [cleanGroup]);
                        if (Number(remainingRes?.CNT || 0) === 0) {
                            const hisTeachSql = `
                                INSERT INTO RG_SCHEDULE_TEACH_HIS (
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                                    INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                                )
                                SELECT 
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                                    INSERT_DATE, (SYSDATE + 7/24), USER_INSERT, :1
                                FROM RG_SCHEDULE_TEACH
                                WHERE TRIM(INSTRUCTOR_GROUP) = :2
                            `;
                            try {
                                await tx.executeOne(hisTeachSql, [user, cleanGroup.toString()]);
                            } catch (e) {
                                console.warn('[RG_SCHEDULE_TEACH_HIS bulk warning]', e?.message);
                            }

                            const delTeachSql = `
                                DELETE FROM RG_SCHEDULE_TEACH
                                WHERE TRIM(INSTRUCTOR_GROUP) = :1
                            `;
                            await tx.executeOne(delTeachSql, [cleanGroup.toString()]);

                            try {
                                await tx.executeOne(`DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP WHERE INSTR_GROUP = :1`, [cleanGroup]);
                            } catch (e) {
                            }
                        }
                    }

                    deletedCount++;
                }

                await cleanupOrphanInstructorGroups(tx);
            });

            return res.status(200).json({
                success: true,
                message: `ลบข้อมูลตารางสอนจำนวน ${deletedCount} รายการ และสำรองประวัติเรียบร้อยแล้ว`,
                deletedCount,
            });
        } catch (error) {
            console.error('[TimetableCrudController.deleteBulkScheduleClasses error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async updateScheduleSlots(req, res) {
        try {
            const { studyYear, studySemester, moves, userInsert } = req.body;

            if (!studyYear || !studySemester || !Array.isArray(moves) || moves.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'กรุณาระบุข้อมูลการย้ายคาบเรียนให้ครบถ้วน',
                });
            }

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const user = sanitizeUsername(userInsert, 'ADMIN');
            let updatedCount = 0;

            await DbTxModel.withTransaction(async (conn, tx) => {
                for (const m of moves) {
                    const courseNo = (m.courseNo || '').toString().trim().toUpperCase();
                    const oldDay = Number(m.oldDayCode);
                    const oldTime = Number(m.oldTimeCode);
                    const newDay = Number(m.newDayCode);
                    const newTime = Number(m.newTimeCode);
                    const instrGroup = m.instrGroup ? Number(m.instrGroup) : null;

                    if (!courseNo || isNaN(oldDay) || isNaN(oldTime) || isNaN(newDay) || isNaN(newTime)) {
                        continue;
                    }

                    if (oldDay === newDay && oldTime === newTime) {
                        continue;
                    }

                    const curClassSql = `
                        SELECT TRIM(ROOM_CODE) AS ROOM_CODE, INSTR_GROUP
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :1 
                          AND TRIM(STUDY_SEMESTER) = :2 
                          AND TRIM(COURSE_NO) = :3 
                          AND DAY_CODE = :4
                          AND TIME_CODE = :5
                    `;
                    const curRow = await tx.fetchOne(curClassSql, [cleanYear, cleanSem, courseNo, oldDay, oldTime]);
                    const curRoom = curRow?.ROOM_CODE ? curRow.ROOM_CODE.trim() : '';
                    const actualInstrGroup = instrGroup !== null && !isNaN(instrGroup)
                        ? instrGroup
                        : (curRow?.INSTR_GROUP ? Number(curRow.INSTR_GROUP) : null);

                    const newRoom = (m.newRoomCode !== undefined && m.newRoomCode !== null) ? m.newRoomCode.toString().trim() : null;
                    const targetRoom = newRoom !== null ? newRoom : curRoom;

                    if (oldDay === newDay && oldTime === newTime && curRoom === targetRoom) {
                        continue;
                    }

                    if (targetRoom && targetRoom !== '-') {
                        const checkTargetSql = `
                            SELECT TRIM(COURSE_NO) AS COURSE_NO
                            FROM RG_SCHEDULE_CLASS
                            WHERE TRIM(STUDY_YEAR) = :1
                              AND TRIM(STUDY_SEMESTER) = :2
                              AND DAY_CODE = :3
                              AND TIME_CODE = :4
                              AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:5))
                              AND UPPER(TRIM(COURSE_NO)) != :6
                        `;
                        const targetConflicts = await tx.fetchAll(checkTargetSql, [cleanYear, cleanSem, newDay, newTime, targetRoom, courseNo]);

                        for (const tc of targetConflicts) {
                            const targetCourseNo = (tc.COURSE_NO || '').trim().toUpperCase();

                            const isTargetBeingMovedAway = moves.some((otherMove) => {
                                const oCourseNo = (otherMove.courseNo || '').toString().trim().toUpperCase();
                                const oOldDay = Number(otherMove.oldDayCode);
                                const oOldTime = Number(otherMove.oldTimeCode);
                                const oOldRoom = (otherMove.oldRoomCode !== undefined && otherMove.oldRoomCode !== null)
                                    ? otherMove.oldRoomCode.toString().trim().toUpperCase()
                                    : null;
                                return oCourseNo === targetCourseNo &&
                                    oOldDay === newDay &&
                                    oOldTime === newTime &&
                                    (!oOldRoom || oOldRoom === targetRoom.toUpperCase());
                            });

                            if (isTargetBeingMovedAway) {
                                continue;
                            }

                            const pairSql = `
                                SELECT COUNT(*) AS CNT
                                FROM RG_SCHEDULE_PAIR_COURSE p1
                                JOIN RG_SCHEDULE_PAIR_COURSE p2 ON p1.PAIR_COURSE_GROUP_ID = p2.PAIR_COURSE_GROUP_ID
                                WHERE UPPER(TRIM(p1.COURSE_NO)) = :1 AND UPPER(TRIM(p2.COURSE_NO)) = :2
                            `;
                            const pairRes = await tx.fetchOne(pairSql, [courseNo, targetCourseNo]);
                            const isPaired = Number(pairRes?.CNT || 0) > 0;

                            if (!isPaired) {
                                throw new Error(`ไม่สามารถย้ายวิชา ${courseNo} ได้ เนื่องจากห้อง ${targetRoom} ในวันและเวลาเป้าหมายมีวิชา ${targetCourseNo} ใช้งานอยู่แล้ว`);
                            }
                        }
                    }

                    let instructorsOfClass = [];
                    if (actualInstrGroup !== null && !isNaN(actualInstrGroup)) {
                        const instSql = `
                            SELECT 
                                TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                                TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI
                            FROM RG_SCHEDULE_TEACH rt
                            LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                            WHERE TRIM(rt.STUDY_YEAR) = :1
                              AND TRIM(rt.STUDY_SEMESTER) = :2
                              AND TRIM(TO_CHAR(rt.INSTRUCTOR_GROUP)) = :3
                        `;
                        instructorsOfClass = await tx.fetchAll(instSql, [cleanYear, cleanSem, actualInstrGroup.toString()]);
                    }

                    const uniqueTeacherCodes = Array.from(
                        new Set(instructorsOfClass.map((i) => (i.INSTRUCTOR_CODE || '').trim()).filter(Boolean))
                    );

                    if (uniqueTeacherCodes.length > 0) {
                        const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
                        const timeFlag = isSummer ? '2' : '1';
                        let targetSlotTime = null;
                        try {
                            const timeSql = `
                                SELECT TRIM(TIME_CODE) AS TIME_CODE, TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                                FROM RG_SCHEDULE_TIME
                                WHERE TRIM(TIME_FLAG) = :1 AND TRIM(TIME_CODE) = :2
                            `;
                            const timeRes = await tx.fetchAll(timeSql, [timeFlag, newTime.toString()]);
                            if (timeRes && timeRes.length > 0) {
                                targetSlotTime = {
                                    timeCode: Number(timeRes[0].TIME_CODE),
                                    timeStart: timeRes[0].TIME_START,
                                    timeEnd: timeRes[0].TIME_END
                                };
                            }
                        } catch (tErr) {
                            console.error('[moveClassSlot timeSql error]', tErr);
                        }

                        if (!targetSlotTime) {
                            const defaultTimes = timeFlag === '2'
                                ? { 1: ['0835', '0950'], 2: ['0955', '1110'], 3: ['1115', '1230'], 4: ['1235', '1350'], 5: ['1355', '1510'] }
                                : { 1: ['0800', '0915'], 2: ['0925', '1040'], 3: ['1050', '1205'], 4: ['1215', '1330'], 5: ['1340', '1455'], 6: ['1505', '1620'] };
                            targetSlotTime = {
                                timeCode: newTime,
                                timeStart: defaultTimes[newTime] ? defaultTimes[newTime][0] : '0800',
                                timeEnd: defaultTimes[newTime] ? defaultTimes[newTime][1] : '0915'
                            };
                        }

                        try {
                            const inInstP = uniqueTeacherCodes.map((_, i) => `:${i + 4}`).join(', ');
                            const ru30Sql = `
                                SELECT 
                                    TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                                    TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                                    TRIM(ur.RANK_NAME_THAI_S) AS RANK_NAME_THAI_S,
                                    ru.DAY_CODE,
                                    TRIM(ts.TIME_START) AS RU30_START,
                                    TRIM(ts.TIME_END) AS RU30_END,
                                    TRIM(ru.COURSE_NO) AS RU30_COURSE_NO
                                FROM UGB_RU30 ru
                                LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                                LEFT JOIN UGB_RANK ur ON ui.RANK_NO = ur.RANK_NO
                                WHERE TRIM(ru.STUDY_YEAR) = :1 
                                  AND TRIM(ru.STUDY_SEMESTER) = :2
                                  AND ru.DAY_CODE = :3
                                  AND TRIM(ru.INSTRUCTOR_CODE) IN (${inInstP})
                            `;
                            let ru30Rows = await tx.fetchAll(ru30Sql, [cleanYear, cleanSem, newDay, ...uniqueTeacherCodes]);

                            for (const r of (ru30Rows || [])) {
                                if (isTimeOverlapping(targetSlotTime.timeStart, targetSlotTime.timeEnd, r.RU30_START, r.RU30_END)) {
                                    const instName = `${r.RANK_NAME_THAI_S || ''} ${r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE}`.trim();
                                    const ruPeriod = (r.RU30_START && r.RU30_END)
                                        ? `${formatMilitaryTime(r.RU30_START)} - ${formatMilitaryTime(r.RU30_END)}`
                                        : '';
                                    const slotPeriod = `${formatMilitaryTime(targetSlotTime.timeStart)} - ${formatMilitaryTime(targetSlotTime.timeEnd)}`;
                                    throw new Error(`ไม่สามารถย้ายวิชา ${courseNo} ได้ เนื่องจากอาจารย์ ${instName} (${r.INSTRUCTOR_CODE}) ติดสอนในระบบส่วนกลาง (มร.30) วิชา ${r.RU30_COURSE_NO} เวลา ${ruPeriod} ซึ่งชนกับคาบที่ ${newTime} (${slotPeriod})`);
                                }
                            }
                        } catch (ruErr) {
                            if (ruErr.message && ruErr.message.includes('ติดสอนในระบบส่วนกลาง')) {
                                throw ruErr;
                            }
                            console.error('[moveClassSlot ru30 error]', ruErr);
                        }
                    }

                    if (uniqueTeacherCodes.length > 0) {
                        const instPlaceholders = uniqueTeacherCodes.map((_, idx) => `:${idx + 6}`).join(',');
                        const instCheckSql = `
                            SELECT 
                                TRIM(rt.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                                TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                                TRIM(rc.COURSE_NO) AS COURSE_NO,
                                TRIM(rc.ROOM_CODE) AS ROOM_CODE
                            FROM RG_SCHEDULE_CLASS rc
                            JOIN RG_SCHEDULE_TEACH rt 
                              ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                             AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                             AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(TO_CHAR(rt.INSTRUCTOR_GROUP))
                            LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                            WHERE TRIM(rc.STUDY_YEAR) = :1
                              AND TRIM(rc.STUDY_SEMESTER) = :2
                              AND rc.DAY_CODE = :3
                              AND rc.TIME_CODE = :4
                              AND UPPER(TRIM(rc.COURSE_NO)) != :5
                              AND TRIM(rt.INSTRUCTOR_CODE) IN (${instPlaceholders})
                        `;
                        const instCheckParams = [cleanYear, cleanSem, newDay, newTime, courseNo, ...uniqueTeacherCodes];
                        const busyTeachers = await tx.fetchAll(instCheckSql, instCheckParams);

                        if (busyTeachers.length > 0) {
                            for (const bt of busyTeachers) {
                                const busyCourseNo = (bt.COURSE_NO || '').trim().toUpperCase();

                                const isBusyBeingMovedAway = moves.some((otherMove) => {
                                    const oCourseNo = (otherMove.courseNo || '').toString().trim().toUpperCase();
                                    const oOldDay = Number(otherMove.oldDayCode);
                                    const oOldTime = Number(otherMove.oldTimeCode);
                                    return oCourseNo === busyCourseNo && oOldDay === newDay && oOldTime === newTime;
                                });

                                if (isBusyBeingMovedAway) {
                                    continue;
                                }

                                const pairSql = `
                                    SELECT COUNT(*) AS CNT
                                    FROM RG_SCHEDULE_PAIR_COURSE p1
                                    JOIN RG_SCHEDULE_PAIR_COURSE p2 ON p1.PAIR_COURSE_GROUP_ID = p2.PAIR_COURSE_GROUP_ID
                                    WHERE UPPER(TRIM(p1.COURSE_NO)) = :1 AND UPPER(TRIM(p2.COURSE_NO)) = :2
                                `;
                                const pairRes = await tx.fetchOne(pairSql, [courseNo, busyCourseNo]);
                                const isPaired = Number(pairRes?.CNT || 0) > 0;

                                if (!isPaired) {
                                    const instName = bt.INSTRUCTOR_NAME_THAI || bt.INSTRUCTOR_CODE;
                                    const busyRoom = bt.ROOM_CODE ? `ห้อง ${bt.ROOM_CODE}` : '';
                                    throw new Error(`ไม่สามารถย้ายวิชา ${courseNo} ได้ เนื่องจากอาจารย์ ${instName} (${bt.INSTRUCTOR_CODE}) มีการจัดสอนวิชา ${busyCourseNo} (${busyRoom}) ในวันและเวลานี้แล้ว`);
                                }
                            }
                        }
                    }

                    const hisClassSql = `
                        INSERT INTO RG_SCHEDULE_CLASS_HIS (
                            STUDY_YEAR,
                            STUDY_SEMESTER,
                            COURSE_NO,
                            DAY_CODE,
                            TIME_CODE,
                            ROOM_CODE,
                            INSTR_GROUP,
                            INSERT_DATE,
                            INSERT_HIS_DATE,
                            USER_INSERT,
                            USER_INSERT_HIS
                        )
                        SELECT 
                            STUDY_YEAR,
                            STUDY_SEMESTER,
                            COURSE_NO,
                            DAY_CODE,
                            TIME_CODE,
                            ROOM_CODE,
                            INSTR_GROUP,
                            INSERT_DATE,
                            (SYSDATE + 7/24),
                            USER_INSERT,
                            :1
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :2 
                          AND TRIM(STUDY_SEMESTER) = :3 
                          AND TRIM(COURSE_NO) = :4 
                          AND DAY_CODE = :5
                          AND TIME_CODE = :6
                    `;
                    await tx.executeOne(hisClassSql, [user, cleanYear, cleanSem, courseNo, oldDay, oldTime]);

                    let updateSql = `
                        UPDATE RG_SCHEDULE_CLASS
                        SET DAY_CODE = :1,
                            TIME_CODE = :2,
                            ROOM_CODE = :3,
                            USER_INSERT = :4,
                            INSERT_DATE = (SYSDATE + 7/24)
                        WHERE TRIM(STUDY_YEAR) = :5
                          AND TRIM(STUDY_SEMESTER) = :6
                          AND TRIM(COURSE_NO) = :7
                          AND DAY_CODE = :8
                          AND TIME_CODE = :9
                    `;
                    const updateParams = [newDay, -newTime, targetRoom, user, cleanYear, cleanSem, courseNo, oldDay, oldTime];

                    if (instrGroup !== null && !isNaN(instrGroup)) {
                        updateSql += ` AND INSTR_GROUP = :10`;
                        updateParams.push(instrGroup);
                    }

                    await tx.executeOne(updateSql, updateParams);
                    updatedCount++;
                }

                if (updatedCount > 0) {
                    await tx.executeOne(`
                        UPDATE RG_SCHEDULE_CLASS
                        SET TIME_CODE = ABS(TIME_CODE)
                        WHERE TRIM(STUDY_YEAR) = :1
                          AND TRIM(STUDY_SEMESTER) = :2
                          AND TIME_CODE < 0
                    `, [cleanYear, cleanSem]);
                }
            });

            return res.status(200).json({
                success: true,
                message: `บันทึกการปรับเปลี่ยนวันและเวลาเรียน (${updatedCount} รายการ) สำเร็จ`,
                updatedCount,
            });
        } catch (error) {
            console.error('[TimetableCrudController.updateScheduleSlots error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    async copySingleClass(req, res) {
        try {
            const {
                targetYear,
                targetSemester,
                targetRoom,
                courseNo,
                dayCode,
                timeCode,
                instructors,
                user
            } = req.body;

            if (!targetYear || !targetSemester || !targetRoom || !courseNo || !dayCode || !timeCode) {
                return res.status(400).json({
                    success: false,
                    message: 'ข้อมูลไม่ครบถ้วน (targetYear, targetSemester, targetRoom, courseNo, dayCode, timeCode)'
                });
            }

            const cleanYear = targetYear.toString().trim();
            const cleanSem = targetSemester.toString().trim();
            const cleanRoom = targetRoom.toString().trim().toUpperCase();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanDay = Number(dayCode);
            const cleanTime = Number(timeCode);
            const username = sanitizeUsername(user, 'SYSTEM');

            const instrList = Array.isArray(instructors) ? instructors : [];
            const uniqueCodes = Array.from(new Set(instrList.map(i => (i.instructorCode || i.INSTRUCTOR_CODE || '').toString().trim()).filter(Boolean)));

            await DbTxModel.withTransaction(async (conn, tx) => {
                // 1. Check if room is already occupied in target
                const roomCheckSql = `
                    SELECT TRIM(COURSE_NO) AS COURSE_NO 
                    FROM RG_SCHEDULE_CLASS 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 
                      AND DAY_CODE = :3 AND TIME_CODE = :4 
                      AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:5))
                `;
                const roomCheckRes = await tx.fetchOne(roomCheckSql, [cleanYear, cleanSem, cleanDay, cleanTime, cleanRoom]);
                if (roomCheckRes && roomCheckRes.COURSE_NO) {
                    if (roomCheckRes.COURSE_NO.trim().toUpperCase() === cleanCourseNo) {
                        throw new Error(`วิชา ${cleanCourseNo} ถูกจัดสอนในห้อง ${cleanRoom} คาบนี้อยู่แล้ว`);
                    }
                    throw new Error(`ห้อง ${cleanRoom} มีการจัดสอนวิชา ${roomCheckRes.COURSE_NO} อยู่แล้วในคาบนี้`);
                }

                // 2. Check if instructors have MR.30 conflict in targetYear/Sem
                if (uniqueCodes.length > 0) {
                    const inPlaceholders = uniqueCodes.map((_, i) => `:${i + 4}`).join(', ');
                    const ru30CheckSql = `
                        SELECT 
                            TRIM(ru.INSTRUCTOR_CODE) AS INSTRUCTOR_CODE,
                            TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI,
                            TRIM(ru.COURSE_NO) AS RU30_COURSE_NO,
                            TRIM(ts.TIME_START) AS RU30_START,
                            TRIM(ts.TIME_END) AS RU30_END
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_TIME_SCHEDULE ts ON ru.TIME_CODE = ts.TIME_CODE
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        WHERE TRIM(ru.STUDY_YEAR) = :1 
                          AND TRIM(ru.STUDY_SEMESTER) = :2
                          AND ru.DAY_CODE = :3
                          AND TRIM(ru.INSTRUCTOR_CODE) IN (${inPlaceholders})
                    `;
                    const ru30Rows = await tx.fetchAll(ru30CheckSql, [cleanYear, cleanSem, cleanDay, ...uniqueCodes]);

                    const isSummer = cleanSem === '3' || cleanSem.toUpperCase() === 'S';
                    const timeFlag = isSummer ? '2' : '1';
                    const slotTimeSql = `
                        SELECT TRIM(TIME_START) AS TIME_START, TRIM(TIME_END) AS TIME_END
                        FROM RG_SCHEDULE_TIME 
                        WHERE TRIM(TIME_FLAG) = :1 AND TRIM(TIME_CODE) = :2
                    `;
                    const slotTimeRow = await tx.fetchOne(slotTimeSql, [timeFlag, cleanTime.toString()]);
                    const slotStart = slotTimeRow?.TIME_START;
                    const slotEnd = slotTimeRow?.TIME_END;

                    for (const r of (ru30Rows || [])) {
                        if (isTimeOverlapping(slotStart, slotEnd, r.RU30_START, r.RU30_END)) {
                            const instName = r.INSTRUCTOR_NAME_THAI || r.INSTRUCTOR_CODE;
                            throw new Error(`อาจารย์ ${instName} ติดสอน มร.30 (${r.RU30_COURSE_NO} เวลา ${formatMilitaryTime(r.RU30_START)}-${formatMilitaryTime(r.RU30_END)}) ในปี ${cleanYear}/${cleanSem}`);
                        }
                    }

                    // Check timetable class conflicts for instructor in target
                    const instBusySql = `
                        SELECT 
                            TRIM(rc.COURSE_NO) AS COURSE_NO,
                            TRIM(rc.ROOM_CODE) AS ROOM_CODE,
                            TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI
                        FROM RG_SCHEDULE_CLASS rc
                        JOIN RG_SCHEDULE_TEACH rt 
                            ON TRIM(rc.STUDY_YEAR) = TRIM(rt.STUDY_YEAR) 
                           AND TRIM(rc.STUDY_SEMESTER) = TRIM(rt.STUDY_SEMESTER) 
                           AND TRIM(TO_CHAR(rc.INSTR_GROUP)) = TRIM(rt.INSTRUCTOR_GROUP)
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(rt.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        WHERE TRIM(rc.STUDY_YEAR) = :1 
                          AND TRIM(rc.STUDY_SEMESTER) = :2 
                          AND rc.DAY_CODE = :3 
                          AND rc.TIME_CODE = :4 
                          AND TRIM(rt.INSTRUCTOR_CODE) IN (${inPlaceholders})
                    `;
                    const instBusyRows = await tx.fetchAll(instBusySql, [cleanYear, cleanSem, cleanDay, cleanTime, ...uniqueCodes]);
                    if (instBusyRows && instBusyRows.length > 0) {
                        const b = instBusyRows[0];
                        throw new Error(`อาจารย์ ${b.INSTRUCTOR_NAME_THAI} มีตารางสอนวิชา ${b.COURSE_NO} (ห้อง ${b.ROOM_CODE}) ในคาบนี้แล้ว`);
                    }
                }

                // 3. Ensure Course in RG_SCHEDULE_COURSE
                const courseExists = await tx.fetchOne(`
                    SELECT 1 FROM RG_SCHEDULE_COURSE 
                    WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND UPPER(TRIM(COURSE_NO)) = :3
                `, [cleanYear, cleanSem, cleanCourseNo]);

                if (!courseExists) {
                    try {
                        await tx.executeOne(`
                            INSERT INTO RG_SCHEDULE_COURSE (
                                STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, COURSE_REMARK, INSERT_DATE, USER_INSERT
                            ) VALUES (:1, :2, :3, NULL, (SYSDATE + 7/24), :4)
                        `, [cleanYear, cleanSem, cleanCourseNo, username]);
                    } catch (cErr) {
                        console.warn('[copySingleClass insert course notice]', cErr?.message);
                    }
                }

                // 4. Ensure Instructors in RG_SCHEDULE_INSTRUCTOR
                for (const code of uniqueCodes) {
                    const instrExists = await tx.fetchOne(`
                        SELECT 1 FROM RG_SCHEDULE_INSTRUCTOR 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_CODE) = :3
                    `, [cleanYear, cleanSem, code]);

                    if (!instrExists) {
                        try {
                            await tx.executeOne(`
                                INSERT INTO RG_SCHEDULE_INSTRUCTOR (
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_CODE, INSERT_DATE, USER_INSERT
                                ) VALUES (:1, :2, :3, (SYSDATE + 7/24), :4)
                            `, [cleanYear, cleanSem, code, username]);
                        } catch (iErr) {
                            console.warn('[copySingleClass insert instructor notice]', iErr?.message);
                        }
                    }
                }

                // 5. Determine INSTR_GROUP & Insert TEACH
                let targetInstrGroup = null;
                if (uniqueCodes.length > 0) {
                    const sameCourseRes = await tx.fetchOne(`
                        SELECT DISTINCT INSTR_GROUP 
                        FROM RG_SCHEDULE_CLASS 
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(COURSE_NO) = :3 AND INSTR_GROUP IS NOT NULL AND INSTR_GROUP > 0
                    `, [cleanYear, cleanSem, cleanCourseNo]);

                    if (sameCourseRes && sameCourseRes.INSTR_GROUP) {
                        targetInstrGroup = Number(sameCourseRes.INSTR_GROUP);
                    } else {
                        targetInstrGroup = await getNextInstrGroup(tx);
                        try {
                            await tx.executeOne(`INSERT INTO RG_SCHEDULE_INSTRUCTOR_GROUP (INSTR_GROUP) VALUES (:1)`, [targetInstrGroup]);
                        } catch (igErr) {
                            console.warn('[RG_SCHEDULE_INSTRUCTOR_GROUP insert notice]', igErr?.message);
                        }
                        for (let i = 0; i < uniqueCodes.length; i++) {
                            const code = uniqueCodes[i];
                            await tx.executeOne(`
                                INSERT INTO RG_SCHEDULE_TEACH (
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD, INSERT_DATE, USER_INSERT
                                ) VALUES (:1, :2, :3, :4, :5, (SYSDATE + 7/24), :6)
                            `, [cleanYear, cleanSem, targetInstrGroup.toString(), code, (i + 1).toString(), username]);
                        }
                    }
                }

                // 6. Insert into RG_SCHEDULE_CLASS
                await tx.executeOne(`
                    INSERT INTO RG_SCHEDULE_CLASS (
                        STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP, INSERT_DATE, USER_INSERT
                    ) VALUES (:1, :2, :3, :4, :5, :6, :7, (SYSDATE + 7/24), :8)
                `, [cleanYear, cleanSem, cleanCourseNo, cleanDay, cleanTime, cleanRoom, targetInstrGroup, username]);
            });

            return res.status(200).json({
                success: true,
                message: `คัดลอกวิชา ${cleanCourseNo} เข้าสู่ห้อง ${cleanRoom} (คาบที่ ${cleanTime}) เรียบร้อยแล้ว`
            });
        } catch (error) {
            console.error('[TimetableCrudController.copySingleClass error]', error);
            if (!res.headersSent) {
                return res.status(400).json({ success: false, message: error.message || 'คัดลอกวิชาไม่สำเร็จ' });
            }
        }
    },
};

module.exports = TimetableCrudController;
