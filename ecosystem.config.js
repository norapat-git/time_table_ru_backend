module.exports = {
  apps: [{
    name: "app",
    script: "./app.js",
    autorestart: true,
    instances: 2,
    exec_mode: "cluster",
    exec_interpreter: "node",

    /* Control flow */
    "min_uptime": 5000, /* (string) min uptime of the app to be considered started */
    "listen_timeout": 100000, /* (number) time in ms before forcing a reload if app not listening  */
    "kill_timeout": 5000, /* (number) time in milliseconds before sending a final SIGKILL */
    "wait_ready": false, /* (boolean) Instead of reload waiting for listen event, wait for process.send(‘ready’) */
    "max_restarts": 5, /* number of consecutive unstable restarts (less than 1sec interval or custom time via min_uptime) before your app is considered errored and stop being restarted */
    "restart_delay": 4000, /* (number) time to wait before restarting a crashed app (in milliseconds). defaults to 0. */
    "autorestart": true, /* (boolean) true by default. if false, PM2 will not restart your app if it crashes or ends peacefully */
    "cron_restart": "1 0 * * *", /* (string) a cron pattern to restart your app. Application must be running for cron feature to work */
    "vizion": false, /* (boolean) true by default. if false, PM2 will start without vizion features (versioning control metadatas) */
    "post_update": ["npm install", "echo launching the app"], /* (list) a list of commands which will be executed after you perform a Pull/Upgrade operation from Keymetrics dashboard */
    "force": false, /* (boolean) defaults to false. if true, you can start the same script several times which is usually not allowed by PM2 */

    env: {
      NODE_ENV: "development",
      PORT: 4000
    },
    env_production: {
      NODE_ENV: "production",
      PORT: 4000
    }

  }/*  {
    name: 'worker',
    script: 'app.js'
  } */
  ]
};
