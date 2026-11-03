const nodeFetch = require('node-fetch');

function createEmailAuthProvider({ url, key, fetchImpl = nodeFetch }) {
  async function request(path, { body, accessToken } = {}) {
    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1${path}`, {
        method: body ? 'POST' : 'GET',
        timeout: 15000,
        headers: {
          apikey: key,
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw Object.assign(new Error('The email sign-in service is unavailable. Please try again later.'), { statusCode: 503 });
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw Object.assign(new Error('Too many sign-in requests. Please wait before trying again.'), { statusCode: 429 });
      }
      if (path === '/verify' && [400, 401, 403, 422].includes(response.status)) {
        throw Object.assign(new Error('The code is incorrect or expired. Request a new code and try again.'), { statusCode: 401 });
      }
      throw Object.assign(new Error('The email sign-in service could not complete the request. Please try again later.'), { statusCode: 502 });
    }
    try {
      return await response.json();
    } catch {
      throw Object.assign(new Error('The email sign-in service returned an invalid response. Please try again later.'), { statusCode: 502 });
    }
  }

  return {
    async sendCode(email) {
      await request('/otp', { body: { email, create_user: true } });
    },
    async verifyCode(email, token) {
      const session = await request('/verify', { body: { email, token, type: 'email' } });
      if (!session || typeof session.access_token !== 'string' || !session.access_token) {
        throw Object.assign(new Error('The email sign-in service did not create a session. Please request a new code.'), { statusCode: 502 });
      }
      const user = await request('/user', { accessToken: session.access_token });
      return { email: user && user.email, emailConfirmed: Boolean(user && user.email_confirmed_at) };
    },
  };
}

module.exports = { createEmailAuthProvider };
