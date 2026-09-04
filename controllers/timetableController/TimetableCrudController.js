const SelectModel = require('../../models/db/SelectModel');
const DbTxModel = require('../../models/db/DbTxModel');

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
    // 5. เพิ่มข้อมูลตารางสอน (บันทึกลง RG_SCHEDULE_CLASS และ RG_SCHEDULE_TEACH รองรับหลายคาบ)
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

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanDay = Number(dayCode);
            const cleanRoom = (roomCode || '').toString().trim();
            const user = userInsert || 'ADMIN';

            // 1. ตรวจสอบการชนของห้องเรียน (Room Collision Check) สำหรับทุกคาบที่เลือก
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

                            // ตรวจสอบว่า existingCourseNo กับ cleanCourseNo อยู่ในกลุ่มวิชาคู่เดียวกันหรือไม่
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

                    // 2. ตรวจสอบวิชาเดิมซ้ำวันเวลาเดิม
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

            // จัดการกลุ่มอาจารย์ผู้สอน (RG_SCHEDULE_INSTRUCTOR_GROUP & RG_SCHEDULE_TEACH)
            const rawCodes = Array.isArray(instructorCodes) ? instructorCodes : [];
            const uniqueCodes = Array.from(new Set(rawCodes.map((c) => (c || '').toString().trim()).filter(Boolean))).sort();

            // 3. ตรวจสอบว่าอาจารย์สามารถมาสอนในวันและเวลานี้ได้หรือไม่ (RU30 Teaching Slot Validation)
            if (uniqueCodes.length > 0) {
                for (const code of uniqueCodes) {
                    const ru30Sql = `
                        SELECT ru.DAY_CODE, ru.TIME_CODE, TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI
                        FROM UGB_RU30 ru
                        LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                        WHERE TRIM(ru.INSTRUCTOR_CODE) = :1
                          AND ru.DAY_CODE IS NOT NULL 
                          AND ru.TIME_CODE IS NOT NULL
                    `;
                    const ru30Res = await SelectModel.findAll(res, ru30Sql, [code]);
                    const ru30Slots = ru30Res.rows || [];

                    if (ru30Slots.length > 0) {
                        for (const cleanTime of targetTimeCodes) {
                            const hasMatchingSlot = ru30Slots.some(
                                (s) => Number(s.DAY_CODE) === cleanDay && Number(s.TIME_CODE) === cleanTime
                            );
                            if (!hasMatchingSlot) {
                                const instName = ru30Slots[0].INSTRUCTOR_NAME_THAI || code;
                                return res.status(400).json({
                                    success: false,
                                    message: `อาจารย์ ${instName} (${code}) ไม่สามารถสอนในวันดังกล่าว คาบที่ ${cleanTime} ได้ (ไม่อยู่ในวันและเวลาว่างของอาจารย์ตาม มร.30)`,
                                });
                            }
                        }
                    }
                }
            }

            // 4. ตรวจสอบอาจารย์ติดสอนในคาบนี้ (Instructor Collision Check) สำหรับทุกคาบที่เลือก
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
                if (uniqueCodes.length > 0) {
                    const existingTeachSql = `
                        SELECT 
                            TO_NUMBER(INSTRUCTOR_GROUP) AS INSTRUCTOR_GROUP, 
                            COUNT(*) AS TOTAL_INSTR,
                            LISTAGG(TRIM(INSTRUCTOR_CODE), ',') WITHIN GROUP (ORDER BY TRIM(INSTRUCTOR_CODE)) AS CODES_STR
                        FROM RG_SCHEDULE_TEACH
                        WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2
                        GROUP BY INSTRUCTOR_GROUP
                    `;
                    const existingGroups = await tx.fetchAll(existingTeachSql, [cleanYear, cleanSem]);

                    const targetCodesStr = uniqueCodes.join(',');
                    const matched = existingGroups.find((g) => (g.CODES_STR || '').trim() === targetCodesStr && Number(g.TOTAL_INSTR) === uniqueCodes.length);

                    if (matched && matched.INSTRUCTOR_GROUP) {
                        targetInstrGroup = Number(matched.INSTRUCTOR_GROUP);
                    } else {
                        const maxGroupSql = `
                            SELECT 
                                GREATEST(
                                    NVL((SELECT MAX(INSTR_GROUP) FROM RG_SCHEDULE_INSTRUCTOR_GROUP), 0),
                                    NVL((SELECT MAX(INSTR_GROUP) FROM RG_SCHEDULE_CLASS WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2), 0),
                                    NVL((SELECT MAX(TO_NUMBER(INSTRUCTOR_GROUP)) FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :3 AND TRIM(STUDY_SEMESTER) = :4), 0)
                                ) + 1 AS NEXT_GROUP
                            FROM DUAL
                        `;
                        const maxRow = await tx.fetchOne(maxGroupSql, [cleanYear, cleanSem, cleanYear, cleanSem]);
                        targetInstrGroup = Number(maxRow?.NEXT_GROUP || 1);

                        try {
                            await tx.executeOne(`INSERT INTO RG_SCHEDULE_INSTRUCTOR_GROUP (INSTR_GROUP) VALUES (:1)`, [targetInstrGroup]);
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
                                    :1, :2, :3, :4, :5, SYSDATE, :6
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

                // บันทึกลง RG_SCHEDULE_CLASS สำหรับทุกคาบที่เลือก
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
                            :1, :2, :3, :4, :5, :6, :7, SYSDATE, :8
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

    // 5.1 แก้ไขข้อมูลตารางสอน (อัปเดต RG_SCHEDULE_CLASS และ RG_SCHEDULE_TEACH พร้อมสำรองประวัติลง HIS)
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

            const cleanYear = studyYear.toString().trim();
            const cleanSem = studySemester.toString().trim();
            const cleanCourseNo = courseNo.toString().trim().toUpperCase();
            const cleanDay = Number(dayCode);
            const cleanRoom = roomCode.toString().trim();
            const user = userInsert || 'ADMIN';

            // 1. ตรวจสอบการชนของห้องเรียน (Room Collision Check) สำหรับทุกคาบที่เลือก
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

                            // ตรวจสอบว่า existingCourseNo กับ cleanCourseNo อยู่ในกลุ่มวิชาคู่เดียวกันหรือไม่
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
                // 1. ดึง INSTR_GROUP เดิม
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

                // 2. สำรอง RG_SCHEDULE_CLASS -> RG_SCHEDULE_CLASS_HIS
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
                        SYSDATE,
                        USER_INSERT,
                        :1
                    FROM RG_SCHEDULE_CLASS
                    WHERE TRIM(STUDY_YEAR) = :2 
                      AND TRIM(STUDY_SEMESTER) = :3 
                      AND TRIM(COURSE_NO) = :4
                `;
                await tx.executeOne(hisClassSql, [user, cleanYear, cleanSem, cleanCourseNo]);

                // 3. จัดการอาจารย์ผู้สอน
                const rawCodes = Array.isArray(instructorCodes)
                    ? instructorCodes.map(c => (c || '').toString().trim()).filter(Boolean)
                    : (typeof instructorCodes === 'string' ? instructorCodes.split(',').map(c => c.trim()).filter(Boolean) : []);
                const uniqueInstructors = Array.from(new Set(rawCodes));

                if (!targetInstrGroup || targetInstrGroup <= 0) {
                    if (uniqueInstructors.length > 0) {
                        const seqSql = `SELECT NVL(MAX(INSTR_GROUP), 0) + 1 AS NEXT_ID FROM RG_SCHEDULE_INSTRUCTOR_GROUP`;
                        const seqRes = await tx.fetchAll(seqSql, []);
                        targetInstrGroup = Number(seqRes?.[0]?.NEXT_ID || 1);
                        await tx.executeOne(
                            `INSERT INTO RG_SCHEDULE_INSTRUCTOR_GROUP (INSTR_GROUP, INSTR_GROUP_NAME, INSERT_DATE, USER_INSERT) VALUES (:1, :2, SYSDATE, :3)`,
                            [targetInstrGroup, `กลุ่มผู้สอนวิชา ${cleanCourseNo}`, user]
                        );
                    }
                } else {
                    // สำรอง RG_SCHEDULE_TEACH -> RG_SCHEDULE_TEACH_HIS
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
                            SYSDATE,
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

                    // ลบรายการผู้สอนเดิมออก
                    await tx.executeOne(
                        `DELETE FROM RG_SCHEDULE_TEACH WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3`,
                        [cleanYear, cleanSem, targetInstrGroup.toString()]
                    );
                }

                // แทรกรายชื่ออาจารย์ผู้สอนใหม่
                if (uniqueInstructors.length > 0 && targetInstrGroup) {
                    for (let i = 0; i < uniqueInstructors.length; i++) {
                        const code = uniqueInstructors[i];
                        const insertTeachSql = `
                            INSERT INTO RG_SCHEDULE_TEACH (
                                STUDY_YEAR,
                                STUDY_SEMESTER,
                                INSTRUCTOR_GROUP,
                                INSTRUCTOR_CODE,
                                INSTRUCTOR_ORD,
                                INSERT_DATE,
                                USER_INSERT
                            ) VALUES (:1, :2, :3, :4, :5, SYSDATE, :6)
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

                // 4. ลบรายการคาบเดิมใน RG_SCHEDULE_CLASS แล้วแทรกคาบใหม่ตาม targetTimeCodes
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
                            :1, :2, :3, :4, :5, :6, :7, SYSDATE, :8
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
                message: `แก้ไขข้อมูลตารางสอนวิชา ${cleanCourseNo} เรียบร้อยแล้ว`,
            });
        } catch (error) {
            console.error('[TimetableCrudController.updateScheduleClass error]', error);
            if (!res.headersSent) {
                return res.status(500).json({ success: false, message: error.message });
            }
        }
    },

    // 6. ลบข้อมูลตารางสอน (สำรองลง RG_SCHEDULE_CLASS_HIS และ RG_SCHEDULE_TEACH_HIS)
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
            const user = userInsert || 'ADMIN';

            // จัดการคาบเรียน (รองรับทั้ง timeCodes array และ timeCode เดี่ยว)
            let targetTimeList = [];
            if (Array.isArray(timeCodes) && timeCodes.length > 0) {
                targetTimeList = timeCodes.map(Number).filter(n => !isNaN(n));
            } else if (cleanTime !== null && !isNaN(cleanTime)) {
                targetTimeList = [cleanTime];
            }

            await DbTxModel.withTransaction(async (conn, tx) => {
                // สร้าง WHERE filter ให้เจาะจงเฉพาะคาบ/ห้อง/กลุ่มที่ต้องการลบ
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
                if (cleanRoom) {
                    whereClause += ` AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:${pIdx++}))`;
                    filterParams.push(cleanRoom);
                }
                if (cleanGroup !== null && !isNaN(cleanGroup)) {
                    whereClause += ` AND INSTR_GROUP = :${pIdx++}`;
                    filterParams.push(cleanGroup);
                }

                // ดึงรายการ INSTR_GROUP ของแถวที่ตรงกับเงื่อนไขที่จะถูกลบออกมาก่อน
                let affectedGroups = [];
                if (cleanGroup !== null && !isNaN(cleanGroup) && cleanGroup > 0) {
                    affectedGroups = [cleanGroup];
                } else {
                    const findGroupSql = `
                        SELECT DISTINCT INSTR_GROUP
                        FROM RG_SCHEDULE_CLASS
                        ${whereClause}
                    `;
                    const groupRows = await tx.fetchAll(findGroupSql, filterParams);
                    affectedGroups = (groupRows || [])
                        .map(r => Number(r.INSTR_GROUP))
                        .filter(g => g !== null && !isNaN(g) && g > 0);
                }

                // 1. สำรอง RG_SCHEDULE_CLASS -> RG_SCHEDULE_CLASS_HIS
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
                        SYSDATE,
                        USER_INSERT,
                        :1
                    FROM RG_SCHEDULE_CLASS
                    ${whereClause}
                `;
                await tx.executeOne(hisClassSql, [user, ...filterParams]);

                // 2. ลบจาก RG_SCHEDULE_CLASS
                const delClassSql = `
                    DELETE FROM RG_SCHEDULE_CLASS
                    ${whereClause}
                `;
                await tx.executeOne(delClassSql, filterParams);

                // 3. สำรองและลบออกจาก RG_SCHEDULE_TEACH และ RG_SCHEDULE_INSTRUCTOR_GROUP (สำหรับทุกกลุ่มที่ไม่มีคลาสอื่นใช้แล้ว)
                for (const grp of affectedGroups) {
                    const checkRemainingSql = `
                        SELECT COUNT(*) AS CNT
                        FROM RG_SCHEDULE_CLASS
                        WHERE TRIM(STUDY_YEAR) = :1
                          AND TRIM(STUDY_SEMESTER) = :2
                          AND INSTR_GROUP = :3
                    `;
                    const remainingRes = await tx.fetchOne(checkRemainingSql, [cleanYear, cleanSem, grp]);
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
                                SYSDATE,
                                USER_INSERT,
                                :1
                            FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(STUDY_YEAR) = :2 
                              AND TRIM(STUDY_SEMESTER) = :3 
                              AND TRIM(INSTRUCTOR_GROUP) = :4
                        `;
                        try {
                            await tx.executeOne(hisTeachSql, [user, cleanYear, cleanSem, grp.toString()]);
                        } catch (e) {
                            console.warn('[RG_SCHEDULE_TEACH_HIS backup warning]', e?.message);
                        }

                        const delTeachSql = `
                            DELETE FROM RG_SCHEDULE_TEACH
                            WHERE TRIM(STUDY_YEAR) = :1 
                              AND TRIM(STUDY_SEMESTER) = :2 
                              AND TRIM(INSTRUCTOR_GROUP) = :3
                        `;
                        await tx.executeOne(delTeachSql, [cleanYear, cleanSem, grp.toString()]);

                        // ตรวจสอบว่าใน RG_SCHEDULE_CLASS ทั้งหมดไม่มีใครใช้ grp นี้อีกแล้ว จึงลบออกจาก master table
                        const checkGlobalClass = await tx.fetchOne(
                            `SELECT COUNT(*) AS CNT FROM RG_SCHEDULE_CLASS WHERE INSTR_GROUP = :1`,
                            [grp]
                        );
                        if (Number(checkGlobalClass?.CNT || 0) === 0) {
                            try {
                                await tx.executeOne(`DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP WHERE INSTR_GROUP = :1`, [grp]);
                            } catch (e) {
                                console.warn('[RG_SCHEDULE_INSTRUCTOR_GROUP delete notice]', e?.message);
                            }
                        }
                    }
                }
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

    // 7. ลบข้อมูลตารางสอนแบบกลุ่ม (Bulk Delete)
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
            const user = userInsert || 'ADMIN';
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
                    if (cleanRoom) {
                        whereClause += ` AND UPPER(TRIM(ROOM_CODE)) = UPPER(TRIM(:${pIdx++}))`;
                        filterParams.push(cleanRoom);
                    }
                    if (cleanGroup !== null && !isNaN(cleanGroup)) {
                        whereClause += ` AND INSTR_GROUP = :${pIdx++}`;
                        filterParams.push(cleanGroup);
                    }

                    // 1. สำรอง RG_SCHEDULE_CLASS_HIS
                    const hisClassSql = `
                        INSERT INTO RG_SCHEDULE_CLASS_HIS (
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                            INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                        )
                        SELECT 
                            STUDY_YEAR, STUDY_SEMESTER, COURSE_NO, DAY_CODE, TIME_CODE, ROOM_CODE, INSTR_GROUP,
                            INSERT_DATE, SYSDATE, USER_INSERT, :1
                        FROM RG_SCHEDULE_CLASS
                        ${whereClause}
                    `;
                    await tx.executeOne(hisClassSql, [user, ...filterParams]);

                    // 2. ลบ RG_SCHEDULE_CLASS
                    const delClassSql = `
                        DELETE FROM RG_SCHEDULE_CLASS
                        ${whereClause}
                    `;
                    await tx.executeOne(delClassSql, filterParams);

                    // 3. สำรองและลบ RG_SCHEDULE_TEACH (เฉพาะเมื่อไม่มีคลาสอื่นใช้ INSTR_GROUP นี้แล้ว)
                    if (cleanGroup !== null && !isNaN(cleanGroup) && cleanGroup > 0) {
                        const checkRemainingSql = `
                            SELECT COUNT(*) AS CNT
                            FROM RG_SCHEDULE_CLASS
                            WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND INSTR_GROUP = :3
                        `;
                        const remainingRes = await tx.fetchOne(checkRemainingSql, [cleanYear, cleanSem, cleanGroup]);
                        if (Number(remainingRes?.CNT || 0) === 0) {
                            const hisTeachSql = `
                                INSERT INTO RG_SCHEDULE_TEACH_HIS (
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                                    INSERT_DATE, INSERT_HIS_DATE, USER_INSERT, USER_INSERT_HIS
                                )
                                SELECT 
                                    STUDY_YEAR, STUDY_SEMESTER, INSTRUCTOR_GROUP, INSTRUCTOR_CODE, INSTRUCTOR_ORD,
                                    INSERT_DATE, SYSDATE, USER_INSERT, :1
                                FROM RG_SCHEDULE_TEACH
                                WHERE TRIM(STUDY_YEAR) = :2 AND TRIM(STUDY_SEMESTER) = :3 AND TRIM(INSTRUCTOR_GROUP) = :4
                            `;
                            try {
                                await tx.executeOne(hisTeachSql, [user, cleanYear, cleanSem, cleanGroup.toString()]);
                            } catch (e) {
                                console.warn('[RG_SCHEDULE_TEACH_HIS bulk warning]', e?.message);
                            }

                            const delTeachSql = `
                                DELETE FROM RG_SCHEDULE_TEACH
                                WHERE TRIM(STUDY_YEAR) = :1 AND TRIM(STUDY_SEMESTER) = :2 AND TRIM(INSTRUCTOR_GROUP) = :3
                            `;
                            await tx.executeOne(delTeachSql, [cleanYear, cleanSem, cleanGroup.toString()]);

                            try {
                                await tx.executeOne(`DELETE FROM RG_SCHEDULE_INSTRUCTOR_GROUP WHERE INSTR_GROUP = :1`, [cleanGroup]);
                            } catch (e) {
                                // ignore
                            }
                        }
                    }

                    deletedCount++;
                }
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

    // 8. อัปเดต วัน/เวลาเรียน (ย้ายช่องตารางสอน Drag & Drop)
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
            const user = userInsert || 'ADMIN';
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

                    // ดึง ROOM_CODE และ INSTR_GROUP ของวิชาที่จะย้าย
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

                    // ตรวจสอบการชนห้องเรียนในช่องเป้าหมาย (newDay, newTime) ของ targetRoom
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

                            // หากวิชาเป้าหมายนี้กำลังจะถูกย้ายออกจากช่องนี้ในชุด moves เดียวกัน (กรณีสลับวิชา / Swap) ให้ถือว่าไม่ชน
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

                            // ตรวจสอบว่าเป็นวิชาคู่กันหรือไม่
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

                    // ดึงรายชื่ออาจารย์ผู้สอนของวิชานี้เพื่อตรวจสอบความพร้อมสอนและการชนกันของตารางสอน
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

                    // 1. ตรวจสอบเวลาว่างของอาจารย์ตาม มร.30 (RU30 Teaching Slot Validation)
                    if (uniqueTeacherCodes.length > 0) {
                        for (const code of uniqueTeacherCodes) {
                            const ru30Sql = `
                                SELECT ru.DAY_CODE, ru.TIME_CODE, TRIM(ui.INSTRUCTOR_NAME_THAI) AS INSTRUCTOR_NAME_THAI
                                FROM UGB_RU30 ru
                                LEFT JOIN UGB_INSTRUCTOR ui ON TRIM(ru.INSTRUCTOR_CODE) = TRIM(ui.INSTRUCTOR_CODE)
                                WHERE TRIM(ru.INSTRUCTOR_CODE) = :1
                                  AND ru.DAY_CODE IS NOT NULL 
                                  AND ru.TIME_CODE IS NOT NULL
                                  AND ru.DAY_CODE != 0
                                  AND ru.TIME_CODE != 0
                            `;
                            const ru30Slots = await tx.fetchAll(ru30Sql, [code]);

                            if (ru30Slots.length > 0) {
                                const hasMatchingSlot = ru30Slots.some(
                                    (s) => Number(s.DAY_CODE) === newDay && Number(s.TIME_CODE) === newTime
                                );
                                if (!hasMatchingSlot) {
                                    const instObj = instructorsOfClass.find((x) => (x.INSTRUCTOR_CODE || '').trim() === code);
                                    const instName = instObj?.INSTRUCTOR_NAME_THAI || ru30Slots[0]?.INSTRUCTOR_NAME_THAI || code;
                                    throw new Error(`ไม่สามารถย้ายวิชา ${courseNo} ได้ เนื่องจากอาจารย์ ${instName} (${code}) ไม่สามารถสอนในวันดังกล่าว คาบที่ ${newTime} ได้ (ไม่อยู่ในวันและเวลาว่างของอาจารย์ตาม มร.30)`);
                                }
                            }
                        }
                    }

                    // 2. ตรวจสอบว่าอาจารย์ติดสอนวิชาอื่นในวัน/เวลาเป้าหมายหรือไม่ (Instructor Collision Check)
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

                                // หากวิชาที่อาจารย์สอนชนอยู่นี้กำลังจะถูกย้ายออกจากช่องนี้ในชุด moves เดียวกัน ให้ถือว่าไม่ชน
                                const isBusyBeingMovedAway = moves.some((otherMove) => {
                                    const oCourseNo = (otherMove.courseNo || '').toString().trim().toUpperCase();
                                    const oOldDay = Number(otherMove.oldDayCode);
                                    const oOldTime = Number(otherMove.oldTimeCode);
                                    return oCourseNo === busyCourseNo && oOldDay === newDay && oOldTime === newTime;
                                });

                                if (isBusyBeingMovedAway) {
                                    continue;
                                }

                                // ตรวจสอบว่าเป็นวิชาคู่กันหรือไม่
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

                    // 1. สำรองข้อมูลเดิมลง RG_SCHEDULE_CLASS_HIS
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
                            SYSDATE,
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

                    // 2. Phase 1: อัปเดต DAY_CODE, TIME_CODE เป็นค่าติดลบชั่วคราว (-newTime) เพื่อป้องกันการชน Unique Constraint ขณะเลื่อนคาบต่อเนื่อง
                    let updateSql = `
                        UPDATE RG_SCHEDULE_CLASS
                        SET DAY_CODE = :1,
                            TIME_CODE = :2,
                            ROOM_CODE = :3,
                            USER_INSERT = :4,
                            INSERT_DATE = SYSDATE
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

                // Phase 2: ปรับค่า TIME_CODE ที่เป็นค่าติดลบชั่วคราวกลับมาเป็นค่าบวกจริง
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
};

module.exports = TimetableCrudController;
