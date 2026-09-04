const axios = require('axios');


const Helper = {

    async microsoftLogin(username, password, res, results) {
        // const data = `{ "username":"anusorn.w@ru.ac.th", "password":"Awongod27"}`;
        const data = `{"username":"${username}","password":"${password}"}`;

        const pwd = encodeURIComponent(password);

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: `https://service-regisapps.ru.ac.th/authen365/login?username=${username}&password=${pwd}`,
            headers: {
                'Content-Type': 'application/json'
            },
            data: data
        };
        try {
            const response = await axios.request(config);
            return response.data;
        } catch (error) {
            return { success: false, message: 'E-mail or password invalid: ' + error.message };
        }
    }
}

module.exports = Helper