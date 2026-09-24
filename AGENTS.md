# Backend Rules

## Project Root
- Backend code is located in `/my-backend` (`d:/time_table_proj/my-backend`).

## Node Path & Directory Structure
- Routes: `/my-backend/routers` (`routers/routes.js`)
- Controllers: `/my-backend/controllers` (`controllers/timetableController/`)
- Models: `/my-backend/models` (`models/db/SelectModel.js`, `models/db/DbTxModel.js`)
- Utils: `/my-backend/utils` (`utils/timetableUtils.js`)

## Rules
- Always assume the working directory for backend tasks is `/my-backend`.
- Do not ask for node paths or scan unrelated frontend directories when modifying the backend.
- Do not run unnecessary node path discovery commands; edit code directly and rely on live dev servers (`nodemon .`).
- Use exact paths relative to `/my-backend` for all require/import statements.
- Strictly adhere to MVC pattern and use shared helper functions from `utils/timetableUtils.js`.
