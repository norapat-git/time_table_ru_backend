module.exports = {
    apps: [
        {
            name: "regis-mobiles1",
            /* cwd: "/usr/src/app", */
            cwd: "app.js",
            script: "npm",
            args: "start",
            env: {
                NODE_ENV: "production",
                PORT: 4422
            },
            "instances": 4,
            "exec_mode": "cluster",
            /*  "interpreter": "/usr/bin/python", /* (string) interpreter absolute path (default to node) */
            /*  "interpreter_args": "--harmony", /* (string) option to pass to the interpreter */
            //"node_args": "", /* (string) alias to interpreter_args  */
            "exec_interpreter": "node",

            /* Log files */
            "log_date_format": "YYYY-MM-DD HH:mm Z", /* (string) log date format */
            //"error_file": "", /* (string) error file path (default to $HOME/.pm2/logs/XXXerr.log) */
            //"out_file": "", /* (string) output file path (default to $HOME/.pm2/logs/XXXout.log) */
            "combine_logs": true, /* (boolean) if set to true, avoid to suffix logs file with the process id */
            //"merge_logs": true, /* (boolean) alias to combine_logs*/
            //"pid_file": "", /* (string) pid file path (default to $HOME/.pm2/pid/app-pm_id.pid) */
            "log_type": "json", /* none documented function */

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

            /*  env_development: {
               NODE_ENV: "development",
               PORT: 8080,
               watch: true,
               watch_delay: 3000,
               ignore_watch: [
                 "./node_modules",
                 "./app/views",
                 "./public",
                 "./.DS_Store",
                 "./package.json",
                 "./yarn.lock",
                 "./samples",
                 "./src"
               ],
             }, */
        }/* ,
        {
            name: "regis-mobiles2",
            cwd: "./app.js",
            script: "npm",
            args: "start",
            env: {
                NODE_ENV: "production"
            }
        },
        {
            name: "regis-mobiles3",
            script: "./app.js"
        } */
    ]
}