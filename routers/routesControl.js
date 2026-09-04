var express = require('express');
const app = express();
const bodyParser = require("body-parser");

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const router = express.Router()

const pool = require('../controllers/db/ControllPool');

// Pool close endpoint
router.get('/closepool', pool.closePoolAndExit);


module.exports = router