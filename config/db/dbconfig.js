
require('dotenv').config();
module.exports = {
    user          : process.env.NODE_ORACLEDB_USER,
    password      : process.env.NODE_ORACLEDB_PASSWORD,
    connectString : process.env.NODE_ORACLEDB_CONNECTIONSTRING,
    /*poolAlias: process.env.NODE_ORACLEDB_POOLALIAS,
    //poolAlias: 'xxx',
    poolMin: 0,
    poolMax: 200,
    queueMax: 400,
    queueTimeout: 60000*/
  
};

