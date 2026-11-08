// Talks to the Apps Script web app.
// Content-Type text/plain keeps this a "simple" request, so the browser skips
// the CORS preflight that Apps Script can't answer.
window.Api = (() => {
  const KEY = 'tt_token';

  const getToken = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {} };

  async function call(action, payload = {}) {
    let res;
    try {
      res = await fetch(window.TT_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: getToken(), payload })
      });
    } catch (e) {
      throw new Error("Can't reach the spreadsheet. Check your connection and try again.");
    }
    if (!res.ok) throw new Error('The spreadsheet replied with an error (' + res.status + ').');

    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.error);
      err.code = data.code;
      if (data.code === 'AUTH') {
        setToken(null);
        window.dispatchEvent(new Event('tt:logout'));
      }
      throw err;
    }
    return data.data;
  }

  return { call, getToken, setToken };
})();
