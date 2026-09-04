
class Response {
    //boolean,string,obj
    constructor(error, message, data) {
        this.error = error;
        this.message = message;
        this.response = data;
    }
} 

const sendAuthorization = (url, accessToken) => {
    return {
        method: "get",
        url: url,
        headers: {
            Authorization: `Bearer ${accessToken} `,
            "Content-type": "application/json",
        },
    };
};

class ResponseStatus {
    constructor(status) {
        this.status = status;

    }

    /* errorStatus() {
      return errstatus = 403 || 404 || 500; 
    } */
}


module.exports = { Response, sendAuthorization, ResponseStatus };