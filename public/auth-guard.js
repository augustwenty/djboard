// Redirect to the login page if a session expires mid-use (any fetch gets a 401).
(function () {
  const _fetch = window.fetch;
  window.fetch = function (...args) {
    return _fetch.apply(this, args).then((res) => {
      if (res.status === 401) location.href = '/login.html';
      return res;
    });
  };
})();
