
const express = require("express");
const bodyParser = require("body-parser");
const helmet = require('helmet');
const cors = require("cors");

var app = express();
const http = require('http');
const WebSocket = require('ws');

require("dotenv").config();

app.set('trust proxy', true);

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

'use strict';
Error.stackTraceLimit = 50;

// CORS Configuration
app.use(cors({
  origin: ['http://localhost', 'http://localhost:4200', 'https://uat3.ru.ac.th', '*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', cors()); // รองรับ preflight requests
app.use(helmet());


const routeControll = require("./routers/routesControl");
const routes = require("./routers/routes"); 
const routes_frontend = require("./routers/frontend-route"); 


app.get('/', (req, res) => {
  //console.log(TOKEN_SECRET);
  res.status(200).json({ message: 'Api E-testing v1.' });
});



app.use('/api/doc', routes);
app.use('/api/', routeControll);
app.use('/api/service/frontend', routes_frontend); 
app.use('/api/service', routes); 

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
server.keepAliveTimeout = 4000;
server.listen(process.env.PORT, '0.0.0.0',
  () => {
    console.log("listening on port..: " + server.address().port);
  }
);
