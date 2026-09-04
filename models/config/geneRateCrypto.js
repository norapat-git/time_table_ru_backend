
const genToken = {
    genToken64: () => {
        var crypto = require('crypto').randomBytes(64).toString('hex');
        return crypto;
        //console.log(crypto);
    },
    genTokenSHA: () => {
        var crypto = require('crypto').randomBytes(256).toString('hex');
        return crypto;
        //console.log(crypto);
    }
}
module.exports = genToken